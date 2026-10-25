// tests/userConfigManager.spec.ts
// UserConfigApplicationService 单测（任务 B5）：真实 JsonStore 落在临时目录文件上。
// 覆盖：add/delete/move/update/setActive/persist-reload 往返、非法 patch、损坏 JSON 重建、
//      重复 key 拒绝、move 边界、replaceFromImport 全量替换。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/main/store/JsonStore';
import { UserConfigApplicationService, USER_CONFIG_KEY, serializeImport } from '../src/main/store/UserConfigApplicationService';
import { parseSubscriptionSourceOverrides } from '../src/main/store/subscriptionProfileMerge';
import { parseSiteConfig } from '../src/engine/config/ApiConfigParser';
import { NullLogger } from '../src/engine/util/logger';
import type { SiteConfig, SourceBean, SourceUpdatePatch, LiveBean } from '../src/shared/types';
import type { SubscriptionGroup, UserProfile } from '../src/shared/types';

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ucm-'));
  dirs.push(d);
  return d;
}

function bean(key: string, type = 0, api = 'https://x/api.php/provide/vod'): SourceBean {
  return { key, name: key, type, api } as SourceBean;
}

function newUserConfigService(dir: string): UserConfigApplicationService {
  const store = new JsonStore(join(dir, 'user-config.json'));
  return new UserConfigApplicationService(store, NullLogger);
}

function fullConfig(sources: SourceBean[]): SiteConfig {
  return {
    sites: sources,
    parses: [],
    lives: [],
    flags: [],
    spider: 'https://x/global.jar',
    jarCache: 'true',
    danmaku: '',
    wallpaper: '',
    hosts: {},
    rules: [],
    doh: [],
    ads: [],
    proxy: [],
  };
}

describe('source deletions belong to one child profile', () => {
  it('global blocks preserve snapshots and apply to existing and future profiles until explicitly removed', () => {
    const directory = tmpDir();
    const manager = newUserConfigService(directory);
    manager.replaceFromImport(fullConfig([bean('shared'), bean('a')]), 'https://a.test/config');
    const first = manager.activeProfileId();
    const second = manager.saveAsProfile('B', { parsed: fullConfig([bean('shared'), bean('b')]), apiUrl: 'https://b.test/config' });
    manager.setGlobalSourceBlock(['shared'], true);
    expect(manager.sources().map(item => item.key)).toEqual(['b']);
    expect(manager.snapshot().sources.map(item => item.key)).toContain('shared');
    expect(manager.profileSitesView().profiles.every(profile => !profile.sites.some(source => source.key === 'shared'))).toBe(true);
    expect(manager.profileConfig(first)?.sites.map(item => item.key)).toEqual(['a']);
    manager.activateProfile(first);
    expect(manager.sources().map(item => item.key)).toEqual(['a']);
    manager.saveAsProfile('C', { parsed: fullConfig([bean('shared'), bean('c')]), apiUrl: 'https://c.test/config' });
    expect(manager.sources().map(item => item.key)).toEqual(['c']);
    const restarted = newUserConfigService(directory);
    restarted.load();
    expect(restarted.sources().map(item => item.key)).toEqual(['c']);
    restarted.setGlobalSourceBlock(['shared'], false);
    expect(restarted.sources().map(item => item.key)).toEqual(['shared', 'c']);
    restarted.activateProfile(second.id);
    expect(restarted.sources().map(item => item.key)).toEqual(['shared', 'b']);
    expect(restarted.snapshot().deletedSourceKeys).toEqual([]);
  });

  it('unblocking does not restore a source deleted only from the active profile', () => {
    const manager = newUserConfigService(tmpDir());
    manager.replaceFromImport(fullConfig([bean('shared')]), 'https://a.test/config');
    const first = manager.activeProfileId();
    manager.saveAsProfile('B', { parsed: fullConfig([bean('shared')]), apiUrl: 'https://b.test/config' });
    manager.deleteSource('shared');
    manager.setGlobalSourceBlock(['shared'], true);
    manager.setGlobalSourceBlock(['shared'], false);
    expect(manager.sources()).toEqual([]);
    manager.activateProfile(first);
    expect(manager.sources().map(item => item.key)).toEqual(['shared']);
  });

  it('deleting a shared key in B preserves A across switching and restart', () => {
    const directory = tmpDir();
    const manager = newUserConfigService(directory);
    manager.replaceFromImport(fullConfig([bean('shared'), bean('a')]), 'https://a.test/config');
    const first = manager.activeProfileId();
    const second = manager.saveAsProfile('B', { parsed: fullConfig([bean('shared'), bean('b')]), apiUrl: 'https://b.test/config' });
    manager.deleteSource('shared');
    expect(manager.snapshot().deletedSourceKeys).toEqual(['shared']);
    manager.activateProfile(first);
    expect(manager.sources().map(item => item.key)).toEqual(['shared', 'a']);
    expect(manager.snapshot().deletedSourceKeys).toEqual([]);
    const restarted = newUserConfigService(directory);
    restarted.load();
    restarted.activateProfile(second.id);
    expect(restarted.sources().map(item => item.key)).toEqual(['b']);
    expect(restarted.snapshot().deletedSourceKeys).toEqual(['shared']);
    restarted.activateProfile(first);
    expect(restarted.sources().map(item => item.key)).toContain('shared');
  });

  it('legacy global records migrate only to the saved active profile', () => {
    const directory = tmpDir();
    const manager = newUserConfigService(directory);
    manager.replaceFromImport(fullConfig([bean('shared'), bean('a')]), 'https://a.test/config');
    const first = manager.activeProfileId();
    manager.saveAsProfile('B', { parsed: fullConfig([bean('shared'), bean('b')]), apiUrl: 'https://b.test/config' });
    const legacy = manager.snapshot();
    legacy.version = 3;
    legacy.deletedSourceKeys = ['shared'];
    delete legacy.deletedSourceKeysByProfile;
    const store = new JsonStore(join(directory, 'legacy.json'));
    store.setObject(USER_CONFIG_KEY, legacy);
    store.flushStrict();
    const restored = new UserConfigApplicationService(store, NullLogger);
    restored.load();
    expect(restored.snapshot().deletedSourceKeys).toEqual(['shared']);
    restored.activateProfile(first);
    expect(restored.sources().map(item => item.key)).toContain('shared');
    expect(restored.snapshot().deletedSourceKeys).toEqual([]);
  });

  it('clearing or manually adding the same key in another profile cannot clear B deletion', () => {
    const manager = newUserConfigService(tmpDir());
    manager.replaceFromImport(fullConfig([bean('shared')]), 'https://a.test/config');
    const first = manager.activeProfileId();
    const second = manager.saveAsProfile('B', { parsed: fullConfig([bean('shared'), bean('b')]) });
    manager.deleteSource('shared');
    manager.activateProfile(first);
    manager.clearDeletedSourceKeys(['shared']);
    manager.activateProfile(second.id);
    expect(manager.snapshot().deletedSourceKeys).toEqual(['shared']);
    manager.addSource(bean('shared'));
    expect(manager.snapshot().deletedSourceKeys).toEqual([]);
  });
});

