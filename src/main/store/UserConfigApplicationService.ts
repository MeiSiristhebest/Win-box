// src/main/store/UserConfigApplicationService.ts
// User-config application facade and atomic persistence boundary.
// Profile/catalog decisions are pure transitions; this module owns load, commit, rollback and notifications.
// 存储：JsonStore 的 'user-config' 键（物理文件 <userData>/user-config.json）。
// 语义：
//   - 每次 URL/JSON 导入 = replaceFromImport（用新配置全量替换 sources+lives+global，apiUrl 记录来源）；
//   - 手动增删改排序只改当前这份，并立即持久化；
//   - 读入健壮性：整文件 JSON 损坏由 JsonStore 备份为 .corrupt-<ts>.json 并重建空档；
//     每条 source 用 parseSite 校验，坏的剔除并在日志说明（不静默保留坏数据）。
// 本模块零 Electron 依赖（可单测）。
import { parseSiteConfig } from '../../engine/config/ApiConfigParser';
import { filterDeletedProfileSources, sourceDeletionKeys, withSourceDeletionKeys } from './sourceDeletionScopes';
import { normalizeUserConfigForCommit } from './userConfigCommitNormalization';
import { UserConfigRepository } from './UserConfigRepository';
import type { ConfigChangeKind, UserConfigPersistencePort } from './UserConfigRepository';
import {
  addLiveToConfig,
  addSourceToConfig,
  deleteLivesFromConfig,
  deleteSourcesFromConfig,
  moveSourceInConfig,
  renameLiveInConfig,
  updateSourceInConfig,
} from './userConfigCatalog';
import { isAutoProfileName } from './userProfileNaming';
import { createProfileFromConfig, replaceImportedProfileConfig, type ImportedProfileSource, type ProfileImportOptions } from './userProfileImports';
import { commitSubscriptionGroupInConfig } from './subscriptionGroupTransitions';
import { buildProfileSitesView } from './userProfileView';
import { mergeLocalLives, syncActiveProfileSnapshot } from './userConfigProfileState';
import type {
  LiveBean,
  Logger,
  ProfileSitesView,
  SiteConfig,
  SourceBean,
  SourceMoveDirection,
  SourceUpdatePatch,
  SubscriptionGroup,
  SubscriptionRefreshResolution,
  UserConfig,
  UserProfile,
} from '../../shared/types';
import { clampIndex, normalizeLoadedUserConfig } from './userConfigNormalization';
import {
  activateProfileInConfig,
  deleteProfileFromConfig,
  removeSubscriptionGroupMemberFromConfig,
  renameProfileInConfig,
  resolveSubscriptionGroupMemberRefreshInConfig,
} from './userProfileTransitions';

export { isAutoProfileName, profileIdSlug, subscriptionStamp } from './userProfileNaming';
export { PROFILE_SNAPSHOT_VERSION, realParses, serializeImport } from './userProfileSnapshot';

export const USER_CONFIG_VERSION = 4;

export { USER_CONFIG_KEY } from './UserConfigRepository';
export type { ConfigChangeKind, UserConfigPersistencePort } from './UserConfigRepository';

export interface UserConfigClock {
  now(): Date;
}

const systemClock: UserConfigClock = { now: () => new Date() };

export function emptyUserConfig(): UserConfig {
  return {
    version: USER_CONFIG_VERSION,
    apiUrl: '',
    global: { spider: '', flags: [] },
    sources: [],
    lives: [],
    parses: [],
    ui: { activeSourceKey: '', activeLiveIndex: 0 },
    profiles: [],
    activeProfileId: '',
    subscriptionGroups: [],
    deletedSourceKeys: [],
    deletedSourceKeysByProfile: {},
  };
}

export class UserConfigApplicationService {
  private readonly repository: UserConfigRepository;

  constructor(
    persistence: UserConfigPersistencePort,
    private logger: Pick<Logger, 'i' | 'w'>,
    private readonly clock: UserConfigClock = systemClock,
  ) {
    this.repository = new UserConfigRepository(persistence, emptyUserConfig());
  }

