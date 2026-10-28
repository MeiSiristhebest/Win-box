import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pruneUnusedChromiumLocalePacks } from './package-locales.mjs';

test('retains supported Win-Box Chromium locales and removes other locale packs only', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'winbox-package-locales-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localeDirectory = join(root, 'locales');
  await mkdir(localeDirectory);
  await writeFile(join(localeDirectory, 'en-US.pak'), 'english');
  await writeFile(join(localeDirectory, 'zh-CN.pak'), 'simplified');
  await writeFile(join(localeDirectory, 'zh-TW.pak'), 'traditional');
  await writeFile(join(localeDirectory, 'ja.pak'), 'unused');
  await writeFile(join(localeDirectory, 'locale-manifest.json'), '{"ownedBy":"Electron"}');
  await mkdir(join(localeDirectory, 'nested.pak'));

  const result = await pruneUnusedChromiumLocalePacks(root);

  assert.deepEqual(result.retained.sort(), ['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
  assert.deepEqual(result.removed, [{ name: 'ja.pak', bytes: Buffer.byteLength('unused') }]);
  assert.equal(result.bytesSaved, Buffer.byteLength('unused'));
  assert.deepEqual((await readdir(localeDirectory)).sort(), ['en-US.pak', 'locale-manifest.json', 'nested.pak', 'zh-CN.pak', 'zh-TW.pak']);
  assert.equal(await readFile(join(localeDirectory, 'locale-manifest.json'), 'utf8'), '{"ownedBy":"Electron"}');
});

test('fails closed when an expected packaged locale is missing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'winbox-package-locales-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localeDirectory = join(root, 'locales');
  await mkdir(localeDirectory);
  await writeFile(join(localeDirectory, 'en-US.pak'), 'english');
  await writeFile(join(localeDirectory, 'ja.pak'), 'unused');

  await assert.rejects(pruneUnusedChromiumLocalePacks(root), /missing required Chromium locales: zh-CN\.pak, zh-TW\.pak/);
  assert.equal(await readFile(join(localeDirectory, 'ja.pak'), 'utf8'), 'unused');
});