afterEach(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  dirs.length = 0;
});

describe('UserConfigApplicationService — 变更类别（★ 2026-09-27 切源不再触发重活）', () => {
  /** 记录每次 onChange 的 kind */
  function spyKinds(m: UserConfigApplicationService): string[] {
    const kinds: string[] = [];
    m.setOnChange((_snap, kind) => kinds.push(kind));
    return kinds;
  }

  it('★ setActiveSource / setActiveLiveIndex → kind = "ui"（宿主据此跳过热活）', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.addSource(bean('b'));
    // 先建两条 live 以便真正切换线路（默认 activeLiveIndex=0，切到自己不产生变更）
    m.replaceFromImport(
      {
        sites: [bean('a'), bean('b')],
        lives: [
          { name: 'L1', type: '0', url: 'https://x/l1.m3u', api: '', ext: '', jar: '', epg: '', playerType: '', timeout: 10 },
          { name: 'L2', type: '0', url: 'https://x/l2.m3u', api: '', ext: '', jar: '', epg: '', playerType: '', timeout: 10 },
        ],
        parses: [],
        flags: [],
        spider: '',
        jarCache: 'true',
        danmaku: '',
        wallpaper: '',
        hosts: {},
        rules: [],
        doh: [],
        ads: [],
        proxy: [],
      },
      '',
    );
    const kinds = spyKinds(m);
    m.setActiveSource('b');
    expect(kinds).toEqual(['ui']);

    kinds.length = 0;
    m.setActiveLiveIndex(1);
    expect(kinds).toEqual(['ui']);

    // 选中同一个源 → 连事件都不发（早退）
    kinds.length = 0;
    m.setActiveSource('b');
    expect(kinds).toEqual([]);
  });

  it('★ 真正的配置变更仍报 "content"（源/解析/直播/全局）', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    const kinds = spyKinds(m);
    m.addSource(bean('b'));
    m.updateSource('b', { name: 'B2' } as SourceUpdatePatch);
    m.moveSource('b', 'up');
    m.deleteSource('a');
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    expect(kinds.every((k) => k === 'content')).toBe(true);
  });

  it('切源只动 ui.*，其余字段一字不变（宿主因此可以安全跳过重放）', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.addSource(bean('b'));
    const before = m.snapshot();
    m.setActiveSource('b');
    const after = m.snapshot();
    expect(after.ui.activeSourceKey).toBe('b');
    expect(after.sources).toEqual(before.sources);
    expect(after.parses).toEqual(before.parses);
    expect(after.global).toEqual(before.global);
  });
});