  private get snap(): UserConfig {
    return this.repository.current;
  }

  /** 注册变更回调（SpiderHost 用它同步 sourceMap / 全局 jar / lives / active 键） */
  setOnChange(cb: (snap: UserConfig, kind: ConfigChangeKind) => void): void {
    this.repository.setOnChange(cb);
  }

  /** 启动时读取；返回是否曾有持久化内容 */
  load(): boolean {
    return this.repository.load((raw) => this.normalizeLoaded(raw));
  }

  get hasPersisted(): boolean {
    return this.repository.hasPersisted;
  }

  /** Monotonic in-memory revision for guarding asynchronous imports from stale commits. */
  get revision(): number {
    return this.repository.revision;
  }

  /** 当前快照（深拷贝，防止调用方污染内部状态） */
  snapshot(): UserConfig {
    return this.repository.snapshot();
  }

  /**
   * ★ 2026-09-29 设置备份还原：整份替换（走与启动读取同一条归一化 + 落盘 + 变更回调路径）。
   * 与导入（replaceFromImport）不同：这里是**还原**，保留备份里的 sources/lives/profiles/ui 原样。
   */
  restore(raw: UserConfig): void {
    const restored = this.normalizeLoaded(raw);
    // ★ 2026-10-15：备份还原同样把「本机导入的本地直播线路」并回来（见 withLocalLives），
    //   并按**备份自带的**「已删除源」墓碑过滤（备份里若同时有该源与墓碑，以墓碑为准）。
    const merged = this.withLocalLives({ ...restored, sources: this.withoutDeletedSources(restored.sources, '备份还原', restored.activeProfileId, restored) });
    this.apply(merged);
  }

  sources(): SourceBean[] {
    const blocked = new Set(this.snap.globallyBlockedSourceKeys);
    return structuredClone(this.snap.sources.filter(source => !blocked.has(source.key)));
  }

  setGlobalSourceBlock(keys: readonly string[], blocked: boolean): void {
    const next = new Set(this.snap.globallyBlockedSourceKeys);
    for (const key of keys) {
      if (typeof key !== 'string' || !key.trim()) continue;
      if (blocked) next.add(key.trim()); else next.delete(key.trim());
    }
    const value = [...next];
    if (JSON.stringify(value) === JSON.stringify(this.snap.globallyBlockedSourceKeys ?? [])) return;
    this.apply({ ...this.snap, globallyBlockedSourceKeys: value });
  }

  lives(): UserConfig['lives'] {
    return this.snap.lives.map((l) => ({ ...l, header: l.header ? { ...l.header } : undefined }));
  }

  activeSourceKey(): string {
    return this.snap.ui.activeSourceKey;
  }

  activeLiveIndex(): number {
    return this.snap.ui.activeLiveIndex;
  }

  /**
   * URL/JSON 导入 = 全量替换 sources+lives+global。
   * parsed 来自 parseSiteConfig 的结果（config.sites/lives/spider/flags）。
   * apiUrl 为订阅地址；粘贴 JSON 导入传 ''（手动管理）。
   */
  replaceFromImport(parsed: SiteConfig, apiUrl: string): void {
    this.replaceImportedConfig(parsed, apiUrl, { restoreDeletedSourceKeys: [] });
  }

  /** Commit an explicit subscription import, including restored deletion markers and optional profile naming. */
  replaceImportedConfig(
    parsed: SiteConfig,
    apiUrl: string,
    options: ProfileImportOptions,
  ): void {
    const result = replaceImportedProfileConfig(this.snap, parsed, apiUrl, {
      ...options, now: this.clock.now(), version: USER_CONFIG_VERSION,
    });
    this.logFilteredSources('订阅导入', result.filteredSourceKeys);
    this.apply(result.config);
  }

