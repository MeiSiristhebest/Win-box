import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { client } from '../api/client';
import type { UserConfig, SubscriptionRefreshResolution } from '../../shared/types';
import type { AuditItem } from '../../shared/types';
import { useAppDialog } from '../components/AppDialog';
import { SubscriptionGroupsSection } from '../features/subscriptions/SubscriptionGroupsSection';
import { SavedProfilesSection } from '../features/subscriptions/SavedProfilesSection';
import { AppearanceSection } from '../features/settings/AppearanceSection';
import { AccountServicesSection } from '../features/settings/AccountServicesSection';
import { NetworkSection } from '../features/settings/NetworkSection';
import { PlaybackSettingsSection } from '../features/settings/PlaybackSettingsSection';
import { ShortcutSettingsSection } from '../features/settings/ShortcutSettingsSection';
import { BackupSettingsSection } from '../features/settings/BackupSettingsSection';
import { StorageSettingsSection } from '../features/settings/StorageSettingsSection';
import { SourceHealthAuditSection, type AuditFilter } from '../features/settings/SourceHealthAuditSection';
import { CacheMaintenanceSection } from '../features/settings/CacheMaintenanceSection';
import { SourceManagementSection } from '../features/settings/SourceManagementSection';
import { LiveSourcesSection } from '../features/subscriptions/LiveSourcesSection';
import { SubscriptionImportSection } from '../features/subscriptions/SubscriptionImportSection';
import { useSubscriptionImport } from '../features/subscriptions/useSubscriptionImport';
import { Tabs } from '../components/ui/Tabs';
import { Icon, type IconName } from '../components/ui/Icon';
import { PluginSettingsSection } from '../features/settings/PluginSettingsSection';
import { notifyProfileChanged } from '../lib/configEvents';

type TabId = 'sources' | 'health' | 'profiles' | 'account' | 'storage' | 'appearance' | 'play' | 'shortcut' | 'network' | 'backup' | 'plugins';

const SETTINGS_SECTIONS: { id: TabId; label: string; description: string; keywords: string }[] = [
  { id: 'sources', label: '订阅与源', description: '导入订阅，管理点播站点和直播线路。', keywords: '导入 多仓 单仓 json python txt m3u 地址 文件 直播' },
  { id: 'profiles', label: '配置档案', description: '切换、整理已保存的配置与订阅组。', keywords: '子仓 切换 重命名 订阅组 合并 导出' },
  { id: 'health', label: '源健康与维护', description: '检查站点可用性，清理失效源和缓存。', keywords: '体检 诊断 缓存 清理 失败 检查' },
  { id: 'appearance', label: '外观', description: '调整浅深外观、界面缩放和浏览方式。', keywords: '浅色 深色 主题 字体 缩放 海报 大小 密度 动效 窗口 发现 瀑布' },
  { id: 'play', label: '播放', description: '设置播放器、字幕、弹幕和播放行为。', keywords: '播放器 内核 外部 mpv ffmpeg 字幕 弹幕 去广告 跳过 硬件 音频' },
  { id: 'shortcut', label: '快捷键', description: '调整播放和窗口操作的快捷键。', keywords: '键盘 按键 老板键' },
  { id: 'account', label: '凭据', description: '管理元数据服务和账户凭据。', keywords: '账号 密码 cookie token tmdb 豆瓣 api 密钥 登录' },
  { id: 'storage', label: '存储', description: '添加、检查和管理 WebDAV 连接。', keywords: 'webdav dav 网盘 服务器 用户名 密码 连接' },
  { id: 'network', label: '网络', description: '配置代理和网络访问选项。', keywords: '代理 proxy 请求 超时 连接' },
  { id: 'plugins', label: '插件与组件', description: '管理插件、播放组件和扩展功能。', keywords: '扩展 安装 更新 组件 插件 皮肤' },
  { id: 'backup', label: '备份', description: '备份、恢复和迁移应用配置。', keywords: '恢复 数据 导出 导入 迁移' },
];
const SETTINGS_CARD_TABS: Readonly<Record<string, TabId>> = {
  import: 'sources', sources: 'sources', live: 'sources', lives: 'sources',
  audit: 'health', cache: 'health', merge: 'profiles',
  subtitle: 'account', meta: 'account',
  'plugin-engines': 'play', 'plugin-keymap': 'shortcut',
  motion: 'appearance', 'show-discover': 'appearance', 'ui-scale': 'appearance', 'poster-size': 'appearance', 'nav-mode': 'appearance', 'home-browse': 'appearance',
  'm3u8-purify': 'play', 'bt-player': 'play', 'vod-player': 'play', 'mpv-kernel': 'play',
};

