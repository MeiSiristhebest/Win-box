import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { JsWorkerPool } from '../../src/engine/js/worker/JsWorkerPool';

let pool: JsWorkerPool | undefined;
afterEach(() => { pool?.dispose(); pool = undefined; });
function createProbe() {
  const started = Promise.withResolvers<void>();
  const spawns: string[] = [];
  pool = new JsWorkerPool({
    http: { request: async () => { throw new Error('Unexpected network'); } },
    kv: { get: () => '', set: () => undefined, delete: () => undefined },
    logger: { i: message => { if (message === 'audit-call-started') started.resolve(); else spawns.push(message); }, w: () => undefined, e: () => undefined },
  }, resolve('architecture-audit/evidence/worker-probe.cjs'));
  return { pool, started, spawns };
}
const delay = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));
describe('architecture audit lifecycle probe', () => {
  it('settles every queued caller when its worker exits', async () => {
    const probe = createProbe();
    const states = ['pending', 'pending', 'pending'];
    const calls = ['crash', 'queued-one', 'queued-two'].map((operation, index) =>
      probe.pool.call('source', ['test'], [operation], 10_000).then(
        () => { states[index] = 'resolved'; },
        () => { states[index] = 'rejected'; },
      ));
    await probe.started.promise;
    await delay(500);
    console.log('AUDIT_CRASH_QUEUE', JSON.stringify(states));
    expect(states).toEqual(['rejected', 'rejected', 'rejected']);
    void Promise.all(calls);
  });
  it('settles an in-flight caller promptly when the pool is disposed', async () => {
    const probe = createProbe();
    let state = 'pending';
    void probe.pool.call('source', ['test'], ['hang'], 10_000).then(
      () => { state = 'resolved'; }, () => { state = 'rejected'; },
    );
    await probe.started.promise;
    probe.pool.dispose();
    await delay(250);
    console.log('AUDIT_DISPOSE', state);
    expect(state).toBe('rejected');
  });
  it('does not start workers merely to destroy an unopened sandbox', () => {
    const probe = createProbe();
    probe.pool.createSandbox({ siteKey: 'unused', api: 'https://unused.test/spider.js', ext: '' }).destroy();
    console.log('AUDIT_DESTROY_SPAWNS', probe.spawns.length);
    expect(probe.spawns).toHaveLength(0);
  });
});

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { EmbeddedPythonRuntime } from '../../src/engine/spider/EmbeddedPythonRuntime';
import { SpiderProcPool, effectiveGlobalCap } from '../../src/engine/spider/SpiderProcPool';
import { PythonSpiderRuntimeAdapter } from '../../src/engine/spider/PythonSpiderRuntimeAdapter';
import { spiderCallSucceeded } from '../../src/engine/spider/spiderCallResult';
function processProbe() {
  const children: Array<EventEmitter & { kills: number }> = [];
  const processPool = new SpiderProcPool(() => {
    const out = new EventEmitter();
    Object.assign(out, { setEncoding: () => undefined });
    const child = Object.assign(new EventEmitter(), {
      stdout: out, stdin: { writable: true, write: () => true }, kills: 0,
      kill() { this.kills += 1; return true; },
    });
    children.push(child);
    return child as unknown as ChildProcess;
  });
  return { processPool, children, finish: () => { processPool.dispose(); for (const child of children) child.emit('exit', 0); } };
}
describe('architecture audit process probe', () => {
  it('kills every process when disposing a group with three warm processes', () => {
    const probe = processProbe();
    try {
      const count = probe.processPool.warm('group', { exe: 'java', serveArgv: [], key: 'group' }, 3);
      probe.processPool.dispose();
      const kills = probe.children.map(child => child.kills);
      console.log('AUDIT_PROCESS_DISPOSE', JSON.stringify({ count, kills }));
      expect(kills).toEqual([1, 1, 1]);
    } finally { probe.finish(); }
  });
  it('does not bypass the global process budget with a cold Python fallback', async () => {
    const probe = processProbe();
    const cap = effectiveGlobalCap();
    let oneShots = 0;
    let overflow: unknown;
    try {
      for (let index = 0; index < cap; index++) {
        void probe.processPool.submit('busy-'+index, { exe: 'java', serveArgv: [], key: 'busy-'+index }, { id: 'busy-'+index, className: 'C', method: 'searchContent', args: [] });
      }
      const adapter = new PythonSpiderRuntimeAdapter({
        runtime: { ensure: async () => 'C:/runtime' } as unknown as EmbeddedPythonRuntime,
        pool: probe.processPool,
        logInfo: () => undefined,
        submitToPool: async () => { const result = await probe.processPool.submit('overflow', { exe: 'python', serveArgv: [], key: 'overflow' }, { id: 'overflow', className: 'C', method: 'searchContent', args: [] }); overflow = result; return result; },
        runSubprocess: async () => { oneShots += 1; return spiderCallSucceeded('cold fallback'); },
      });
      await adapter.callPython('source.py', 'C', 'searchContent', ['query']);
      console.log('AUDIT_CAP_FALLBACK', JSON.stringify({ cap, pooledProcesses: probe.children.length, oneShots, overflow }));
      expect(oneShots).toBe(0);
    } finally { probe.finish(); }
  });
});