  /** 将当前状态存为新档案并切换过去（多 JSON 源管理）。返回新 profile。 */
  saveAsProfile(name: string, source?: ImportedProfileSource): UserProfile {
    const result = createProfileFromConfig(this.snap, name, source, { now: this.clock.now() });
    this.logFilteredSources('另存档案', result.filteredSourceKeys);
    this.apply(result.config);
    return result.profile;
  }

  /** Atomically archives the previous auto-named subscription and activates the imported profile. */
  saveImportedAsProfile(
    name: string,
    parsed: SiteConfig,
    apiUrl: string,
    previousProfileName: string,
    restoreDeletedSourceKeys: readonly string[],
  ): UserProfile {
    const result = createProfileFromConfig(this.snap, name, { parsed, apiUrl }, {
      now: this.clock.now(), previousProfileName, restoreDeletedSourceKeys,
    });
    this.logFilteredSources('另存档案', result.filteredSourceKeys);
    this.apply(result.config);
    return result.profile;
  }

  /**
   * 一次提交多仓成员及其父组。只替换本次成功获取的子档案；失败成员保留旧快照与来源身份。
   * `activateProfileId` 仅用于首次导入或刷新当前正在使用的成员。
   */
  commitSubscriptionGroup(
    group: SubscriptionGroup,
    importedProfiles: UserProfile[],
    activateProfileId?: string,
    expectedRevision?: number,
    restoreDeletedSources = false,
  ): void {
    if (expectedRevision !== undefined && this.revision !== expectedRevision) {
      throw new Error('配置已在导入期间更改；多仓下载结果未保存，请重新导入');
    }
    const result = commitSubscriptionGroupInConfig(this.snap, group, importedProfiles, activateProfileId, restoreDeletedSources);
    this.logFilteredSources('多仓提交', result.filteredSourceKeys);
    this.apply(result.config);
  }

  /**
   * 切换档案：解析其 json 全量恢复 sources/lives/global。json 为空/解析失败抛中文错。
   * ★ 2026-09-30（用户要求）：`pickKey` 非空时在**同一次 apply 内**把选中源落到该档案下的这个 key
   *   （换源弹层「左订阅 → 右源」一步点选完成；两次调用会触发两轮内容变更与宿主重活）。
   */
  activateProfile(id: string, pickKey = ''): void {
    const result = activateProfileInConfig(this.snap, id, pickKey);
    this.logFilteredSources('档案切换', result.filteredSourceKeys);
    this.apply(result.config);
  }

  /**
   * ★ 2026-10-16（用户报「本地包删掉订阅后重新导入、订阅里一个源都没有」）：**清除指定 key 的删除墓碑**。
   *   只在「用户**主动导入**订阅」时调用 —— 那是明确的「我要这份订阅」意图（自动刷新不会走这里），
   *   与 `addSource` 手动重加同一 key 时清墓碑同源（"删了想要回来"的明确路径）。
   *   无变化则不写盘。
   */
  clearDeletedSourceKeys(keys: readonly string[]): void {
    const current = sourceDeletionKeys(this.snap);
    if (!keys.length || !current.length) return;
    const drop = new Set(keys.map((k) => String(k)));
    const next = current.filter((k) => !drop.has(k));
    if (next.length === current.length) return;
    this.apply(withSourceDeletionKeys(this.snap, next));
  }

  /**
   * 删除档案。
   * ★ 2026-10-16（用户要求）：**允许删除当前生效的配置，也允许删除唯一一份配置**（此前生效档案会抛错、
   *   唯一一份时界面上根本没有「删」按钮，用户无法清掉误导入的订阅）。规则：
   *   - 删的是**非生效**档案 → 直接移除（生效档案与运行期内容一字不动）；
   *   - 删的是**生效**档案且还有其它档案 → 移除后自动切到剩下的第一份（按其存档 json 重建 sources/lives/global）；
   *     若剩下的那份无可用 json（早期迁移档案），则保留它为生效档案但清空运行期内容；
   *   - 删的是**唯一**一份 → 清空订阅内容（sources / 订阅自带 lives / parses / apiUrl）；
   *     本机导入的 TXT / M3U 直播线路独立保留（见 withLocalLives）。
   */
  deleteProfile(id: string): void {
    const result = deleteProfileFromConfig(this.snap, id);
    if (!result) return;
    this.logFilteredSources('删除生效档案', result.filteredSourceKeys);
    this.apply(result.config);
  }