describe('UserConfigApplicationService — 多仓快照提交', () => {
  it('持久化失败时恢复提交前的订阅组和配置版本', () => {
    const dir = tmpDir();
    const store = new JsonStore(join(dir, 'user-config.json'));
    const manager = new UserConfigApplicationService(store, NullLogger);
    manager.replaceFromImport(fullConfig([bean('active')]), 'https://example.test/active.json');
    const previous = manager.snapshot();
    const previousRevision = manager.revision;
    const flushStrict = store.flushStrict.bind(store);
    let failOnce = true;
    store.flushStrict = () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('disk write failed');
      }
      flushStrict();
    };
    const now = new Date().toISOString();
    const group: SubscriptionGroup = {
      id: 'failed-commit',
      name: '提交失败',
      url: 'https://example.test/group.json',
      status: 'complete',
      createdAt: now,
      updatedAt: now,
      members: [],
    };

    expect(() => manager.commitSubscriptionGroup(group, [])).toThrow('disk write failed');
    expect(manager.snapshot()).toEqual(previous);
    expect(manager.revision).toBe(previousRevision);
    expect(store.getObject(USER_CONFIG_KEY, null)).toEqual(previous);
    const reloaded = newUserConfigService(dir);
    expect(reloaded.load()).toBe(true);
    // Loading normalizes legacy or partial SourceBean records with defaults.
    // The strict raw store equality above checks rollback; after reload, check
    // that every saved pre-commit field is still present.
    expect(reloaded.snapshot()).toMatchObject(previous);
  });

  it('配置版本变化后拒绝提交过期多仓结果', () => {
    const manager = newUserConfigService(tmpDir());
    manager.replaceFromImport(fullConfig([bean('before')]), 'https://example.test/active.json');
    const expectedRevision = manager.revision;
    const now = new Date().toISOString();
    const group: SubscriptionGroup = {
      id: 'stale-group',
      name: '过期组',
      url: 'https://example.test/group.json',
      status: 'complete',
      createdAt: now,
      updatedAt: now,
      members: [],
    };

    manager.addSource(bean('user-change'));
    const beforeCommit = manager.snapshot();
    expect(() => manager.commitSubscriptionGroup(group, [], undefined, expectedRevision)).toThrow('配置已在导入期间更改');
    expect(manager.snapshot()).toEqual(beforeCommit);
    expect(manager.snapshot().subscriptionGroups).toEqual([]);
  });

  it('失败与已移除成员保留旧快照；确认移除只解除分组关联', () => {
    const manager = newUserConfigService(tmpDir());
    manager.replaceFromImport(fullConfig([bean('active')]), 'https://example.test/active.json');
    const before = manager.snapshot();
    const previous = manager.rawProfiles().find((profile) => profile.id === before.activeProfileId)!;
    const now = new Date().toISOString();
    const group: SubscriptionGroup = {
      id: 'group',
      name: '测试组',
      url: 'https://example.test/group.json',
      status: 'partial',
      createdAt: now,
      updatedAt: now,
      members: [{
        id: 'member',
        profileId: previous.id,
        name: previous.name,
        url: previous.apiUrl,
        status: 'pending-removal',
        error: '该成员已从父清单移除',
      }],
    };

    manager.commitSubscriptionGroup(group, []);
    const after = manager.snapshot();
    expect(after.activeProfileId).toBe(before.activeProfileId);
    expect(after.sources.map((source) => source.key)).toEqual(['active']);
    expect(after.profiles.find((profile) => profile.id === previous.id)).toEqual(previous);
    expect(after.subscriptionGroups[0].members[0]).toMatchObject({ profileId: previous.id, status: 'pending-removal' });

    manager.removeSubscriptionGroupMember('group', 'member');
    const detached = manager.rawProfiles().find((profile) => profile.id === previous.id)!;
    expect(detached.json).toBe(previous.json);
    expect(detached.groupId).toBeUndefined();
    expect(manager.snapshot().subscriptionGroups[0].members).toEqual([]);
    expect(manager.snapshot().activeProfileId).toBe(before.activeProfileId);
  });

  it('同名 key 的两个子仓仍保存为独立快照', () => {
    const manager = newUserConfigService(tmpDir());
    const now = new Date().toISOString();
    const profiles: UserProfile[] = [
      { id: 'child-a', name: '仓 A', apiUrl: 'https://a.test/config.json', json: JSON.stringify({ sites: [{ key: 'same', name: 'A', type: 0, api: 'https://a.test/api' }] }), sourceCount: 1, importedAt: now, groupId: 'group', memberId: 'a' },
      { id: 'child-b', name: '仓 B', apiUrl: 'https://b.test/config.json', json: JSON.stringify({ sites: [{ key: 'same', name: 'B', type: 0, api: 'https://b.test/api' }] }), sourceCount: 1, importedAt: now, groupId: 'group', memberId: 'b' },
    ];
    const group: SubscriptionGroup = {
      id: 'group', name: '测试组', url: 'https://example.test/group.json', status: 'complete', createdAt: now, updatedAt: now,
      members: profiles.map((profile) => ({ id: profile.memberId!, profileId: profile.id, name: profile.name, url: profile.apiUrl, status: 'ready' })),
    };

    manager.commitSubscriptionGroup(group, profiles);
    const saved = manager.rawProfiles().filter((profile) => profile.groupId === 'group');
    expect(saved.map((profile) => profile.id).sort()).toEqual(['child-a', 'child-b']);
    expect(saved.map((profile) => profile.json)).toEqual(profiles.map((profile) => profile.json));
  });

  it('活动子仓的手动修改单独记录，刷新基线保持不变', () => {
    const dir = tmpDir();
    const manager = newUserConfigService(dir);
    const now = new Date().toISOString();
    const upstream = fullConfig([bean('a'), bean('b')]);
    const upstreamJson = serializeImport(upstream);
    const profile: UserProfile = {
      id: 'child', name: '子仓', apiUrl: 'https://example.test/child.json',
      json: upstreamJson, upstreamJson, sourceCount: 2, importedAt: now,
      groupId: 'group', memberId: 'member',
    };
    const group: SubscriptionGroup = {
      id: 'group', name: '父仓', url: 'https://example.test/group.json', status: 'complete',
      createdAt: now, updatedAt: now,
      members: [{ id: 'member', profileId: profile.id, name: profile.name, url: profile.apiUrl, status: 'ready' }],
    };

    manager.commitSubscriptionGroup(group, [profile], profile.id);
    manager.updateSource('a', { name: '固定名称' });
    manager.deleteSource('b');
    manager.addSource(bean('local'));
    manager.moveSource('local', 'top');

    const stored = manager.rawProfiles().find((item) => item.id === profile.id)!;
    const overrides = parseSubscriptionSourceOverrides(stored.sourceOverridesJson);
    expect(stored.upstreamJson).toBe(upstreamJson);
    expect(parseSiteConfig(stored.json).config.sites.map((item) => item.key)).toEqual(['local', 'a']);
    expect(overrides?.order).toEqual(['local', 'a']);
    expect(overrides?.deletedKeys).toEqual(['b']);
    expect(overrides?.additions.map((item) => item.key)).toEqual(['local']);
    expect(overrides?.patches).toEqual([{ key: 'a', values: { name: '固定名称' }, removedFields: [] }]);

    const reloaded = newUserConfigService(dir);
    expect(reloaded.load()).toBe(true);
    const restored = reloaded.rawProfiles().find((item) => item.id === profile.id)!;
    expect(restored.upstreamJson).toBe(upstreamJson);
    expect(parseSubscriptionSourceOverrides(restored.sourceOverridesJson)?.deletedKeys).toEqual(['b']);
  });

  it('旧子仓首次刷新先保留当前配置，用户确认后才建立基线', () => {
    const dir = tmpDir();
    const manager = newUserConfigService(dir);
    const now = new Date().toISOString();
    const current = fullConfig([bean('a'), bean('legacy-only')]);
    current.sites[0].name = '本地改名';
    const upstream = fullConfig([bean('a'), bean('fresh')]);
    upstream.sites[0].name = '上游名称';
    const pendingUpstreamJson = serializeImport(upstream);
    const profile: UserProfile = {
      id: 'legacy-child', name: '旧子仓', apiUrl: 'https://example.test/child.json',
      json: serializeImport(current), pendingUpstreamJson, sourceCount: 2, importedAt: now,
      groupId: 'legacy-group', memberId: 'legacy-member',
    };
    const group: SubscriptionGroup = {
      id: 'legacy-group', name: '旧父仓', url: 'https://example.test/group.json', status: 'partial',
      createdAt: now, updatedAt: now,
      members: [{
        id: 'legacy-member', profileId: profile.id, name: profile.name, url: profile.apiUrl, status: 'needs-review',
        refreshDiff: { addedKeys: ['fresh'], removedKeys: ['legacy-only'], changed: [{ key: 'a', fields: ['name'] }] },
      }],
    };

    manager.commitSubscriptionGroup(group, [profile], profile.id);
    const afterRestart = newUserConfigService(dir);
    expect(afterRestart.load()).toBe(true);
    expect(afterRestart.snapshot().sources.map((source) => source.key)).toEqual(['a', 'legacy-only']);
    expect(afterRestart.snapshot().subscriptionGroups[0].members[0].refreshDiff?.addedKeys).toEqual(['fresh']);
    afterRestart.resolveSubscriptionGroupMemberRefresh(group.id, 'legacy-member', 'keep-current');

    const saved = afterRestart.rawProfiles().find((item) => item.id === profile.id)!;
    const resolved = parseSiteConfig(saved.json).config;
    const member = afterRestart.snapshot().subscriptionGroups[0].members[0];
    expect(resolved.sites.map((source) => source.key)).toEqual(['a', 'legacy-only']);
    expect(resolved.sites[0].name).toBe('本地改名');
    expect(saved.upstreamJson).toBe(pendingUpstreamJson);
    expect(saved.pendingUpstreamJson).toBeUndefined();
    expect(member.refreshDiff).toBeUndefined();
    expect(parseSubscriptionSourceOverrides(saved.sourceOverridesJson)).toMatchObject({
      deletedKeys: ['fresh'],
      additions: [{ key: 'legacy-only' }],
      patches: [{ key: 'a', values: { name: '本地改名' } }],
    });
  });

  it('首次刷新选择上游配置会替换旧源并清除本地覆盖', () => {
    const manager = newUserConfigService(tmpDir());
    const now = new Date().toISOString();
    const current = serializeImport(fullConfig([bean('old')]));
    const upstream = serializeImport(fullConfig([bean('new')]));
    const profile: UserProfile = {
      id: 'child', name: '子仓', apiUrl: 'https://example.test/child.json',
      json: current, pendingUpstreamJson: upstream, sourceCount: 1, importedAt: now,
      groupId: 'group', memberId: 'member',
    };
    const group: SubscriptionGroup = {
      id: 'group', name: '父仓', url: 'https://example.test/group.json', status: 'partial',
      createdAt: now, updatedAt: now,
      members: [{ id: 'member', profileId: profile.id, name: profile.name, url: profile.apiUrl, status: 'needs-review', refreshDiff: { addedKeys: ['new'], removedKeys: ['old'], changed: [] } }],
    };
    manager.commitSubscriptionGroup(group, [profile], profile.id);

    manager.resolveSubscriptionGroupMemberRefresh(group.id, 'member', 'use-upstream');

    expect(manager.snapshot().sources.map((source) => source.key)).toEqual(['new']);
    const saved = manager.rawProfiles().find((item) => item.id === profile.id)!;
    expect(saved.upstreamJson).toBe(upstream);
    expect(saved.pendingUpstreamJson).toBeUndefined();
    expect(parseSubscriptionSourceOverrides(saved.sourceOverridesJson)).toMatchObject({
      deletedKeys: [],
      additions: [],
      patches: [],
    });
  });
});

