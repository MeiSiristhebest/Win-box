import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseV05SearchArgs, metricSet, summarizeV05Search } from './v05-aggregate-search.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('V05 search CLI only accepts isolated .tmp/v05-search output and ten or more cycles', () => {
  const parsed = parseV05SearchArgs(['--cycles', '10', '--sources', '1000', '--output-dir', '.tmp/v05-search-check']);
  assert.equal(parsed.cycles, 10);
  assert.equal(parsed.sources, 1000);
  assert.equal(parsed.outputDirectory, resolve(ROOT, '.tmp', 'v05-search-check'));
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

test('V05 summary requires and reports 1,001-source timeout, cancellation cleanup, and recovery evidence', () => {
  const cycles = Array.from({ length: 10 }, (_value, index) => ({
    index: index + 1,
    status: 'PASS',
    requestsReceived: 1000,
    reportItems: 1000,
    hitSources: 1000,
    failedSources: 0,
    durationMs: 100,
    throughputSourcesPerSecond: 10000,
    requestLatencyMs: [4],
    dispatchOffsetMs: [1],
    cpuPercent: 10,
    memorySamples: [],
  }));
  const resilienceScenarios = [
    { name: 'mixed-success-timeout', status: 'PASS', sourceCount: 1001, receivedRequests: 1001, hitSources: 988, failedSources: 13, firstResultMs: 5, totalDurationMs: 5100, peakConcurrentRequests: 48, cancelledRequests: 0, timedOutRequests: 1, explicitFixtureFailures: 12, activeRequestsAfterSettle: 0 },
    { name: 'cancel-after-first-result', status: 'PASS', sourceCount: 1001, receivedRequests: 48, hitSources: 1, failedSources: null, firstResultMs: 5, totalDurationMs: 8, peakConcurrentRequests: 48, cancelledRequests: 47, timedOutRequests: 0, explicitFixtureFailures: 0, activeRequestsAfterSettle: 0, cancellationOutcome: 'AbortError: synthetic cancellation after first result' },
    { name: 'recovery-after-cancel', status: 'PASS', sourceCount: 1001, receivedRequests: 1001, hitSources: 1001, failedSources: 0, firstResultMs: 5, totalDurationMs: 100, peakConcurrentRequests: 48, cancelledRequests: 0, timedOutRequests: 0, explicitFixtureFailures: 0, activeRequestsAfterSettle: 0 },
  ];
  const workload = {
    status: 'PASS',
    requestedCycles: 10,
    sourcesPerCycle: 1000,
    profileCount: 3,
    concurrencyLimit: 48,
    cycles,
    resilienceScenarios,
  };
  const sample = { elapsedMs: 100, workingSetMB: 10, privateBytesMB: 8, processCount: 1, processes: [{ pid: 1, name: 'node.exe', workingSetBytes: 10 * 1048576, privateBytes: 8 * 1048576, cpuTimeMs: 10 }] };
  const resourceReport = {
    completion: 'completed',
    intervalMs: 250,
    sampler: { errors: [] },
    summary: { sampleCount: 2, durationMs: 200, budgetStatus: 'NOT_CONFIGURED', budgetChecks: {}, samples: [sample, { ...sample, elapsedMs: 100 }] },
  };

  const summary = summarizeV05Search(workload, resourceReport, '.tmp/v05-search-check');
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.scope.resilienceLocalHttpRequests, 2050);
  assert.deepEqual(summary.performance.resilienceScenarios.map(item => item.name), [
    'mixed-success-timeout',
    'cancel-after-first-result',
    'recovery-after-cancel',
  ]);
  assert.equal(summary.performance.resilienceScenarios[1].activeRequestsAfterSettle, 0);

  resilienceScenarios[1].cancelledRequests = 0;
  assert.equal(summarizeV05Search(workload, resourceReport, '.tmp/v05-search-check').status, 'FAIL');
});