  /** 重命名档案 */
  updateProfileName(id: string, name: string): void {
    const next = renameProfileInConfig(this.snap, id, name);
    if (next !== this.snap) this.apply(next);
  }

  /** Remove an upstream-removed member from its group while keeping its snapshot as a standalone profile. */
  removeSubscriptionGroupMember(groupId: string, memberId: string): void {
    this.apply(removeSubscriptionGroupMemberFromConfig(
      this.snap,
      groupId,
      memberId,
      this.clock.now().toISOString(),
    ));
  }

  resolveSubscriptionGroupMemberRefresh(
    groupId: string,
    memberId: string,
    resolution: SubscriptionRefreshResolution,
  ): void {
    this.apply(resolveSubscriptionGroupMemberRefreshInConfig(
      this.snap,
      groupId,
      memberId,
      resolution,
      this.clock.now().toISOString(),
    ));
  }

  /**
   * ★ 2026-09-26（用户口径）：导入新订阅时，把当前生效档案改名为「旧订阅 xx」。
   * 仅当它还是**自动命名**（默认名 / URL 尾段 / 「旧订阅·新订阅 xx」）时才改；
   * 用户手动命名（存为新配置 / 重命名过）的档案保留原名，不覆盖用户的命名。
   */
  renameActiveProfileAsOld(name: string): void {
    const p = this.snap.profiles.find((x) => x.id === this.snap.activeProfileId);
    if (!p || !isAutoProfileName(p)) return;
    this.updateProfileName(p.id, name);
  }

  /** 档案元信息（不含 json 体，避免 IPC 载荷过大） */
  profiles(): Array<{ id: string; name: string; apiUrl: string; sourceCount: number; importedAt: string }> {
    return this.snap.profiles.map(({ id, name, apiUrl, sourceCount, importedAt }) => ({ id, name, apiUrl, sourceCount, importedAt }));
  }

  /**
   * ★ 2026-09-30（用户要求）：换源弹层的「左订阅 / 右源」视图。
   * 当前生效档案取**运行期真实源列表**（含手动增删改/排序）；其余档案解析其存档 JSON。
   * 解析失败给空清单（弹层照常显示该订阅，只是没有源）——不因单份坏档整体失败。
   */
  profileSitesView(): ProfileSitesView {
    const activeId = this.snap.activeProfileId;
    const pick = (s: SourceBean): { key: string; name: string } => ({ key: s.key, name: s.name || s.key });
    const profiles = this.snap.profiles.map((profile) => {
      if (profile.id === activeId) {
        return { id: profile.id, name: profile.name, sites: this.sources().map(pick) };
      }
      let sites: Array<{ key: string; name: string }> = [];
      if (profile.json) {
        try {
          sites = this.profileConfig(profile.id)?.sites.map(pick) ?? [];
        } catch {
          sites = [];
        }
      }
      return { id: profile.id, name: profile.name, sites };
    });
    return buildProfileSitesView(activeId, profiles);
  }

  /** 完整档案（含 json 体），供合并导出等主进程内部使用 */
  rawProfiles(): UserProfile[] {
    return this.snap.profiles.map((p) => ({ ...p }));
  }

  /** Read an inactive profile's saved execution configuration without changing the active profile. */
  profileConfig(id: string): SiteConfig | null {
    const profile = this.snap.profiles.find((candidate) => candidate.id === id);
    if (!profile) return null;
    if (!profile.json) throw new Error(`档案「${profile.name}」没有可恢复的订阅快照`);
    const parsed = parseSiteConfig(profile.json).config;
    const blocked = new Set(this.snap.globallyBlockedSourceKeys);
    return { ...parsed, sites: this.withoutDeletedSources(parsed.sites, '档案视图', id).filter(source => !blocked.has(source.key)) };
  }