describe('UserConfigApplicationService — 增删改排序与选中', () => {
  it('addSource 后 snapshot 有序返回；重复 key 拒绝并抛中文错', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.addSource(bean('b'));
    expect(m.sources().map((s) => s.key)).toEqual(['a', 'b']);
    expect(() => m.addSource(bean('a'))).toThrow(/已存在/);
  });

  it('addSource 会经 parseSite 归一化：缺 api → 拒绝', () => {
    const m = newUserConfigService(tmpDir());
    expect(() => m.addSource({ key: 'x', type: 0 } as SourceBean)).toThrow(/校验失败|缺少必填/);
  });

  it('deleteSource 删除；删到当前选中源时清空 activeSourceKey', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.addSource(bean('b'));
    m.setActiveSource('b');
    expect(m.activeSourceKey()).toBe('b');
    m.deleteSource('b');
    expect(m.activeSourceKey()).toBe('');
    expect(m.sources().map((s) => s.key)).toEqual(['a']);
  });

  it('deleteSources 一次删除多个源，并只触发一次 content 变更', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.addSource(bean('b'));
    m.addSource(bean('c'));
    m.setActiveSource('b');
    const kinds: string[] = [];
    m.setOnChange((_snap, kind) => kinds.push(kind));
    m.deleteSources(['a', 'b', 'missing']);
    expect(m.sources().map((s) => s.key)).toEqual(['c']);
    expect(m.activeSourceKey()).toBe('');
    expect(kinds).toEqual(['content']);
  });

  /**
   * ★ 2026-10-15（用户报「配置里删掉的源，换源下拉里还在」）：
   *   订阅是"全量替换"语义 → 删掉的源会在任何一次订阅往返（导入 / 启动 7 天自动刷新 / 档案切换）后复活。
   *   修法 = 记「已删除源」墓碑（UserConfig.deletedSourceKeys），往返时按它过滤。
   */
  describe('已删除源墓碑（★ 2026-10-15 用户报「删了还在」）', () => {
    it('删掉的源不会被「订阅往返」带回来（replaceFromImport 全量替换后仍不在）', () => {
      const m = newUserConfigService(tmpDir());
      m.replaceFromImport(fullConfig([bean('a'), bean('b'), bean('c')]), 'https://h/s.json');
      m.deleteSource('b');
      expect(m.sources().map((s) => s.key)).toEqual(['a', 'c']);
      // 同一份订阅再导入一次（= 启动时 7 天自动刷新走的同一条路径）
      m.replaceFromImport(fullConfig([bean('a'), bean('b'), bean('c')]), 'https://h/s.json');
      expect(m.sources().map((s) => s.key)).toEqual(['a', 'c']);
      // 档案存档 json 也不含它（换源弹层/后续切换都读不到）
      expect(m.profileSitesView().profiles[0].sites.map((s) => s.key)).toEqual(['a', 'c']);
    });

    it('切换档案（从存档 json 全量重建）同样按墓碑过滤', () => {
      const m = newUserConfigService(tmpDir());
      m.replaceFromImport(fullConfig([bean('a'), bean('b')]), 'https://h/one.json');
      const first = m.activeProfileId();
      m.deleteSource('b');
      m.saveAsProfile('配置二', { parsed: fullConfig([bean('x1'), bean('x2')]), apiUrl: 'https://h/two.json' });
      // 切回旧档案：其存档 json 里带着 b，但墓碑要把它挡掉
      m.activateProfile(first);
      expect(m.sources().map((s) => s.key)).toEqual(['a']);
    });

    it('手动重新添加同一 key = 明确要它回来 → 墓碑清除，后续往返不再被挡', () => {
      const m = newUserConfigService(tmpDir());
      m.replaceFromImport(fullConfig([bean('a'), bean('b')]), 'https://h/s.json');
      m.deleteSource('b');
      expect(m.snapshot().deletedSourceKeys).toEqual(['b']);
      m.addSource(bean('b'));
      expect(m.snapshot().deletedSourceKeys).toEqual([]);
      m.replaceFromImport(fullConfig([bean('a'), bean('b')]), 'https://h/s.json');
      expect(m.sources().map((s) => s.key)).toEqual(['a', 'b']);
    });

    it('墓碑落盘：重启读取后仍在（不会被 normalizeLoaded 丢掉）', () => {
      const dir = tmpDir();
      const m = newUserConfigService(dir);
      m.replaceFromImport(fullConfig([bean('a'), bean('b')]), 'https://h/s.json');
      m.deleteSource('b');
      m.replaceFromImport(fullConfig([bean('a'), bean('b')]), 'https://h/s.json');
      const m2 = newUserConfigService(dir);
      m2.load();
      expect(m2.snapshot().deletedSourceKeys).toEqual(['b']);
      m2.replaceFromImport(fullConfig([bean('a'), bean('b')]), 'https://h/s.json');
      expect(m2.sources().map((s) => s.key)).toEqual(['a']);
    });

    it('删除未收录的 key 是 no-op，不写墓碑（避免墓碑无端膨胀）', () => {
      const m = newUserConfigService(tmpDir());
      m.replaceFromImport(fullConfig([bean('a')]), 'https://h/s.json');
      m.deleteSource('不存在');
      expect(m.snapshot().deletedSourceKeys).toEqual([]);
    });

    /**
     * ★ 2026-10-16（用户报「本地包删掉订阅后重新导入、订阅里一个源都没有」）：
     *   用户**主动重新导入**该订阅 = 「我要这份订阅」的明确意图 → 导入前先清掉这些 key 的墓碑；
     *   后台自动刷新不清墓碑 ⇒ 「删掉的不被刷新带回来」口径不变。
     */
    it('clearDeletedSourceKeys 只清指定 key，其余墓碑保留（主动重导用）', () => {
      const m = newUserConfigService(tmpDir());
      m.replaceFromImport(fullConfig([bean('a'), bean('b'), bean('c')]), 'https://h/s.json');
      m.deleteSources(['a', 'b']);
      expect(m.snapshot().deletedSourceKeys).toEqual(['a', 'b']);
      m.clearDeletedSourceKeys(['a', '不存在']);
      expect(m.snapshot().deletedSourceKeys).toEqual(['b']);
      // 清过墓碑的 'a' 能回来；没清的 'b' 仍被过滤（= 自动刷新口径未被改动）
      m.replaceFromImport(fullConfig([bean('a'), bean('b'), bean('c')]), 'https://h/s.json');
      expect(m.sources().map((s) => s.key)).toEqual(['a', 'c']);
    });

    it('clearDeletedSourceKeys 无墓碑/无变化时不触发 content 变更（不写盘）', () => {
      const m = newUserConfigService(tmpDir());
      m.replaceFromImport(fullConfig([bean('a')]), 'https://h/s.json');
      const kinds: string[] = [];
      m.setOnChange((_snap, kind) => kinds.push(kind));
      m.clearDeletedSourceKeys(['a']); // 当前无墓碑 → no-op
      expect(kinds).toEqual([]);
      m.deleteSource('a');
      expect(kinds).toEqual(['content']);
      const before = m.snapshot().deletedSourceKeys;
      m.clearDeletedSourceKeys(['不存在']); // 无交集 → 不再写盘
      expect(m.snapshot().deletedSourceKeys).toEqual(before);
      expect(kinds).toEqual(['content']);
    });
  });

  it('moveSource：up/down/top/bottom 排序正确；边界 no-op 不抛', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.addSource(bean('b'));
    m.addSource(bean('c'));
    m.moveSource('c', 'top');
    expect(m.sources().map((s) => s.key)).toEqual(['c', 'a', 'b']);
    m.moveSource('c', 'down');
    expect(m.sources().map((s) => s.key)).toEqual(['a', 'c', 'b']);
    m.moveSource('b', 'bottom');
    expect(m.sources().map((s) => s.key)).toEqual(['a', 'c', 'b']);
    m.moveSource('a', 'up'); // 已在顶部 → no-op
    expect(m.sources().map((s) => s.key)).toEqual(['a', 'c', 'b']);
    m.moveSource('missing', 'up'); // 不存在 → no-op
    m.moveSource('a', 'down');
    expect(m.sources().map((s) => s.key)).toEqual(['c', 'a', 'b']);
  });

  it('updateSource：只改白名单字段；key/type/api 不可改（抛）', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a', 0));
    m.updateSource('a', { name: '改名', timeout: 30, searchable: 0 } as SourceUpdatePatch);
    const s = m.sources()[0];
    expect(s.name).toBe('改名');
    expect(s.timeout).toBe(30);
    expect(s.searchable).toBe(0);
    expect(() => m.updateSource('a', { key: 'b' } as SourceUpdatePatch)).toThrow(/不可修改/);
    expect(() => m.updateSource('a', { type: 1 } as SourceUpdatePatch)).toThrow(/不可修改/);
    expect(() => m.updateSource('a', { api: 'https://x/other' } as SourceUpdatePatch)).toThrow(/不可修改/);
  });

  it('setActiveSource：存在才生效；不存在忽略', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('a'));
    m.setActiveSource('a');
    expect(m.activeSourceKey()).toBe('a');
    m.setActiveSource('nope');
    expect(m.activeSourceKey()).toBe('a');
  });

  it('setActiveLiveIndex 越界 clamp；lives 为空 → 0', () => {
    const m = newUserConfigService(tmpDir());
    m.setActiveLiveIndex(99);
    expect(m.activeLiveIndex()).toBe(0);
    m.replaceFromImport(fullConfig([]), '');
  });
});

