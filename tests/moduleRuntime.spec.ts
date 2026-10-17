import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsSandbox } from '../src/engine/js/JsSandbox';
import type { EngineHost } from '../src/engine/ports';
import { withTimeout } from '../src/engine/util/withTimeout';

const instances: JsSandbox[] = [];
afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  vi.useRealTimers();
});

function runtime(files: Record<string, string>) {
  const origin = 'https://modules.test/';
  const requests: string[] = [];
  const host: EngineHost = {
    http: {
      async request({ url }) {
        requests.push(url);
        const source = files[url.slice(origin.length)];
        return { status: source === undefined ? 404 : 200, headers: {}, content: source ?? '', finalUrl: url };
      },
    },
    kv: { get: () => '', set: () => {}, delete: () => {} },
    logger: { i: () => {}, w: () => {}, e: () => {} },
  };
  const sandbox = new JsSandbox({ siteKey: 'modules', api: origin + 'entry.js', ext: '', host, jsLibDir: '' });
  instances.push(sandbox);
  return { sandbox, requests, call: () => sandbox.callMethod(['homeContent'], [], 2000) };
}

describe('module runtime semantics', () => {
  it('preserves import/export text in strings and comments without fetching false dependencies', async () => {
    const { call, requests } = runtime({
      'entry.js': `
        // import ghost from './comment.js';
        const text = "import ghost from './string.js'; export default text";
        export default { homeContent() { return text; } };
      `,
    });
    expect(await call()).toBe("import ghost from './string.js'; export default text");
    expect(requests).toEqual(['https://modules.test/entry.js']);
  });

  it('resolves identical relative specifiers against each importing module', async () => {
    const { call } = runtime({
      'entry.js': "import a from './a/index.js'; import b from './b/index.js'; export default { homeContent() { return a + b; } };",
      'a/index.js': "import value from './value.js'; export default value;",
      'a/value.js': "export default 'A';",
      'b/index.js': "import value from './value.js'; export default value;",
      'b/value.js': "export default 'B';",
    });
    expect(await call()).toBe('AB');
  });

  it('loads imports beyond the old head window while preserving a spider-defined require', async () => {
    const { call } = runtime({
      'entry.js': '/*' + 'padding'.repeat(1500) + `*/
        import value from './value.js';
        function require() { return 'custom'; }
        export default { homeContent() { return value + ':' + require(); } };
      `,
      'value.js': "export default 'imported';",
    });
    expect(await call()).toBe('imported:custom');
  });

  it('preserves live bindings through export-star modules', async () => {
    const { call } = runtime({
      'entry.js': "import { count, increment } from './bridge.js'; export default { homeContent() { increment(); return count; } };",
      'bridge.js': "export * from './counter.js';",
      'counter.js': 'export let count = 0; export function increment() { count++; }',
    });
    expect(await call()).toBe(1);
    expect(await call()).toBe(2);
  });

  it('supports top-level await, lazy dynamic imports and import.meta', async () => {
    const { sandbox, call, requests } = runtime({
      'entry.js': `
        const seed = await Promise.resolve(3);
        export default { async homeContent() {
          const value = await import('./lazy.js');
          return JSON.stringify([seed, value.value, import.meta.url, import.meta.resolve('./asset')]);
        } };
      `,
      'lazy.js': 'export const value = 7;',
    });
    await sandbox.ensureLoaded();
    expect(requests).toEqual(['https://modules.test/entry.js']);
    expect(JSON.parse(String(await call()))).toEqual([3, 7, 'https://modules.test/entry.js', 'https://modules.test/asset']);
    await call();
    expect(requests.filter(url => url.endsWith('/lazy.js'))).toHaveLength(1);
  });
});

describe('bounded waits release resources', () => {
  it('releases its timer after successful and rejected tasks', async () => {
    vi.useFakeTimers();
    expect(await withTimeout(Promise.resolve(42), 1000, 'timeout')).toBe(42);
    await expect(withTimeout(Promise.reject(new Error('task')), 1000, 'timeout')).rejects.toThrow('task');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an unresolved task at its deadline', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 50, 'deadline');
    const assertion = expect(pending).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
