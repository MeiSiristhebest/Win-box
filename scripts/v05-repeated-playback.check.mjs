import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRepeatedPlaybackArgs, summarizeProcessSamples, summarizeV05Run } from './v05-repeated-playback.mjs';

test('V05 run requires a packaged app, ten cycles, and a new .tmp/v05-* output directory', () => {
  assert.throws(() => parseRepeatedPlaybackArgs([]), /--packaged-app is required/);
  assert.throws(() => parseRepeatedPlaybackArgs(['--packaged-app', '.tmp/app']), /--output-dir is required/);
  assert.throws(() => parseRepeatedPlaybackArgs(['--packaged-app', '.tmp/app', '--output-dir', '.tmp/v05-x', '--cycles', '9']), /between 10 and 50/);
  assert.throws(() => parseRepeatedPlaybackArgs(['--packaged-app', 'D:/outside/app', '--output-dir', '.tmp/v05-x']), /inside the workspace/);
  assert.throws(() => parseRepeatedPlaybackArgs(['--packaged-app', '.tmp/app', '--output-dir', '.tmp/other']), /direct child.*named v05/);
  const options = parseRepeatedPlaybackArgs([
    '--packaged-app', '.tmp/app', '--output-dir', '.tmp/v05-run', '--cycles', '10',
    '--budget-working-set-mb', '900', '--budget-private-bytes-mb', '700', '--budget-cpu-p95-percent', '120',
  ]);
  assert.equal(options.cycles, 10);
  assert.deepEqual(options.budgets, { workingSetMB: 900, privateBytesMB: 700, cpuP95Percent: 120 });
  assert.throws(() => parseRepeatedPlaybackArgs([
    '--packaged-app', '.tmp/app', '--output-dir', '.tmp/v05-run', '--budget-working-set-mb', 'NaN',
  ]), /positive number/);
});

test('V05 resource summary separates app, MPV and driver while reporting percentiles and peaks', () => {
  const samples = [
    { at: 1000, elapsedMs: 0, workingSetMB: 30, privateBytesMB: 20, processCount: 1, processes: [{ pid: 10, name: 'node.exe', workingSetBytes: 30 * 1048576, privateBytes: 20 * 1048576, cpuTimeMs: 100 }] },
    { at: 2000, elapsedMs: 1000, workingSetMB: 160, privateBytesMB: 100, processCount: 3, processes: [
      { pid: 10, name: 'node.exe', workingSetBytes: 35 * 1048576, privateBytes: 25 * 1048576, cpuTimeMs: 200 },
      { pid: 20, name: 'Win-Box.exe', workingSetBytes: 100 * 1048576, privateBytes: 60 * 1048576, cpuTimeMs: 300 },
      { pid: 30, name: 'mpv.exe', workingSetBytes: 25 * 1048576, privateBytes: 15 * 1048576, cpuTimeMs: 150 },
    ] },
    { at: 3000, elapsedMs: 1000, workingSetMB: 180, privateBytesMB: 120, processCount: 3, processes: [
      { pid: 10, name: 'node.exe', workingSetBytes: 40 * 1048576, privateBytes: 30 * 1048576, cpuTimeMs: 250 },
      { pid: 20, name: 'Win-Box.exe', workingSetBytes: 110 * 1048576, privateBytes: 70 * 1048576, cpuTimeMs: 500 },
      { pid: 30, name: 'mpv.exe', workingSetBytes: 30 * 1048576, privateBytes: 20 * 1048576, cpuTimeMs: 200 },
    ] },
  ];
  const summary = summarizeProcessSamples(samples);
  assert.deepEqual(summary.processTree.workingSetMiB, { p50: 160, p95: 180, peak: 180 });
  assert.deepEqual(summary.processTree.privateBytesMiB, { p50: 100, p95: 120, peak: 120 });
  const app = summary.byExecutable.find(item => item.name === 'Win-Box.exe');
  assert.deepEqual(app.workingSetMiB, { p50: 100, p95: 110, peak: 110 });
  assert.equal(app.role.includes('Chromium main, renderer, GPU and utility roles are not separable'), true);
  const driver = summary.byExecutable.find(item => item.name === 'node.exe');
  assert.equal(driver.role, 'acceptance driver and local fixture server');
  assert.deepEqual(summary.processTree.cpuPercent, { p50: 10, p95: 30, peak: 30 });
});

test('V05 run summary does not mark unmeasured source search or budgets as passed', () => {
  const cycleReport = { requestedCycles: 10, status: 'PASS', cycles: [{ index: 1, status: 'PASS', startedAtMs: 1000, endedAtMs: 3000, durationMs: 2000, appPid: 20, processExited: true, cleaned: true, rendererErrorCount: 0, completedChecks: ['html5', 'mpv'] }] };
  const resourceReport = { completion: 'completed', intervalMs: 1000, sampler: { errors: [] }, summary: { sampleCount: 1, durationMs: 0, budgetStatus: 'NOT_CONFIGURED', budgetChecks: {}, samples: [{ at: 2000, elapsedMs: 1000, workingSetMB: 10, privateBytesMB: 5, processCount: 1, processes: [{ pid: 20, name: 'Win-Box.exe', workingSetBytes: 10485760, privateBytes: 5242880, cpuTimeMs: 0 }] }] } };
  const summary = summarizeV05Run(cycleReport, resourceReport);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.workload.search, 'NOT_RUN; this V05 workload measures repeated local playback lifecycle, not aggregate-search performance');
  assert.equal(summary.sampler.budgetStatus, 'NOT_CONFIGURED');
  assert.equal(summary.cycles[0].processExited, true);
});

test('V05 playback summary fails if a configured process resource budget fails or is inconclusive', () => {
  const cycleReport = { requestedCycles: 10, status: 'PASS', cycles: [{ index: 1, status: 'PASS', startedAtMs: 1000, endedAtMs: 3000, durationMs: 2000, appPid: 20, processExited: true, cleaned: true, rendererErrorCount: 0, completedChecks: ['html5', 'mpv'] }] };
  const resourceReport = {
    completion: 'completed', intervalMs: 1000, sampler: { errors: [] },
    summary: {
      sampleCount: 2, durationMs: 1000, budgetStatus: 'FAIL',
      budgets: { workingSetMB: 100, privateBytesMB: null, cpuP95Percent: null },
      budgetChecks: { workingSetMB: { status: 'FAIL', limit: 100, actual: 150 } },
      samples: [{ at: 2000, elapsedMs: 500, workingSetMB: 150, privateBytesMB: 50, processCount: 1, processes: [{ pid: 20, name: 'Win-Box.exe', workingSetBytes: 150 * 1048576, privateBytes: 50 * 1048576, cpuTimeMs: 0 }] }, { at: 2500, elapsedMs: 500, workingSetMB: 150, privateBytesMB: 50, processCount: 1, processes: [{ pid: 20, name: 'Win-Box.exe', workingSetBytes: 150 * 1048576, privateBytes: 50 * 1048576, cpuTimeMs: 0 }] }],
    },
  };

  assert.equal(summarizeV05Run(cycleReport, resourceReport).status, 'FAIL');
  resourceReport.summary.budgetStatus = 'INSUFFICIENT_SAMPLES';
  assert.equal(summarizeV05Run(cycleReport, resourceReport).status, 'FAIL');
});