describe('UserConfigApplicationService — replaceFromImport 全量替换', () => {
  it('sources/lives/global 被替换；active 源消失则清空', () => {
    const m = newUserConfigService(tmpDir());
    m.addSource(bean('old'));
    m.setActiveSource('old');
    const cfg = fullConfig([bean('n1'), bean('n2', 1, 'https://x2/vod.json')]);
    cfg.lives = [{ name: '线路1', api: 'https://x/live.m3u', type: '0', url: '', jar: '', ext: '', epg: '', playerType: '', timeout: 15 }];
    m.replaceFromImport(cfg, 'https://sub.example/config.json');
    expect(m.activeSourceKey()).toBe('');
    expect(m.sources().map((s) => s.key)).toEqual(['n1', 'n2']);
    expect(m.lives().length).toBe(1);
    expect(m.snapshot().apiUrl).toBe('https://sub.example/config.json');
    expect(m.snapshot().global.spider).toBe('https://x/global.jar');
  });
});

describe('UserConfigApplicationService — parses（解析接口）持久化', () => {
  it('replaceFromImport 保存 parses（滤掉合成超级解析）；重载后仍在；档案切换可恢复', () => {
    const dir = tmpDir();
    const cfg = fullConfig([bean('p1')]);
    cfg.parses = [
      { name: '超级解析', url: 'http://127.0.0.1:9978/jiexi?url=', ext: '', type: 4 },
      { name: 'jx1', url: 'https://jx.example/?url=', ext: '', type: 0 },
      { name: 'jx2', url: 'https://jx2.example/api', ext: '', type: 1 },
    ];
    const m = newUserConfigService(dir);
    m.replaceFromImport(cfg, 'https://sub.example/c.json');
    // 合成的 type=4 不落库（避免往返时被 parseParses 反复 unshift 出重复项）
    expect(m.snapshot().parses.map((p) => p.name)).toEqual(['jx1', 'jx2']);

    const m2 = newUserConfigService(dir);
    expect(m2.load()).toBe(true);
    expect(m2.snapshot().parses.map((p) => p.name)).toEqual(['jx1', 'jx2']);

    // 切走再切回：档案 JSON 里也带着 parses（可离线重建）
    const m3 = newUserConfigService(dir);
    m3.load();
    const first = m3.profiles()[0].id;
    m3.saveAsProfile('临时');
    m3.activateProfile(first);
    expect(m3.snapshot().parses.map((p) => p.name)).toEqual(['jx1', 'jx2']);
  });
});