  activeProfileId(): string {
    return this.snap.activeProfileId;
  }

  /** 新增源；key 冲突 → 抛中文错。bean 经 parseSite 校验+归一化后入库。 */
  addSource(bean: SourceBean): SourceBean {
    const change = addSourceToConfig(this.snap, bean);
    this.apply(change.config);
    return structuredClone(change.value);
  }

  /** 修改源；仅白名单字段可改，key/type/api 不可改（改则抛）。 */
  updateSource(key: string, patch: SourceUpdatePatch): SourceBean {
    const change = updateSourceInConfig(this.snap, key, patch);
    this.apply(change.config);
    return structuredClone(change.value);
  }

  /** 删除源；若删除的是当前选中源则顺带清空 activeSourceKey。 */
  deleteSource(key: string): void {
    this.deleteSources([key]);
  }

  /** 批量删除源：一次持久化/一次内容变更，避免逐个删除造成 UI 与档案反复刷新。 */
  deleteSources(keys: readonly string[]): void {
    const next = deleteSourcesFromConfig(this.snap, keys);
    if (next) this.apply(next);
  }

  /** 排序：up/down/top/bottom；边界或 key 不存在时静默 no-op（不写盘）。 */
  moveSource(key: string, direction: SourceMoveDirection): void {
    const next = moveSourceInConfig(this.snap, key, direction);
    if (next) this.apply(next);
  }

  /** 选中源（key 不存在则忽略——符合"选中源重启恢复"语义） */
  setActiveSource(key: string): void {
    if (!key) return;
    if (!this.sources().some((s) => s.key === key)) return;
    if (this.snap.ui.activeSourceKey === key) return;
    // ★ 'ui'：只动了 ui.activeSourceKey → 运行期配置未变（见 ConfigChangeKind）
    this.apply({ ...this.snap, ui: { ...this.snap.ui, activeSourceKey: key } }, 'ui');
  }

  /** 选中直播线路（越界 clamp 到 [0, lives.length-1]） */
  setActiveLiveIndex(i: number): void {
    const clamped = clampIndex(i, this.snap.lives.length);
    if (clamped === this.snap.ui.activeLiveIndex) return;
    // ★ 'ui'：同上
    this.apply({ ...this.snap, ui: { ...this.snap.ui, activeLiveIndex: clamped } }, 'ui');
  }

  /**
   * ★ 2026-09-30（用户要求）：追加/更新一条**本地导入的直播源**（TXT / M3U）。
   * 同 url（= 同一个本地文件）视为同一条：只更新 name，不产生重复线路；
   * 返回该线路下标与是否命中已有条目（UI 提示用）。
   */
  addLive(bean: LiveBean): { index: number; replaced: boolean } {
    const change = addLiveToConfig(this.snap, bean);
    this.apply(change.config);
    return change.value;
  }

  /**
   * ★ 2026-10-14（用户要求）：删除某条**直播线路**（下标越界静默 no-op）。
   * 同步收敛 activeLiveIndex，避免删除后选中态悬空（越界 clamp 到末条）。
   */
  deleteLive(index: number): void {
    const next = deleteLivesFromConfig(this.snap, [index]);
    if (next) this.apply(next);
  }

  /**
   * ★ 2026-10-16（用户要求）：**批量**删除直播线路（配置页「直播线路」多选删除）。
   * 按下标集合一次移除（越界忽略），并收敛 activeLiveIndex（避免选中态悬空）。
   */
  deleteLives(indices: readonly number[]): void {
    const next = deleteLivesFromConfig(this.snap, indices);
    if (next) this.apply(next);
  }

  /** ★ 2026-10-14（用户要求）：重命名某条直播线路（空名/越界静默 no-op）。 */
  updateLiveName(index: number, name: string): void {
    const next = renameLiveInConfig(this.snap, index, name);
    if (next) this.apply(next);
  }