const SETTINGS_ICONS: Record<TabId, IconName> = {
  sources: 'globe', profiles: 'layers', health: 'shield', appearance: 'palette', play: 'play',
  shortcut: 'keyboard', account: 'key', storage: 'storage', network: 'globe', plugins: 'plug', backup: 'archive',
};

export default function ConfigPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section') || '';
  const requestedTab = SETTINGS_SECTIONS.find(item => item.id === requestedSection)?.id
    ?? SETTINGS_CARD_TABS[requestedSection]
    ?? (requestedSection.startsWith('plugin-') ? 'plugins' : undefined);
  const dialog = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<UserConfig | null>(null);
  const [err, setErr] = useState('');
  const [lastOk, setLastOk] = useState('');

  // 档案改名（内联编辑）
  const [mergePick, setMergePick] = useState<Set<string>>(new Set());
  const [mergeMsg, setMergeMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  // 体检
  const [audit, setAudit] = useState<AuditItem[] | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');
  // 多配置档案

  /**
   * 源列表变更后广播 —— 顶栏/侧栏的 SourcePicker 与点播页据此**立即重取**源列表。
   * ★ 2026-09-26（用户反馈「刚导入 JSON 右上角还是显示没有源，得重启才能选」）：
   *   SourcePicker 常驻在 App 里、只在挂载/focus/换源时取列表，导入后不会自己刷新。
   * 事件名沿用本仓库既有约定（裸字符串，同 winbox:source-changed）。
   */
  const SOURCES_CHANGED = 'winbox:sources-changed';

  const refresh = useCallback(async () => {
    const c = await client.cfgGet();
    setCfg(c);
    window.dispatchEvent(new Event(SOURCES_CHANGED));
  }, []);

  const importFlow = useSubscriptionImport({
    busy,
    setBusy,
    setError: setErr,
    setNotice: setLastOk,
    onRefresh: refresh,
  });
  const importRunning = importFlow.importRunning;

  useEffect(() => {
    async function loadInitialConfig() {
      try {
        await refresh();
      } catch (error) {
        setErr((error as Error).message);
      }
    }
    void loadInitialConfig();
  }, [refresh]);

  async function removeSubscriptionGroupMember(groupId: string, memberId: string, name: string) {
    const confirmed = await dialog.confirm(
      `从订阅组移除「${name}」？已保存的子仓档案会保留为独立配置。`,
      { title: '移除订阅组成员', confirmLabel: '移除', tone: 'danger' },
    );
    if (!confirmed) return;
    try {
      await client.cfgRemoveSubscriptionGroupMember(groupId, memberId);
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function resolveSubscriptionGroupRefresh(groupId: string, memberId: string, resolution: SubscriptionRefreshResolution) {
    if (resolution === 'use-upstream') {
      const confirmed = await dialog.confirm('采用上游配置会替换该子仓当前的源、排序和本地改名。继续吗？', {
        title: '采用上游配置',
        confirmLabel: '采用上游配置',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      await client.cfgResolveSubscriptionGroupRefresh(groupId, memberId, resolution);
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  const sources = cfg?.sources ?? [];
  const activeKey = cfg?.ui.activeSourceKey ?? '';

  async function activateProfile(id: string) {
    if (busy || importRunning) return;
    setErr('');
    setBusy(true);
    try { await client.cfgActivateProfile(id); notifyProfileChanged(); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  /** 一键删除体检"失败"（error）的源 —— 仅删除当前管理列表中的源，不触碰任何原始/档案 JSON */
  async function deleteFailedSources() {
    if (!audit) return;
    const failed = audit.filter((a) => a.health === 'error');
    if (!failed.length) { setMergeMsg({ text: '没有体检为「失败/报错」的源可删', kind: 'err' }); return; }
    if (!(await dialog.confirm(`确定删除 ${failed.length} 个体检失败源吗？\n（${failed.slice(0, 6).map((a) => a.name).join('、')}${failed.length > 6 ? '…' : ''}）\n此操作只影响当前列表并写入应用配置，不会改动任何导入的原始 JSON 文件。`, { title: '删除体检失败源', confirmLabel: '删除', tone: 'danger' }))) return;
    setErr('');
    for (const a of failed) {
      try { await client.cfgDeleteSource(a.key); } catch { /* 单个失败继续 */ }
    }
    await refresh();
    const left = (cfg?.sources ?? []).filter((s) => !failed.some((f) => f.key === s.key)).length;
    if (left === 0) {
      setMergeMsg({ text: `已删除全部 ${failed.length} 个失败源（没有剩余源，未生成新配置）`, kind: 'ok' });
    } else {
      // ★ 2026-10-14（用户要求）：不再生成超长的「清理后(N源) MM-DD HH:MM」——
      //   改用**当前档案名**，只把括号里的源数更新为新值（反复清理时只有那个数字变化）。
      //   当前档案的存档 json 已随删除自动同步（见 UserConfigManager.withActiveProfileSynced），
      //   因此直接改名即可，无需再新建一份重复档案。
      const cur = cfg?.profiles.find((p) => p.id === cfg.activeProfileId)?.name || '';
      const base = cur
        .replace(/[（(]\s*\d+\s*源\s*[）)]\s*$/, '') // 已存在的 (N源) 后缀 → 去掉后重填
        .replace(/\s*\d{2}-\d{2}\s+\d{2}:\d{2}\s*$/, '') // 旧版「清理后(…) MM-DD HH:MM」的时间戳
        .replace(/^清理后\s*/, '') // 旧版前缀
        .trim() || '订阅';
      const name = `${base}(${left}源)`;
      if (cfg?.activeProfileId) {
        await client.cfgUpdateProfileName({ id: cfg.activeProfileId, name });
        setMergeMsg({ text: `已删除 ${failed.length} 个失败源；当前配置已更新为「${name}」（源数 ${left}，见上方「已保存配置」）`, kind: 'ok' });
      } else {
        const p = await client.cfgSaveAsProfile(name);
        setMergeMsg({ text: `已删除 ${failed.length} 个失败源；剩余 ${left} 个源已保存为配置「${p.name}」并切换到它（见上方「已保存配置」）`, kind: 'ok' });
      }
    }
    setAudit(null);
    await refresh();
  }

  async function doMergeExport() {
    const ids = [...mergePick];
    if (!ids.length) { setMergeMsg({ text: '请先勾选要合并的配置档案', kind: 'err' }); return; }
    setErr('');
    try {
      const r = await client.mergeExport(ids);
      const sum = r.summary;
      const kept = sum.reduce((a, b) => a + (b.kept ?? 0), 0);
      const total = sum.reduce((a, b) => a + (b.total ?? 0), 0);
      const saved = await client.mergeSave({ content: r.content, defaultName: `merged-subscription-${new Date().toISOString().slice(0, 10)}.json` });
      if (saved.saved) {
        setMergeMsg({ text: `已导出到：${saved.path}（合并 ${sum.length} 个配置 · 去重后 ${kept} 个源 / 原共 ${total} 个）`, kind: 'ok' });
      } else {
        setMergeMsg({ text: '已取消保存（合并内容未落盘，原始文件未受影响）', kind: 'ok' });
      }
    } catch (e) {
      setMergeMsg({ text: `合并失败：${(e as Error).message}`, kind: 'err' });
    }
  }

  async function runAudit() {
    setErr('');
    setAuditBusy(true);
    setAudit(null);
    try {
      const r = await client.audit();
      setAudit(r);
      // 体检后自动刷新（可能新增了 homeFallback 之类影响不大）
    } catch (e) {
      setErr(`体检失败：${(e as Error).message}`);
    } finally {
      setAuditBusy(false);
    }
  }

  // ---- 选项卡（替代原 <a href="#cfg-*"> 锚点跳转，避免 HashRouter 下触发路由跳到空页）----
  const TABS = SETTINGS_SECTIONS.map(item => ({ ...item, icon: <Icon name={SETTINGS_ICONS[item.id]} size={16} /> }));
  const [settingsQuery, setSettingsQuery] = useState('');
  const searchTerm = settingsQuery.trim().toLocaleLowerCase();
  const matchingSections = SETTINGS_SECTIONS.filter(item => `${item.label} ${item.description} ${item.keywords}`.toLocaleLowerCase().includes(searchTerm));
  const CFG_TAB_KEY = 'winbox-cfg-tab';
  // 记住上次打开的选项卡：从配置页跳走再返回时仍停在原 tab
  const [tab, setTab] = useState<TabId>(() => {
    if (requestedTab) return requestedTab;
    try {
      const s = localStorage.getItem(CFG_TAB_KEY) as TabId | null;
      return s && TABS.some((t) => t.id === s) ? s : 'sources';
    } catch {
      return 'sources';
    }
  });
  const [lastRequestedSection, setLastRequestedSection] = useState(requestedSection);
  if (lastRequestedSection !== requestedSection) {
    setLastRequestedSection(requestedSection);
    if (requestedTab) setTab(requestedTab);
    setSettingsQuery('');
  }
  const selectTab = (t: TabId) => {
    setTab(t);
    if (requestedSection) setSearchParams({}, { replace: true });
    try { localStorage.setItem(CFG_TAB_KEY, t); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (!requestedTab) return;
    try { localStorage.setItem(CFG_TAB_KEY, requestedTab); } catch { /* Storage may be disabled. */ }
  }, [requestedTab]);
  useEffect(() => {
    if (!requestedSection || requestedTab !== tab) return;
    const element = document.getElementById(`cfg-${requestedSection}`);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ block: 'start' });
  }, [requestedSection, requestedTab, tab]);

  return (
    <div className="content cfg-content">
      <header className="page-heading cfg-page-heading">
        <div><h1>设置</h1><p>管理内容来源和应用偏好。</p></div>
        <input className="cfg-search" aria-label="搜索设置" placeholder="搜索设置，如字幕、代理" value={settingsQuery} onChange={event => setSettingsQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) setSettingsQuery(''); }} />
      </header>
      <div className="cfg-layout">
      <aside className="cfg-navigation" aria-label="设置分类">
        <Tabs items={TABS} value={tab} onChange={value => { selectTab(value); setSettingsQuery(''); }} orientation="vertical" label="配置分区" idPrefix="config" className="cfg-tab-control" />
      </aside>

      <div className="cfg-panel" id="config-panel" role="tabpanel" aria-labelledby={searchTerm ? 'cfg-results-title' : `config-tab-${tab}`} tabIndex={0}>
        {searchTerm && <section className="cfg-search-results">
          <div className="cfg-section-heading"><h2 id="cfg-results-title">搜索结果</h2><output>找到 {matchingSections.length} 个相关分类</output></div>
          {matchingSections.map(item => <button key={item.id} className="cfg-search-result" onClick={() => { selectTab(item.id); setSettingsQuery(''); requestAnimationFrame(() => document.getElementById('cfg-section-title')?.focus()); }}>
            <strong>{item.label}</strong><span>{item.description}</span><span aria-hidden="true">›</span>
          </button>)}
          {!matchingSections.length && <div className="empty"><h3>没有匹配的设置</h3><p>试试“播放”“订阅”或“网络”等关键词。</p><button onClick={() => setSettingsQuery('')}>清除搜索</button></div>}
        </section>}
        <div className="cfg-section-content" hidden={Boolean(searchTerm)}>
        <div className="cfg-section-heading"><h2 id="cfg-section-title" tabIndex={-1}>{TABS.find(item => item.id === tab)?.label}</h2><p>{TABS.find(item => item.id === tab)?.description}</p></div>
        {err && tab !== 'sources' && <div className="err" role="alert">{err}</div>}
        <SubscriptionImportSection active={tab === 'sources'} flow={importFlow} error={err} notice={lastOk} onErrorClear={() => setErr('')} />

      {/* ===== 一、订阅与源 ===== */}
      <SourceManagementSection
        active={tab === 'sources'}
        sources={sources}
        globallyBlockedKeys={cfg?.globallyBlockedSourceKeys}
        activeSourceKey={activeKey}
        profileId={cfg?.activeProfileId ?? ''}
        busy={busy}
        onRefresh={refresh}
        onError={setErr}
        onNotice={setLastOk}
      />
      <LiveSourcesSection
        active={tab === 'sources'}
        lives={cfg?.lives ?? []}
        activeIndex={cfg?.ui.activeLiveIndex ?? 0}
        onRefresh={refresh}
        onError={setErr}
      />
      {/* ===== 二、源健康与维护 ===== */}
      {tab === 'health' && (
      <>

      <SourceHealthAuditSection
        audit={audit}
        auditBusy={auditBusy}
        filter={auditFilter}
        sources={sources}
        onRunAudit={() => void runAudit()}
        onDeleteFailedSources={() => void deleteFailedSources()}
        onFilterChange={setAuditFilter}
      />
      {/* ===== 三、配置档案 ===== */}
      </>
      )}

      <CacheMaintenanceSection active={tab === 'health'} />

      {/* ===== 三、配置档案 ===== */}
      {tab === 'profiles' && (
      <>
      <SavedProfilesSection
        profiles={cfg?.profiles ?? []}
        activeProfileId={cfg?.activeProfileId ?? ''}
        busy={busy}
        onActivate={(profileId) => { void activateProfile(profileId); }}
        onRefresh={refresh}
        onError={setErr}
      />

      <SubscriptionGroupsSection
        groups={cfg?.subscriptionGroups ?? []}
        profiles={cfg?.profiles ?? []}
        activeProfileId={cfg?.activeProfileId ?? ''}
        busy={busy}
        importRunning={importRunning}
        onRefresh={(groupUrl, groupName) => { void importFlow.startSubscriptionImport(groupUrl, groupName); }}
        onActivate={(profileId) => { void activateProfile(profileId); }}
        onRemoveMember={(groupId, memberId, name) => { void removeSubscriptionGroupMember(groupId, memberId, name); }}
        onResolveRefresh={(groupId, memberId, resolution) => { void resolveSubscriptionGroupRefresh(groupId, memberId, resolution); }}
      />

      {/* 0b) 合并导出（多配置 → 去重 → 新 JSON，不写原文件） */}
      <div className="card" id="cfg-merge" style={{ padding: 12, marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="muted" style={{ fontWeight: 600 }}>合并导出（把多份配置的源合并去重成一份订阅 JSON）</span>
          <button className="primary" disabled={!mergePick.size} onClick={doMergeExport}>合并并另存为…</button>
        </div>
        {cfg?.profiles && cfg.profiles.length > 0 ? (
          <div className="row" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
            {cfg.profiles.map((p) => {
              const checked = mergePick.has(p.id);
              return (
                <label key={p.id} className={`tag ${checked ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    style={{ accentColor: 'var(--accent)', margin: 0 }}
                    checked={checked}
                    onChange={() => {
                      const next = new Set(mergePick);
                      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                      setMergePick(next);
                    }}
                  />
                  {p.name} <span className="muted">({p.sourceCount})</span>
                  {!p.json && <span className="muted" title="该档案来自早期版本，无原始数据可合并">· 无数据</span>}
                </label>
              );
            })}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>没有可合并的档案——先在上方「已保存配置」里存下至少两份配置。</div>
        )}
        {mergeMsg && (
          <div style={{ marginTop: 6, fontSize: 12, color: mergeMsg.kind === 'ok' ? 'var(--text-success)' : 'var(--text-danger)', wordBreak: 'break-all' }}>
            {mergeMsg.text}
          </div>
        )}
      </div>


      {/* ===== 四、凭据 ===== */}
      </>
      )}

      {/* ===== 四、凭据 ===== */}
      <AccountServicesSection active={tab === 'account'} />

      {tab === 'appearance' && <AppearanceSection />}

      {/* ===== 六、播放（去广告） ===== */}
      <PlaybackSettingsSection active={tab === 'play'} />

      {/* ===== 七、快捷键（老板键） ===== */}
      <PluginSettingsSection active={tab === 'plugins'} />
      <ShortcutSettingsSection active={tab === 'shortcut'} />

      <NetworkSection active={tab === 'network'} />

      <StorageSettingsSection active={tab === 'storage'} />
      <BackupSettingsSection active={tab === 'backup'} />
      </div>
      </div>
      </div>
    </div>
  );
}