describe('UserConfigApplicationService — 持久化往返与损坏恢复', () => {
  it('变更即写盘：新 manager 实例 load 后恢复同源列表与选中源', () => {
    const dir = tmpDir();
    const m1 = newUserConfigService(dir);
    m1.addSource(bean('a'));
    m1.addSource(bean('b'));
    m1.updateSource('a', { name: 'A源' });
    m1.moveSource('b', 'top');
    m1.setActiveSource('b');

    const m2 = newUserConfigService(dir);
    expect(m2.load()).toBe(true);
    expect(m2.sources().map((s) => [s.key, s.name])).toEqual([['b', 'b'], ['a', 'A源']]);
    expect(m2.activeSourceKey()).toBe('b');
  });

  it('整文件 JSON 损坏：备份 .corrupt-* 后用默认空档重建（不静默丢数据）', () => {
    const dir = tmpDir();
    const file = join(dir, 'user-config.json');
    writeFileSync(file, '{ 这不是合法 JSON !!', 'utf-8');

    const store = new JsonStore(file);
    expect(store.corrupted).toBe(true);
    const backups = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBe(1);

    const m = newUserConfigService(dir);
    expect(m.load()).toBe(false); // 损坏后重建为空档
    expect(m.sources()).toEqual([]);

    // 重建路径可用：addSource 后写回新文件，再 reload 能读到
    m.addSource(bean('reborn'));
    const m2 = newUserConfigService(dir);
    expect(m2.load()).toBe(true);
    expect(m2.sources()[0].key).toBe('reborn');
  });

  it('未持久化过：load() 返回 false，sources 为空', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    expect(m.load()).toBe(false);
    expect(m.sources()).toEqual([]);
  });

  it('坏 source 条目在 load 时被剔除并可用 parseSite 校验日志说明', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.addSource(bean('good'));
    // 手动在 store 里塞一条缺 api 的坏源
    const store = new JsonStore(join(dir, 'user-config.json'));
    const snap = store.getObject<{ sources: unknown[] }>(USER_CONFIG_KEY, { sources: [] });
    snap.sources.push({ key: 'bad', type: 0 });
    store.setObject(USER_CONFIG_KEY, snap as never);
    store.flush();

    const m2 = newUserConfigService(dir);
    expect(m2.load()).toBe(true);
    expect(m2.sources().map((s) => s.key)).toEqual(['good']);
  });
});

