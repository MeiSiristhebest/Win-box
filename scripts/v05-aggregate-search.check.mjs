import assert from 'node:assert/strict';
import test from 'node:test';
import { parseV05SearchArgs, metricSet, summarizeV05Search } from './v05-aggregate-search.mjs';

const ROOT = process.cwd();

test('V05 search CLI only accepts isolated .tmp/v05-search output and ten or more cycles', () => {
  const parsed = parseV05SearchArgs(['--cycles', '10', '--sources', '1000', '--output-dir', '.tmp/v05-search-check']);
  assert.equal(parsed.cycles, 10);
  assert.equal(parsed.sources, 1000);
  assert.equal(parsed.outputDirectory, `${ROOT}\\.tmp\\v05-search-check`);
  assert.throws(() => parseV05SearchArgs(['--cycles', '9', '--output-dir', '.tmp/v05-search-check']), /between 10 and 50/);
  assert.throws(() => parseV05SearchArgs(['--sources', '999', '--output-dir', '.tmp/v05-search-check']), /between 1000 and 1000/);
  assert.throws(() => parseV05SearchArgs(['--output-dir', 'architecture-audit/evidence/v05-search-check']), /direct child/);
  assert.throws(() => parseV05SearchArgs(['--output-dir', '.tmp/../architecture-audit/v05-search-check']), /direct child/);
});

test('V05 metric percentiles use nearest-rank p50 and p95 and report the peak', () => {
  assert.deepEqual(metricSet([5, 1, 4, 2, 3]), { p50: 3, p95: 5, peak: 5 });
  assert.deepEqual(metricSet([]), { p50: null, p95: null, peak: null });
});

test('V05 summary cannot pass when synthetic cycles or resource samples are missing', () => {
  const incomplete = summarizeV05Search({ status: 'PASS', requestedCycles: 10, sourcesPerCycle: 1000, profileCount: 3, concurrencyLimit: 48, cycles: [] }, null, '.tmp/v05-search-check');
  assert.equal(incomplete.status, 'FAIL');
  assert.equal(incomplete.scope.externalSources, 'NOT_ACCESSED');
  assert.equal(incomplete.scope.userConfiguration, 'NOT_ACCESSED; all three profiles and all source entries are generated in-process');
  assert.equal(incomplete.sampler.budgetStatus, 'NOT_CONFIGURED');
  assert.ok(incomplete.limitations.some(item => item.toLowerCase().includes('budgets are configured')));
});
