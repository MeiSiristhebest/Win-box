import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const KINDS = new Set(['maccms-json', 'tvbox-js', 'tvbox-jar', 'live']);

/** Explicit opt-in: sources can execute provider code through the normal application runtime. */
export async function verifySourceMatrix(page, call, matrixPath, root) {
  const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
  assert.ok(Array.isArray(matrix) && matrix.length > 0 && matrix.length <= 8, 'Source matrix must contain 1 to 8 entries.');
  const report = { recordedAt: new Date().toISOString(), status: 'RUNNING', sources: [] };
  try {
    for (const entry of matrix) {
      assert.ok(entry && typeof entry.name === 'string' && KINDS.has(entry.kind), 'Invalid source matrix name/kind.');
      const url = new URL(entry.url);
      assert.ok(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Source matrix requires HTTP(S) URLs without embedded credentials.');
      const result = { name: entry.name, kind: entry.kind, provider: url.origin + url.pathname, status: 'RUNNING' };
      report.sources.push(result);
      try {
        await call(page, 'config', 'importUrl', entry.url, entry.name);
        const config = await call(page, 'config', 'cfgGet');
        const profile = config.profiles.find(item => item.apiUrl === entry.url);
        assert.ok(profile, 'Source import did not produce an active profile.');
        await call(page, 'config', 'activateProfile', profile.id);
        const active = await call(page, 'config', 'cfgGet');
        result.sources = active.sources.length;
        result.lives = active.lives?.length || 0;
        assert.ok(result.sources >= (entry.minSources ?? (entry.kind === 'live' ? 0 : 1)), 'Source count below required minimum.');
        assert.ok(result.lives >= (entry.minLives ?? (entry.kind === 'live' ? 1 : 0)), 'Live count below required minimum.');
        const source = entry.sourceKey ? active.sources.find(item => item.key === entry.sourceKey) : active.sources[0];
        if (entry.probe === 'home' || entry.probe === 'search') {
          assert.ok(source, 'Requested probe source is missing.');
          const expectedType = { 'maccms-json': 1, 'tvbox-js': 3, 'tvbox-jar': 3 }[entry.kind];
          if (expectedType !== undefined) assert.equal(source.type, expectedType, 'Probe source type differs from the matrix.');
          const response = entry.probe === 'search'
            ? await call(page, 'vod', 'search', { key: source.key, wd: entry.query || '电影', profileId: profile.id })
            : await call(page, 'vod', 'home', source.key, profile.id);
          const items = Array.isArray(response) ? response : response?.items ?? response?.list ?? [];
          const classes = response?.classes ?? response?.class ?? [];
          assert.ok(Array.isArray(items) && Array.isArray(classes), 'Provider probe did not return valid list/class arrays.');
          assert.ok(items.length + classes.length >= (entry.minItems ?? 1), 'Provider probe returned too few items.');
          result.probe = entry.probe;
          result.items = items.length;
          result.classes = classes.length;
        } else assert.ok(!entry.probe || entry.probe === 'import', 'Unknown source probe.');
        result.status = 'PASS';
        console.log('PASS external source: ' + entry.name);
      } catch (error) {
        result.status = 'FAIL'; result.error = error.message;
        throw error;
      }
    }
    report.status = 'PASS';
    return report;
  } catch (error) {
    report.status = 'FAIL';
    throw error;
  } finally {
    await writeFile(join(root, '.tmp/external-source-acceptance.json'), JSON.stringify(report, null, 2));
  }
}