describe('UserConfigApplicationService v2 — 多配置档案（profiles）', () => {
  it('导入（URL）自动建档；存为新档案可离线切换；激活后恢复源列表', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    const cfgA = fullConfig([bean('a1'), bean('a2')]);
    m.replaceFromImport(cfgA, 'https://host/a.json');
    expect(m.activeProfileId()).not.toBe('');
    expect(m.profiles().length).toBe(1);
    expect(m.sources().length).toBe(2);

    // 存 B 档案（当前仍是 A 的内容；saveAsProfile 会把当前状态快照成新档案）
    const pb = m.saveAsProfile('配置B');
    expect(m.activeProfileId()).toBe(pb.id);
    expect(m.profiles().length).toBe(2);

    // 切换回 A：A 的 json 是导入时存下的 a1/a2
    const aId = m.profiles()[0].id;
    m.activateProfile(aId);
    expect(m.activeProfileId()).toBe(aId);
    expect(m.sources().map((s) => s.key)).toEqual(['a1', 'a2']);
  });

  it('重载后档案与选中源恢复（重启等价）', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.replaceFromImport(fullConfig([bean('x1'), bean('x2')]), 'https://h/x.json');
    const x1 = m.sources()[0];
    m.setActiveSource(x1.key);
    m.saveAsProfile('二次配置'); // active 移到新档案
    m.activateProfile(m.profiles()[0].id);
    m.setActiveSource('x1');

    const m2 = newUserConfigService(dir);
    expect(m2.load()).toBe(true);
    expect(m2.profiles().length).toBe(2);
    expect(m2.activeSourceKey()).toBe('x1');
    m2.activateProfile(m2.profiles()[1].id);
    expect(m2.sources().map((s) => s.key)).toEqual(['x1', 'x2']);
  });

  it('删除档案：非生效直接移除；删除生效档自动切到剩下的那份；删唯一一份清空订阅内容', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.replaceFromImport(fullConfig([bean('p1')]), 'https://h/p.json');
    const pa = m.activeProfileId();
    m.saveAsProfile('另一个'); // active 移到新档，两份内容都还是 p1
    const other = m.profiles().find((p) => p.id !== pa)!;

    // ★ 2026-10-16（用户要求）：生效档案不再拒绝删除 —— 自动切到剩下的第一份并按其存档重建
    m.deleteProfile(other.id);
    expect(m.profiles().some((p) => p.id === other.id)).toBe(false);
    expect(m.activeProfileId()).toBe(pa);
    expect(m.sources().map((s) => s.key)).toEqual(['p1']);

    // 删唯一一份：清空订阅内容（sources / 订阅自带 lives / parses），本地导入线路另测（见 localLive/墓碑用例）
    m.deleteProfile(pa);
    expect(m.profiles().length).toBe(0);
    expect(m.activeProfileId()).toBe('');
    expect(m.sources().length).toBe(0);
  });

  // ★ 2026-09-26（用户口径）：导入新订阅 → 旧档案改名「旧订阅 xx」+ 新档案「新订阅 xx」并切换过去
  describe('导入新订阅的档案命名（旧订阅/新订阅）', () => {
    it('自动命名的当前档案 → 改名「旧订阅 xx」；新导入存为「新订阅 xx」并生效', () => {
      const dir = tmpDir();
      const m = newUserConfigService(dir);
      // 首次导入：无档案 → replaceFromImport 自动建默认档案（名「新订阅 xx」，属自动命名）
      m.replaceFromImport(fullConfig([bean('old1')]), 'https://host/old.json');
      expect(m.profiles()[0].name).toMatch(/^新订阅 /);

      // 第二次导入（新增订阅）走的就是 SpiderHost 的口径
      m.renameActiveProfileAsOld('旧订阅 09-26 10:00');
      m.saveAsProfile('新订阅 09-26 10:00', { parsed: fullConfig([bean('new1'), bean('new2')]), apiUrl: 'https://host/new.json' });

      expect(m.profiles().map((p) => p.name)).toEqual(['旧订阅 09-26 10:00', '新订阅 09-26 10:00']);
      expect(m.sources().map((s) => s.key)).toEqual(['new1', 'new2']);
      // 切回旧订阅仍可恢复旧源
      const old = m.profiles()[0];
      m.activateProfile(old.id);
      expect(m.sources().map((s) => s.key)).toEqual(['old1']);
    });

    it('用户手动命名过的档案不被「旧订阅」覆盖；再次导入时旧档案名保持', () => {
      const dir = tmpDir();
      const m = newUserConfigService(dir);
      m.replaceFromImport(fullConfig([bean('o1')]), 'https://host/o.json');
      m.updateProfileName(m.activeProfileId(), '我的主力订阅');

      m.renameActiveProfileAsOld('旧订阅 09-26 11:00');
      expect(m.profiles()[0].name).toBe('我的主力订阅'); // 手动名保留

      // 已经是自动名的「旧订阅 xx」可被下一次导入继续改名（避免越攒越多同名）
      m.renameActiveProfileAsOld('旧订阅 09-26 12:00');
      expect(m.profiles()[0].name).toBe('我的主力订阅'); // 手动名的仍不动
      m.saveAsProfile('新订阅 09-26 12:00', { parsed: fullConfig([bean('o2')]), apiUrl: 'https://host/o2.json' });
      m.renameActiveProfileAsOld('旧订阅 09-26 13:00');
      // 当前生效的是「新订阅 12:00」（自动名）→ 可被改名
      expect(m.profiles()[1].name).toBe('旧订阅 09-26 13:00');
      expect(m.profiles()[0].name).toBe('我的主力订阅');
    });
  });
});