  // ---------------------------------------------------------------
  private apply(next: UserConfig, kind: ConfigChangeKind = 'content'): void {
    next = normalizeUserConfigForCommit(next);
    // ★ 2026-09-30：内容型变更必须把「当前生效档案」的存档 json 一起对齐（见 withActiveProfileSynced）
    this.repository.commit(kind === 'content' ? this.withActiveProfileSynced(next) : next, kind);
  }

  /**
   * ★ 2026-09-30（用户报「切换订阅时，源列表里偶尔会残留上一个订阅的部分源」）：
   *   档案存档 json 与**运行期源列表必须始终一致**。
   *
   *   此前只在「导入 / 存为新配置 / 激活档案」时写 json，之后用户手动增删改/排序源只落在
   *   `snap.sources`；一旦切到别的订阅再切回来，`activateProfile` 会用**旧 json 重建**
   *   → 手动删掉的源又冒出来、手动加的源消失（用户观感 = 列表里混着上一份订阅的源）。
   *   这里每次内容型变更都把生效档案的 json 重新序列化（幂等：activateProfile 从 json 重建后
   *   再序列化结果相同，不会来回抖动）。
   */
  private withActiveProfileSynced(next: UserConfig): UserConfig {
    return syncActiveProfileSnapshot(next);
  }

  private withLocalLives(next: UserConfig): UserConfig {
    return mergeLocalLives(next, this.snap.lives);
  }

  /**
   * ★ 2026-10-15（用户报「导入的 TXT 直播源重启后消失」）：
   *   本机导入的 TXT / M3U 直播线路（url = `…/file/local-live/<文件>`）是**一份独立于订阅的本地订阅**。
   *   订阅导入（`replaceFromImport`）、启动时的 7 天自动刷新、「新订阅另存为新档案」（`saveAsProfile`）
   *   与档案切换（`activateProfile`）都会用「订阅自带线路」**全量替换** `lives` —— 若不单独并回来，
   *   用户的本地直播源就会在任何一次订阅往返后消失（重启即触发自动刷新 → 观感 =「重启软件就没了」）。
   *   这里按 url 去重追加回当前 `snap` 里的本地线路（保留用户已重命名 / 已编辑的字段，避免档案 json 重复带回）。
   */
  /** 读入归一化：版本迁移钩子 + 逐条 source/live 校验剔除。 */
  private normalizeLoaded(raw: UserConfig): UserConfig {
    const result = normalizeLoadedUserConfig(raw, USER_CONFIG_VERSION, this.clock.now());
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.level === 'info') this.logger.i(diagnostic.message);
      else this.logger.w(diagnostic.message);
    }
    return result.config;
  }

  /**
   * ★ 2026-10-15（用户报「配置里删掉的源，换源下拉里还在」）：按「用户删除过的 key 墓碑」过滤掉随订阅
   *   往返一起回来的源。订阅语义是全量替换（导入 / 启动 7 天自动刷新 / 档案切换 / 备份还原），
   *   若不过滤，用户删掉的源会在任何一次订阅往返后复活 —— 与「本地直播线路要留住」同一口径。
   *   仅过滤「墓碑里有」的 key；订阅新增的源照常进列表（被删过的 key 需用户手动添加才会回来）。
   */
  private withoutDeletedSources(sources: SourceBean[], where: string, profileId = this.snap.activeProfileId, config = this.snap): SourceBean[] {
    const result = filterDeletedProfileSources(config, sources, profileId);
    this.logFilteredSources(where, result.filteredSourceKeys);
    return result.sources;
  }

  private logFilteredSources(where: string, keys: readonly string[]): void {
    if (!keys.length) return;
    this.logger.i(`${where}：按「已删除源」墓碑过滤掉 ${keys.length} 个源（${keys.slice(0, 6).join('、')}${keys.length > 6 ? '…' : ''}）`);
  }

}
