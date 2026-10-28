import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRunCompletion, parseProcessSnapshot, parseProbeMemoryLog, parseResourceArgs, summarizeSnapshots } from './measure-runtime-resources.mjs';

test('requires a phase and a direct command without invoking a shell', () => {
  assert.throws(() => parseResourceArgs(['--phase', 'idle']), /Provide a command/);
  assert.throws(() => parseResourceArgs(['--', 'Win-Box.exe']), /--phase is required/);
  const parsed = parseResourceArgs(['--phase', 'local-playback', '--', 'node.exe', 'scripts/verify-playback.mjs']);
  assert.equal(parsed.phase, 'local-playback');
  assert.deepEqual(parsed.command, ['node.exe', 'scripts/verify-playback.mjs']);
});

test('validates sampling interval and explicit resource limits', () => {
  assert.throws(() => parseResourceArgs(['--phase', 'idle', '--interval-ms', '10', '--', 'app.exe']), /between 250 and 60000/);
  const parsed = parseResourceArgs([
    '--phase', 'idle', '--interval-ms', '1000', '--budget-working-set-mb', '500',
    '--budget-private-bytes-mb', '600', '--budget-cpu-p95-percent', '100', '--env', 'APPDATA=D:\\isolated=profile',
    '--include-name', 'WIN-BOX.EXE,electron.exe', '--', 'app.exe',
  ]);
  assert.deepEqual(parsed.budgets, { workingSetMB: 500, privateBytesMB: 600, cpuP95Percent: 100 });
  assert.equal(parsed.environment.APPDATA, 'D:\\isolated=profile');
  assert.deepEqual(parsed.includeNames, ['win-box.exe', 'electron.exe']);
});

test('normalizes process snapshot values and rejects malformed sampler output', () => {
  assert.deepEqual(parseProcessSnapshot(JSON.stringify({
    at: 1234,
    rootPresent: true,
    processes: [{ pid: '101', parentPid: '1', name: 'Win-Box.exe', workingSetBytes: '1048576', privateBytes: '2097152', cpuTimeMs: '12' }],
  })), {
    at: 1234,
    rootPresent: true,
    processes: [{ pid: 101, parentPid: 1, name: 'Win-Box.exe', workingSetBytes: 1048576, privateBytes: 2097152, cpuTimeMs: 12 }],
  });
  assert.throws(() => parseProcessSnapshot('not json'), /invalid JSON/);
  assert.throws(() => parseProcessSnapshot('{"at": 1}'), /invalid snapshot/);
});

test('summarizes process-tree Working Set, Private Bytes, CPU and configured budgets', () => {
  const row = (pid, workingSetMB, privateBytesMB, cpuTimeMs) => ({
    pid, parentPid: 100, name: pid === 100 ? 'Win-Box.exe' : 'mpv.exe',
    workingSetBytes: workingSetMB * 1_048_576,
    privateBytes: privateBytesMB * 1_048_576,
    cpuTimeMs,
  });
  const result = summarizeSnapshots([
    { at: 1000, rootPresent: true, processes: [row(100, 100, 200, 1000)] },
    { at: 2000, rootPresent: true, processes: [row(100, 150, 250, 1500), row(200, 50, 40, 300)] },
    { at: 3000, rootPresent: false, processes: [row(100, 160, 260, 2000), row(200, 50, 40, 600)] },
  ], { workingSetMB: 210, privateBytesMB: 280, cpuP95Percent: 75 });

  assert.equal(result.sampleCount, 3);
  assert.equal(result.durationMs, 2000);
  assert.deepEqual(result.peaks, { workingSetMB: 210, privateBytesMB: 300, cpuP95Percent: 80, cpuPeakPercent: 80, processCount: 2 });
  assert.equal(result.budgetStatus, 'FAIL');
  assert.equal(result.budgetChecks.workingSetMB.status, 'PASS');
  assert.equal(result.budgetChecks.privateBytesMB.status, 'FAIL');
  assert.equal(result.budgetChecks.cpuP95Percent.status, 'FAIL');
});

test('keeps measurements explicitly unbudgeted when no target was supplied', () => {
  const result = summarizeSnapshots([{ at: 1, rootPresent: false, processes: [] }]);
  assert.equal(result.budgetStatus, 'NOT_CONFIGURED');
  assert.equal(result.peaks.workingSetMB, 0);
  assert.equal(result.peaks.cpuP95Percent, null);
  assert.equal(result.samples[0].cpuPercent, null);
});

test('reports a planned measurement-window stop separately from an app crash', () => {
  assert.equal(classifyRunCompletion({ exitCode: 1, terminationRequested: true }), 'expected-window-stop');
  assert.equal(classifyRunCompletion({ exitCode: 1, terminationRequested: false }), 'failed');
  assert.equal(classifyRunCompletion({ exitCode: 0, terminationRequested: false }), 'completed');
});

test('extracts only numeric isolated memory-probe samples without retaining titles or process details', () => {
  const parsed = parseProbeMemoryLog([
    '2026-10-28T01:00:00.000Z [I] [mem] 播放内存基线开始（60s 窗口）',
    '2026-10-28T01:00:01.000Z [I] [mem] idle@15s total=424.2MB electron=410.1MB(5) children=14.1MB(2) | e=[player(片名)#11=300] | c=[mpv.exe#12=14.1]',
  ].join('\n'));
  assert.deepEqual(parsed, [{
    at: '2026-10-28T01:00:01.000Z', reason: 'idle@15s', totalMB: 424.2, electronMB: 410.1,
    electronProcessCount: 5, childMB: 14.1, childProcessCount: 2,
  }]);
  assert.equal(JSON.stringify(parsed).includes('片名'), false);
});