describe('UserConfigApplicationService — ★ 2026-09-30 换源弹层数据与本地直播源导入', () => {
  /** 构造一条本地导入的直播源 bean（字段口径同 ipc 侧 parseLive 产物） */
  function liveBean(name: string, url: string): LiveBean {
    return { name, url, api: '', type: '0', jar: '', ext: '', epg: '', playerType: '', timeout: 15 };
  }

  it('profileSitesView：当前档案取运行期真实源；其它档案取存档 JSON（已与运行期对齐）', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.replaceFromImport(fullConfig([bean('a1'), bean('a2')]), 'https://host/a.json'); // 建档：json = a1/a2
    const aId = m.activeProfileId();
    m.addSource(bean('a3')); // 手动加源 → ★ 2026-09-30 起同步写回 A 的存档 json（内容变更即对齐）
    const pb = m.saveAsProfile('配置B'); // 快照当前（a1/a2/a3）为新档案并切换过去

    const view = m.profileSitesView();
    expect(view.activeId).toBe(pb.id);
    expect(view.profiles.find((p) => p.id === pb.id)!.sites.map((s) => s.key)).toEqual(['a1', 'a2', 'a3']);
    // ★ 2026-09-30：非当前档案同样含 a3 —— 存档 json 与运行期一致，
    //   否则「切到别的订阅再切回来」会用旧 json 重建 → 手动删掉的源又冒出来（用户报的"残留"）
    expect(view.profiles.find((p) => p.id === aId)!.sites.map((s) => s.key)).toEqual(['a1', 'a2', 'a3']);
  });

  it('★ 2026-09-30：手动改过的源列表在「切走再切回」后保持不变（档案 json 与运行期同步）', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.replaceFromImport(fullConfig([bean('a1'), bean('a2'), bean('a3')]), 'https://h/a.json');
    const aId = m.activeProfileId();
    const pb = m.saveAsProfile('B'); // B 快照当前 3 源并成为生效档案
    m.activateProfile(aId); // 切回 A
    m.deleteSource('a2'); // 手动删源（旧行为下只落运行期，A 的 json 仍带 a2）
    m.addSource(bean('a9')); // 手动加源

    m.activateProfile(pb.id); // 切到 B
    m.activateProfile(aId); // 再切回 A
    expect(m.snapshot().sources.map((s) => s.key)).toEqual(['a1', 'a3', 'a9']);
    // 存档 json 也应是一致的（换源弹层「左订阅/右源」直接读它）
    const p = m.rawProfiles().find((x) => x.id === aId)!;
    expect((JSON.parse(p.json) as { sites: Array<{ key: string }> }).sites.map((s) => s.key)).toEqual(['a1', 'a3', 'a9']);
  });

  it('activateProfile(id, pickKey)：一步切换档案 + 选中源；非法 pickKey 不硬塞', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.replaceFromImport(fullConfig([bean('a1'), bean('a2')]), 'https://h/a.json');
    const aId = m.activeProfileId();
    const pb = m.saveAsProfile('B'); // active 移到 B（内容同为 a1/a2）
    m.activateProfile(aId, 'a2');
    expect(m.activeProfileId()).toBe(aId);
    expect(m.activeSourceKey()).toBe('a2');
    m.activateProfile(pb.id, 'nope');
    expect(m.activeProfileId()).toBe(pb.id);
    expect(m.activeSourceKey()).not.toBe('nope'); // 不存在于该档案的 key 不被选中
  });

  it('addLive：同 url 视为同一条（只更新名字）；空地址抛中文错', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    const url = 'http://127.0.0.1:9978/file/local-live/x.txt';
    expect(m.addLive(liveBean('X', url))).toEqual({ index: 0, replaced: false });
    expect(m.snapshot().lives.length).toBe(1);
    expect(m.addLive(liveBean('X2', url))).toEqual({ index: 0, replaced: true });
    expect(m.snapshot().lives.length).toBe(1);
    expect(m.snapshot().lives[0].name).toBe('X2');
    expect(() => m.addLive(liveBean('bad', ''))).toThrow(/地址为空/);
  });

  // ---------------------------------------------------------------------------
  // ★ 2026-10-15（用户报「导入的 TXT 直播源重启软件会消失」）：
  // 本地导入的 TXT/M3U 线路是一份**独立于订阅的本地订阅** —— 订阅导入 / 7 天自动刷新 /
  // 档案切换都会全量替换 lives，它们必须活下来（否则重启即被自动刷新清掉）。
  // ---------------------------------------------------------------------------
  const LOCAL = 'http://127.0.0.1:9978/file/local-live/%E6%88%91%E7%9A%84%E7%9B%B4%E6%92%AD.txt';

  it('订阅导入（自动刷新路径）替换 lives 后，本地导入线路仍在；重载（重启等价）后仍在', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.addLive(liveBean('我的直播', LOCAL));
    // 启动时自动刷新 = importConfig → replaceFromImport：订阅自带一条远端线路
    const cfg = fullConfig([bean('s1')]);
    cfg.lives = [liveBean('远端线路', 'https://host/live.m3u')];
    m.replaceFromImport(cfg, 'https://host/sub.json');
    expect(m.lives().map((l) => l.name)).toEqual(['远端线路', '我的直播']);

    const m2 = newUserConfigService(dir);
    expect(m2.load()).toBe(true);
    expect(m2.lives().map((l) => l.url)).toContain(LOCAL);
    expect(m2.lives().map((l) => l.name)).toEqual(['远端线路', '我的直播']);
  });

  it('本地线路不写进档案 json；切走再切回仍在；重命名保留', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.replaceFromImport(fullConfig([bean('a1')]), 'https://host/a.json');
    const aId = m.activeProfileId();
    m.addLive(liveBean('本地X', LOCAL));
    const b = m.saveAsProfile('配置B');
    const bJson = JSON.parse(m.rawProfiles().find((p) => p.id === b.id)!.json) as { lives: unknown[] };
    expect(bJson.lives).toEqual([]); // 存档不带本机线路

    m.activateProfile(aId);
    expect(m.lives().map((l) => l.url)).toEqual([LOCAL]);
    m.updateLiveName(0, '改过名');
    m.activateProfile(b.id);
    m.activateProfile(aId);
    expect(m.lives()).toHaveLength(1);
    expect(m.lives()[0].name).toBe('改过名');
  });

  it('★ deleteLives：批量按下标删除，收敛 activeLiveIndex，越界忽略', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.addLive(liveBean('A', LOCAL + '?a'));
    m.addLive(liveBean('B', LOCAL + '?b'));
    m.addLive(liveBean('C', LOCAL + '?c'));
    m.setActiveLiveIndex(2);
    m.deleteLives([0, 2, 99]); // 99 越界忽略
    expect(m.lives().map((l) => l.name)).toEqual(['B']);
    expect(m.activeLiveIndex()).toBe(0);
    m.deleteLives([]); // 空集合 no-op
    expect(m.lives()).toHaveLength(1);
  });

  it('删除本地线路后，后续订阅替换不会让它复活', () => {
    const dir = tmpDir();
    const m = newUserConfigService(dir);
    m.addLive(liveBean('本地Y', LOCAL));
    m.deleteLive(0);
    expect(m.lives()).toEqual([]);
    m.replaceFromImport(fullConfig([bean('s1')]), 'https://host/s.json');
    expect(m.lives()).toEqual([]);
  });
});
