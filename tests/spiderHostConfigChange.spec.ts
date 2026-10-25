// tests/spiderHostConfigChange.spec.ts
// ★ 2026-09-27 事故回归：**「切换选中源」不是配置变更，不得触发任何重活**。
//
// 事故（用户报「摸鱼切换源很慢、一直加载中；从搜索结果返回也很慢」）：
//   `UserConfigApplicationService.setActiveSource()` 必须走 ui-only 路径，不能触发来源重建：
//     ① 重放整份 SiteConfig；② `SpiderRuntimeLifecycle.clearSpiderInstances()`（丢弃已建好的蜘蛛实例）；
//     ③ 使聚合搜索缓存失效（**清掉全源搜索的 5 分钟缓存** → 「搜索→换源→再搜同词」重新跑 100 个源，
//        这正是用户怀疑的「每次切换都重跑了一次所有的源」）；④ 预热 3 个**别的**源的 JVM/Python。
//
// 本测试从公开策略边界断言：切源**不得**清这两个缓存；真正的配置变更（增删改源）仍要失效搜索状态。
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shost-cfg-'));
  (globalThis as unknown as { __shostDir: string }).__shostDir = dir;
  return {
    app: { getPath: () => dir, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: (b: Buffer) => Buffer.from(b).toString('utf8'),
    },
  };
});

import { rmSync } from 'node:fs';
import { createSpiderHostServicesTestFixture } from './spiderHostIntegrationFixture';
import { createSpiderHostTestSourceProvider } from './spiderHostTestInfrastructure';
import { SearchSourceReadiness, type SourceRuntimeReadinessPort } from '../src/engine/vod/SearchSourceReadiness';
import type { SearchReadinessPort } from '../src/main/spider/AggregateSearchCoordinator';
import type { HttpClient, HttpResponse } from '../src/shared/types';
import { fetchSubscriptionConfig } from '../src/main/subscriptions/SubscriptionConfigFetcher';
import { parseSiteConfigWithBase } from '../src/engine/config/ApiConfigParser';
import type { SourceBean } from '../src/shared/types';

function httpResponse(url: string, body: string, status = 200): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, content: Array.from(Buffer.from(body)), finalUrl: url };
}

const testLogger = { i: () => undefined, w: () => undefined, e: () => undefined };
const readySearchSources: SearchReadinessPort = {
  prepare: async ({ sources }) => ({ active: sources.map((_, index) => index), skipped: [] }),
};

