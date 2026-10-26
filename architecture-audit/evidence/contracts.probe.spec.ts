import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { JsonStore } from '../../src/main/store/JsonStore';
import { DavStore } from '../../src/main/store/DavStore';
import { UserConfigRepository } from '../../src/main/store/UserConfigRepository';
import type { UserConfig } from '../../src/shared/types';
import { PluginSandboxLifecycle, type SandboxEntry } from '../../src/main/plugin/sandbox/PluginSandboxLifecycle';
import type { PluginSandboxApi } from '../../src/main/plugin/sandbox/protocol';
const logger = { i: () => undefined, w: () => undefined, e: () => undefined };
it('does not acknowledge a WebDAV save after the durable write fails', () => {
  vi.useFakeTimers();
  const store = new JsonStore(resolve('.tmp/audit-unused-dav.json'));
  const flush = vi.spyOn(store, 'flushStrict').mockImplementation(() => { throw new Error('injected EACCES'); });
  try {
    const dav = new DavStore(store, logger);
    let threw = false;
    try { dav.set({ id: 'audit', name: 'Audit', url: 'https://audit.invalid', username: '', password: '' }); } catch { threw = true; }
    console.log('AUDIT_SAVE_ACK', JSON.stringify({ threw, memoryCount: dav.list().length }));
    expect(threw).toBe(true);
    expect(dav.list()).toHaveLength(0);
  } finally { flush.mockRestore(); vi.clearAllTimers(); vi.useRealTimers(); }
});
it('distinguishes a durable commit from failure of a post-commit observer', () => {
  let durable: unknown;
  const initial = { audit: 'before' } as unknown as UserConfig;
  const next = { audit: 'after' } as unknown as UserConfig;
  const repository = new UserConfigRepository({ getObject: (_key, fallback) => fallback, setObject: (_key, value) => { durable = structuredClone(value); }, flushStrict: () => undefined }, initial);
  repository.setOnChange(() => { throw new Error('injected runtime refresh failure'); });
  let threw = false;
  try { repository.commit(next, 'content'); } catch { threw = true; }
  console.log('AUDIT_POST_COMMIT', JSON.stringify({ threw, durable, revision: repository.revision }));
  // A successful durable write must not be indistinguishable from a failed write.
  expect(threw).toBe(false);
  expect(durable).toEqual(next);
});
const entry = (main: string): SandboxEntry => ({ id: 'audit', enabled: true, kind: 'code', payloadReady: true, path: '.', main, permissions: [] });
function lifecycleProbe(startOk: boolean) {
  let created = 0;
  let disposed = 0;
  const lifecycle = new PluginSandboxLifecycle({ api: {} as PluginSandboxApi, workerFile: '.', logger, factory: () => { created++; return { start: async () => ({ ok: startOk }), running: startOk, error: undefined, dispose: () => { disposed++; } }; } });
  return { lifecycle, counts: () => ({ created, disposed }) };
}
describe('plugin lifecycle contracts', () => {
  it('replaces an enabled sandbox when its installed entry point changes', async () => {
    const probe = lifecycleProbe(true);
    try {
      await probe.lifecycle.sync([entry('v1.js')]);
      await probe.lifecycle.sync([entry('v2.js')]);
      console.log('AUDIT_PLUGIN_UPDATE', JSON.stringify(probe.counts()));
      expect(probe.counts()).toEqual({ created: 2, disposed: 1 });
    } finally { probe.lifecycle.disposeAll(); }
  });
  it('can retry a failed sandbox during a subsequent reconciliation', async () => {
    const probe = lifecycleProbe(false);
    try {
      await probe.lifecycle.sync([entry('v1.js')]);
      await probe.lifecycle.sync([entry('v1.js')]);
      console.log('AUDIT_PLUGIN_RETRY', JSON.stringify(probe.counts()));
      expect(probe.counts().created).toBe(2);
    } finally { probe.lifecycle.disposeAll(); }
  });
});
