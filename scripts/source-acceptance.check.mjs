import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySourceMatrix } from './source-acceptance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function scenario(matrix, call, action) {
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const root = await mkdtemp(join(ROOT, '.tmp/source-matrix-check-'));
  await mkdir(join(root, '.tmp'));
  const input = join(root, 'matrix.json');
  await writeFile(input, JSON.stringify(matrix));
  try { await action(() => verifySourceMatrix(null, call, input, root), () => readFile(join(root, '.tmp/external-source-acceptance.json'), 'utf8').then(JSON.parse)); }
  finally { await rm(root, { recursive: true, force: true }); }
}

const url = 'https://provider.test/config.json';
const entry = { name: 'MacCMS sample', kind: 'maccms-json', url, probe: 'home', sourceKey: 'one' };
function fakeCall({ stale = false, items = 1, type = 1 } = {}) {
  return async (_page, namespace, method) => {
    if (method === 'cfgGet') return { activeProfileId: 'a', profiles: [{ id: 'a', apiUrl: stale ? 'https://unrelated.test/config' : url }], sources: [{ key: 'one', type }], lives: [] };
    if (namespace === 'vod') return { classes: [], items: Array.from({ length: items }, () => ({ id: 'movie' })) };
    return undefined;
  };
}

test('records actual normalized provider results and probe counts', async () => {
  await scenario([entry], fakeCall(), async (run, report) => {
    assert.equal((await run()).status, 'PASS');
    assert.equal((await report()).sources[0].items, 1);
  });
});
test('refuses a stale unrelated active profile after import', async () => {
  await scenario([entry], fakeCall({ stale: true }), async (run, report) => {
    await assert.rejects(run(), /active profile/);
    assert.equal((await report()).status, 'FAIL');
  });
});
test('does not accept empty or wrong-runtime provider responses', async () => {
  for (const options of [{ items: 0 }, { type: 3 }]) await scenario([entry], fakeCall(options), async (run, report) => {
    await assert.rejects(run());
    assert.equal((await report()).sources[0].status, 'FAIL');
  });
});
test('refuses an empty source matrix', async () => {
  await scenario([], fakeCall(), async run => { await assert.rejects(run(), /1 to 8/); });
});