describe('SpiderHost — 全源搜索不把已失败 jar 当成准备中', () => {
  it('真实在途 jar 仍计入 pendingSources，不把准备中源当作失败', async () => {
    const search = vi.fn(async () => ({ list: [] }));
    const readiness = new SearchSourceReadiness({
      inspect: () => ({ state: 'preparing', reason: '正在后台下载蜘蛛 jar', waitUntilReady: () => null }),
    }, { i: () => undefined });
    const host = createSpiderHostServicesTestFixture(undefined, undefined, {
      spiderSources: createSpiderHostTestSourceProvider({ searchContent: search }),
      aggregateSearchReadiness: readiness,
    });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      host.sourceConfiguration.addSource({ key: 'pending', name: 'pending', type: 3, api: 'csp_Test', searchable: 1 } as SourceBean);
      const report = await host.aggregateSearchRunner.run('jar-state-pending', { refresh: true });
      expect(report.pendingSources).toBe(1);
      expect(JSON.stringify(report)).toContain('正在后台下载蜘蛛 jar');
      expect(search).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
  it.each(['before', 'during'])('%s：404/未配置立即跳过，正常源继续搜索，pendingSources 不含失败源', async when => {
    const readinessState = new Map<string, number>();
    const reason = 'jar 下载失败：上游返回 HTTP 404，请检查配置里的 jar 地址';
    const runtimeReadiness: SourceRuntimeReadinessPort = {
      inspect: (source) => {
        const count = readinessState.get(source.key) ?? 0;
        readinessState.set(source.key, count + 1);
        if (source.key === 'good') return { state: 'ready' };
        if (source.key === 'nojar') return { state: 'unavailable', reason: '该源未指定 jar 地址' };
        if (when === 'during' && count === 0) return { state: 'preparing', reason, waitUntilReady: () => Promise.resolve() };
        return { state: 'unavailable', reason };
      },
    };
    const search = vi.fn(async (_source: SourceBean) => ({ list: [] }));
    const host = createSpiderHostServicesTestFixture(undefined, undefined, {
      spiderSources: createSpiderHostTestSourceProvider({ searchContent: search }),
      aggregateSearchReadiness: new SearchSourceReadiness(runtimeReadiness, { i: () => undefined }),
    });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      for (const key of ['missing', 'nojar', 'good']) {
        host.sourceConfiguration.addSource({ key, name: key, type: 3, api: 'csp_Test', searchable: 1 } as SourceBean);
      }
      const report = await host.aggregateSearchRunner.run('jar-state-' + when, { refresh: true });
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][0]).toMatchObject({ key: 'good' });
      expect(report.pendingSources || 0).toBe(0);
      expect(JSON.stringify(report)).toContain('HTTP 404');
      expect(JSON.stringify(report)).toContain('未指定 jar 地址');
      expect(JSON.stringify(report)).not.toContain('运行时就绪中');
      if (when === 'before') expect(readinessState.get('missing')).toBe(1);
    } finally {
      vi.restoreAllMocks();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe('SpiderHost — 多仓父清单失败后重试', () => {
  it('重新读取父清单并导入完整子仓清单', async () => {
    const rootUrl = 'https://example.test/repos.json';
    const childUrls = ['https://one.example/config.json', 'https://two.example/config.json'];
    const manifest = JSON.stringify({
      urls: childUrls.map((url, index) => ({ url, name: `repo-${index + 1}` })),
    });
    const fetchedUrls: string[] = [];
    let failRoot = true;
    let rootFetchCount = 0;
    const http: HttpClient = {
      request: async (request) => {
        fetchedUrls.push(request.url);
        if (request.url === rootUrl) {
          rootFetchCount += 1;
          if (failRoot) return httpResponse(request.url, '', 404);
          return httpResponse(request.url, manifest);
        }
        const key = request.url === childUrls[0] ? 'repo-1' : request.url === childUrls[1] ? 'repo-2' : '';
        if (!key) return httpResponse(request.url, '', 404);
        return httpResponse(request.url, JSON.stringify({ sites: [{ key, name: key, type: 0, api: 'https://x/api.php/provide/vod' }] }));
      },
    };
    const host = createSpiderHostServicesTestFixture(undefined, undefined, { infrastructure: { http } });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;

    try {
      const first = host.subscriptionImports.start(rootUrl, 'fixture');
      await vi.waitFor(() => expect(host.subscriptionImports.get(first.jobId)?.state).toBe('failed'));
      expect(host.subscriptionImports.get(first.jobId)).toMatchObject({ total: 1, completed: 0, failed: 1, pending: 0 });
      failRoot = false;

      const retry = host.subscriptionImports.retryFailed(first.jobId);
      await vi.waitFor(() => expect(host.subscriptionImports.get(retry.jobId)?.state).toBe('completed'));

      expect(rootFetchCount).toBeGreaterThan(1);
      expect(fetchedUrls).toContain(rootUrl);
      for (const childUrl of childUrls) expect(fetchedUrls).toContain(childUrl);
      expect(host.sourceConfiguration.getSnapshot().subscriptionGroups.find((group) => group.url === rootUrl)?.members)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ url: childUrls[0], status: 'ready' }),
          expect.objectContaining({ url: childUrls[1], status: 'ready' }),
        ]));
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('用户取消多仓导入时不提交已下载的子仓结果', async () => {
    const rootUrl = 'https://example.test/cancellable-repos.json';
    const childUrls = ['https://one.example/config.json', 'https://two.example/config.json'];
    const manifest = JSON.stringify({
      urls: childUrls.map((url, index) => ({ url, name: `repo-${index + 1}` })),
    });
    let blockedSignal: AbortSignal | undefined;
    let childFetchCount = 0;
    const http: HttpClient = {
      request: async (request) => {
      const url = request.url;
      if (url === rootUrl) return httpResponse(url, manifest);
      childFetchCount += 1;
      if (url === childUrls[0]) {
        return httpResponse(url, JSON.stringify({ sites: [{ key: 'repo-1', name: 'repo-1', type: 0, api: 'https://x/api.php/provide/vod' }] }));
      }
      if (url === childUrls[1]) {
        blockedSignal = request.signal;
        return await new Promise<HttpResponse>((_resolve, reject) => {
          const abort = () => reject(blockedSignal?.reason ?? new Error('request aborted'));
          if (blockedSignal?.aborted) abort();
          else blockedSignal?.addEventListener('abort', abort, { once: true });
        });
      }
      return httpResponse(url, '', 404);
      },
    };
    const host = createSpiderHostServicesTestFixture(undefined, undefined, { infrastructure: { http } });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    const original = host.sourceConfiguration.getSnapshot();

    try {
      const job = host.subscriptionImports.start(rootUrl, 'fixture');
      await vi.waitFor(() => expect(host.subscriptionImports.get(job.jobId)?.succeeded).toBe(1));
      expect(blockedSignal).toBeDefined();

      host.subscriptionImports.cancel(job.jobId);
      await vi.waitFor(() => expect(host.subscriptionImports.get(job.jobId)?.state).toBe('cancelled'));

      expect(host.subscriptionImports.get(job.jobId)?.message).toBe('导入已取消；本轮结果未提交');
      expect(blockedSignal?.aborted).toBe(true);
      expect(childFetchCount).toBe(2);
      expect(host.sourceConfiguration.getSnapshot()).toEqual(original);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

function bean(key: string): SourceBean {
  return { key, name: key, type: 0, api: 'https://x/api.php/provide/vod' } as SourceBean;
}

describe('SpiderHost — 切源（ui-only 变更）不得触发重活', () => {
  it('source/profile deletion cleans owned imports after persisting configuration', () => {
    const cleanupRemoved = vi.fn();
    const host = createSpiderHostServicesTestFixture({ rootOf: () => null, readSubscription: () => null, cleanupRemoved });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      host.sourceConfiguration.addSource(bean('cleanup'));
      const profile = host.profileConfiguration.saveCurrentAsProfile('keep-copy');
      host.profileConfiguration.saveCurrentAsProfile('active-copy');
      host.sourceConfiguration.deleteSource('cleanup');
      expect(cleanupRemoved).toHaveBeenCalledTimes(1);
      expect(cleanupRemoved.mock.calls[0][0].sources.some((s: SourceBean) => s.key === 'cleanup')).toBe(true);
      expect(cleanupRemoved.mock.calls[0][1].sources.some((s: SourceBean) => s.key === 'cleanup')).toBe(false);
      host.profileConfiguration.deleteProfile(profile.id);
      expect(cleanupRemoved).toHaveBeenCalledTimes(2);
      expect(cleanupRemoved.mock.calls[1][0].profiles.some((p: { id: string }) => p.id === profile.id)).toBe(true);
      expect(cleanupRemoved.mock.calls[1][1].profiles.some((p: { id: string }) => p.id === profile.id)).toBe(false);
      // ★ 2026-10-16（用户要求）：生效档案也允许删除。此处只剩这一份 → 等于「删唯一一份」，清空订阅内容
      host.profileConfiguration.deleteProfile(host.sourceConfiguration.getSnapshot().activeProfileId);
      expect(cleanupRemoved).toHaveBeenCalledTimes(3);
      expect(host.sourceConfiguration.getSnapshot().profiles.length).toBe(0);
      expect(host.sourceConfiguration.getSnapshot().sources.length).toBe(0);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
  it('★ cfgSetActiveSource 不清蜘蛛实例缓存、不清全源搜索缓存', () => {
    const host = createSpiderHostServicesTestFixture();
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      host.sourceConfiguration.addSource(bean('a'));
      host.sourceConfiguration.addSource(bean('b'));

      const clearSpider = vi.spyOn(host.spiderRuntime, 'clearSpiderInstances');
      const invalidateSearch = vi.spyOn(host.aggregateSearch, 'invalidateConfiguration');

      // ★ 切源 = ui-only：两个缓存都不许被清
      host.sourceConfiguration.selectActiveSource('b');
      expect(clearSpider).not.toHaveBeenCalled();
      expect(invalidateSearch).not.toHaveBeenCalled();

      // 对照：真正的配置变更（加源）仍会作废旧缓存
      host.sourceConfiguration.addSource(bean('c'));
      expect(clearSpider).toHaveBeenCalled();
      expect(invalidateSearch).toHaveBeenCalled();
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('does not apply the active source priority when searching a different profile', async () => {
    const search = vi.fn(async (_source: SourceBean) => ({ list: [] }));
    const host = createSpiderHostServicesTestFixture(undefined, undefined, {
      spiderSources: createSpiderHostTestSourceProvider({ searchContent: search }),
      aggregateSearchReadiness: readySearchSources,
    });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      host.sourceConfiguration.addSource({ ...bean('first'), type: 3, api: 'csp_Test' });
      host.sourceConfiguration.addSource({ ...bean('same'), type: 3, api: 'csp_Test' });
      const activeProfile = host.profileConfiguration.saveCurrentAsProfile('active-profile');
      host.sourceConfiguration.selectActiveSource('same');
      const otherProfile = host.profileConfiguration.saveCurrentAsProfile('other-profile');
      host.profileConfiguration.activateProfile(activeProfile.id);

      await host.aggregateSearchRunner.run('profile-priority', { refresh: true, profileId: otherProfile.id });

      expect(search.mock.calls.map(([source]) => source.key)).toEqual(['first', 'same']);
    } finally {
      vi.restoreAllMocks();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('searches selected profiles independently when source keys repeat', async () => {
    const search = vi.fn(async (source: SourceBean) => {
      const [profileId] = JSON.parse(source.runtimeScope || '[]') as [string, string];
      return { list: [{ vod_id: profileId, vod_name: `result ${profileId}` }] };
    });
    const host = createSpiderHostServicesTestFixture(undefined, undefined, {
      spiderSources: createSpiderHostTestSourceProvider({ searchContent: search }),
      aggregateSearchReadiness: readySearchSources,
    });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      host.sourceConfiguration.addSource({ ...bean('same-key'), type: 3, api: 'csp_Test' });
      const profileA = host.profileConfiguration.saveCurrentAsProfile('profile-a');
      const profileB = host.profileConfiguration.saveCurrentAsProfile('profile-b');
      host.profileConfiguration.activateProfile(profileA.id);

      const progress: Array<{ profileId?: string; done: number; total: number; pending?: number; source?: unknown }> = [];
      const report = await host.aggregateSearchRunner.run('cross-profile', { refresh: true, profileIds: [profileA.id, profileB.id] }, (event) => progress.push(event));

      expect(search).toHaveBeenCalledTimes(2);
      expect(report.perSource.map((source) => [source.profileId, source.key])).toEqual([
        [profileA.id, 'same-key'],
        [profileB.id, 'same-key'],
      ]);
      expect(report.items.map((item) => item.sourceRef)).toEqual([
        { profileId: profileA.id, key: 'same-key' },
        { profileId: profileB.id, key: 'same-key' },
      ]);
      expect(host.profileConfiguration.activeProfileId()).toBe(profileA.id);
      expect(progress.filter((event) => event.source).map((event) => event.profileId).sort()).toEqual([profileA.id, profileB.id].sort());
      expect(progress.at(-1)).toMatchObject({ done: 2, total: 2, pending: 0 });
    } finally {
      vi.restoreAllMocks();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

/**
 * ★ 2026-09-27（用户要求「确保每一个需要绑定网盘的都能有这段提示，不管换什么订阅什么源」）：
 *   学习点 = `play()` 里蜘蛛真实产出网盘直链（`matchDriveCookieProvider` 命中）→ `markDriveBindNeeded(key)`。
 *   这里验证「学习 → 暴露给渲染层 → 落盘 → 重新构造宿主后仍在」这条链（不依赖蜘蛛类名清单）。
 */
describe('SpiderHost — 网盘绑定「运行期学习」', () => {
  it('★ markDriveBindNeeded：登记 → 暴露；且跨宿主重建仍保留（落盘）', () => {
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      const host = createSpiderHostServicesTestFixture();
      expect(host.driveBindingLearning.learnedSourceKeys()).toEqual([]);

      host.driveBindingLearning.markRequired('某新盘源');
      host.driveBindingLearning.markRequired('  某新盘源  '); // 去空白后重复 → 不重复登记
      host.driveBindingLearning.markRequired('');
      expect(host.driveBindingLearning.learnedSourceKeys()).toEqual(['某新盘源']);

      // 重新构造（模拟重启）：学习结果从 <userData>/drive-bind-learned.json 读回
      const again = createSpiderHostServicesTestFixture();
      expect(again.driveBindingLearning.learnedSourceKeys()).toEqual(['某新盘源']);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

/**
 * ★ 2026-09-27（载荷层补完·缺口 B）：**播放前就能学会「要网盘 Cookie」，播放失败要能上屏**。
 *
 * 为什么：原先只在「播放**成功**产出网盘直链」时学习 —— 未绑定 Cookie 时播放必失败，
 * 于是「学不到 → 不显示绑定入口 → 永远绑不上」。详情数据在播放之前就带着答案
 * （实测 wex 玩偶：`vod_play_from = 夸克原画$$$夸克最高急速…`），失败信息也能翻译成可执行提示。
 */
describe('SpiderHost — 详情判定 + 播放失败翻译（缺口 B）', () => {
  it('detail()：播放源名带网盘字样 → 立刻记入绑定清单', async () => {
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      const host = createSpiderHostServicesTestFixture(undefined, undefined, {
        spiderSources: createSpiderHostTestSourceProvider({
          detailContent: () => ({
            list: [{
              vod_id: '1',
              vod_name: 'n',
              vod_play_from: '夸克原画$$$夸克最高急速',
              vod_play_url: '夸克原画$1be9f9ab|eaa9|qjuH$$$夸克最高急速$1be9f9ab|eaa9|qjuH',
            }],
          }),
        }),
      });
      host.sourceConfiguration.addSource({ key: 'wx', name: 'wx', type: 3, api: 'csp_WoggGuard' } as SourceBean);
      expect(host.driveBindingLearning.learnedSourceKeys()).toEqual([]);
      await host.sourceCatalog.detail('wx', ['1']);
      expect(host.driveBindingLearning.learnedSourceKeys()).toEqual(['wx']);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('★ play()：网盘未绑定的失败 → 返回可上屏的中文提示（不 throw）+ 记入绑定清单', async () => {
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      const host = createSpiderHostServicesTestFixture(undefined, undefined, {
        spiderSources: createSpiderHostTestSourceProvider({
          playerContent: () => { throw new Error('org.json.JSONException: JSONObject["data"] not found.'); },
        }),
      });
      host.sourceConfiguration.addSource({ key: 'wx2', name: 'wx2', type: 3, api: 'csp_BrandNewPan' } as SourceBean);
      const r = await host.playbackRequest.execute('wx2', '夸克原画', '1be9f9ab');
      // 走既有上屏通道：parse=1 + message（渲染层在播放器上方显示并保底播原始地址）
      expect(r.parse).toBe(1);
      expect(r.message || '').toContain('网盘');
      expect(host.driveBindingLearning.learnedSourceKeys()).toContain('wx2');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('play()：普通错误仍按原样抛出（不得被误判成网盘问题）', async () => {
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      const host = createSpiderHostServicesTestFixture(undefined, undefined, {
        spiderSources: createSpiderHostTestSourceProvider({
          playerContent: () => { throw new Error('java.net.UnknownHostException: dead.example.com'); },
        }),
      });
      host.sourceConfiguration.addSource({ key: 'cms', name: 'cms', type: 3, api: 'csp_Test' } as SourceBean);
      await expect(host.playbackRequest.execute('cms', 'HD', '1')).rejects.toThrow('UnknownHostException');
      expect(host.driveBindingLearning.learnedSourceKeys()).not.toContain('cms');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});


describe('SpiderHost — 并发子仓失败诊断', () => {
  it('每个失败成员保留自身诊断，不使用其他请求的共享状态', async () => {
    const rootUrl = 'https://example.test/diagnostic-repos.json';
    const names = ['missing', 'html', 'working'];
    const urls = names.map(name => 'https://example.test/' + name + '.json');
    const http: HttpClient = {
      request: async (request) => {
        const url = request.url;
        if (url === rootUrl) return httpResponse(url, JSON.stringify({ urls: urls.map((item, i) => ({ url: item, name: names[i] })) }));
        if (url.includes('/missing.json')) return httpResponse(url, '', 404);
        if (url.includes('/html.json')) return httpResponse(url, '<html>{broken}</html>');
        if (url.includes('/working.json')) return httpResponse(url, JSON.stringify({ sites: [{ key: 'working', name: 'working', type: 0, api: 'https://example.test/api' }] }));
        return httpResponse(url, '', 404);
      },
    };
    const host = createSpiderHostServicesTestFixture(undefined, undefined, { infrastructure: { http } });
    const dir = (globalThis as unknown as { __shostDir: string }).__shostDir;
    try {
      const job = host.subscriptionImports.start(rootUrl, 'diagnostics');
      await vi.waitFor(() => expect(host.subscriptionImports.get(job.jobId)?.state).toBe('partial'));
      const members = host.sourceConfiguration.getSnapshot().subscriptionGroups.find(group => group.url === rootUrl)!.members;
      expect(members.find(member => member.url === urls[0])).toMatchObject({ status: 'failed', error: expect.stringContaining('HTTP 404') });
      expect(members.find(member => member.url === urls[1])).toMatchObject({ status: 'failed', error: expect.stringContaining('html') });
      expect(members.find(member => member.url === urls[2])).toMatchObject({ status: 'ready' });
    } finally {
      vi.restoreAllMocks();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});


describe('SpiderHost — GitHub 原站恢复', () => {
  it.each(['plain', 'base64'])('%s：按原站展开相对资源地址', async mode => {
    const proxy = 'https://github.moeyy.xyz/https://raw.githubusercontent.com/owner/repo/main/config.json';
    const http: HttpClient = {
      request: async request => {
      const direct = request.url.startsWith('https://raw.githubusercontent.com/');
      const text = '// collected config\n' + JSON.stringify({ spider: './spider.jar', sites: [{ key: 'a', name: 'a', type: 0, api: 'https://example.test/api' }] });
      const body = direct ? mode === 'base64' ? Buffer.from(text).toString('base64') : text : '<html>proxy unavailable</html>';
      return httpResponse(request.url, body, direct ? 200 : 502);
      },
    };
    try {
      const result = await fetchSubscriptionConfig({ http, logger: testLogger }, proxy, true);
      expect(parseSiteConfigWithBase(result.text, proxy).config.spider).toBe('https://raw.githubusercontent.com/owner/repo/main/spider.jar');
      expect(result.hint).toBe('');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
