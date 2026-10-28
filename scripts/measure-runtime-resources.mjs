import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INTERVAL_MS = 2_000;

function positiveNumber(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
}

export function parseResourceArgs(argv) {
  const separator = argv.indexOf('--');
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1) : [];
  const options = {
    phase: '',
    output: '',
    intervalMs: DEFAULT_INTERVAL_MS,
    terminateAfterMs: 0,
    includeNames: [],
    environment: {},
    probeLog: '',
    budgets: { workingSetMB: null, privateBytesMB: null, cpuP95Percent: null },
    command,
  };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const flag = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--phase') options.phase = value;
    else if (flag === '--output') options.output = value;
    else if (flag === '--interval-ms') options.intervalMs = positiveNumber(value, flag, { min: 250, max: 60_000 });
    else if (flag === '--terminate-after-ms') options.terminateAfterMs = positiveNumber(value, flag, { min: 1_000, max: 3_600_000 });
    else if (flag === '--include-name') {
      options.includeNames.push(...value.split(',').map(name => name.trim()).filter(Boolean));
    } else if (flag === '--env') {
      const separator = value.indexOf('=');
      if (separator < 1) throw new Error('--env must be NAME=value.');
      const name = value.slice(0, separator);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('--env has an invalid variable name.');
      options.environment[name] = value.slice(separator + 1);
    } else if (flag === '--probe-log') {
      options.probeLog = resolve(value);
    } else if (flag === '--budget-working-set-mb') {
      options.budgets.workingSetMB = positiveNumber(value, flag);
    } else if (flag === '--budget-private-bytes-mb') {
      options.budgets.privateBytesMB = positiveNumber(value, flag);
    } else if (flag === '--budget-cpu-p95-percent') {
      options.budgets.cpuP95Percent = positiveNumber(value, flag, { min: 1, max: 100_000 });
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
    index += 1;
  }

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(options.phase)) throw new Error('--phase is required and must use letters, numbers, underscore, or hyphen.');
  if (command.length < 1) throw new Error('Provide a command to launch after --.');
  options.output = resolve(options.output || `${ROOT}/.tmp/runtime-resources-${options.phase}-${Date.now()}.json`);
  options.includeNames = [...new Set(options.includeNames.map(name => name.toLowerCase()))];
  if (!options.output.toLowerCase().endsWith('.json')) throw new Error('--output must end in .json.');
  return options;
}

export function parseProcessSnapshot(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Windows process sampler returned invalid JSON.');
  }
  if (!value || !Number.isFinite(Number(value.at)) || !Array.isArray(value.processes)) {
    throw new Error('Windows process sampler returned an invalid snapshot.');
  }
  const processes = value.processes.map(row => ({
    pid: Number(row.pid),
    parentPid: Number(row.parentPid),
    name: String(row.name || ''),
    workingSetBytes: Number(row.workingSetBytes) || 0,
    privateBytes: Number(row.privateBytes) || 0,
    cpuTimeMs: Number(row.cpuTimeMs) || 0,
  })).filter(row => Number.isInteger(row.pid) && row.pid > 0 && row.name);
  return { at: Number(value.at), rootPresent: value.rootPresent === true, processes };
}

export function summarizeSnapshots(snapshots, budgets = {}) {
  const priorCpuByPid = new Map();
  const samples = [];
  let previousAt;
  for (const snapshot of snapshots) {
    const byPid = new Map(snapshot.processes.map(row => [row.pid, row]));
    const intervalMs = previousAt === undefined ? 0 : Math.max(1, snapshot.at - previousAt);
    let cpuDeltaMs = 0;
    if (previousAt !== undefined) {
      for (const row of snapshot.processes) {
        cpuDeltaMs += Math.max(0, row.cpuTimeMs - (priorCpuByPid.get(row.pid) ?? row.cpuTimeMs));
      }
    }
    priorCpuByPid.clear();
    for (const row of snapshot.processes) priorCpuByPid.set(row.pid, row.cpuTimeMs);
    previousAt = snapshot.at;
    samples.push({
      at: snapshot.at,
      elapsedMs: intervalMs,
      rootPresent: snapshot.rootPresent,
      processCount: snapshot.processes.length,
      workingSetMB: round1([...byPid.values()].reduce((sum, row) => sum + row.workingSetBytes, 0) / 1_048_576),
      privateBytesMB: round1([...byPid.values()].reduce((sum, row) => sum + row.privateBytes, 0) / 1_048_576),
      cpuTimeDeltaMs: previousAt === snapshot.at && intervalMs === 0 ? null : round1(cpuDeltaMs),
      cpuPercent: intervalMs ? round1(cpuDeltaMs / intervalMs * 100) : null,
      processes: [...byPid.values()],
    });
  }

  const peaks = {
    workingSetMB: max(samples.map(sample => sample.workingSetMB)),
    privateBytesMB: max(samples.map(sample => sample.privateBytesMB)),
    cpuP95Percent: percentile(samples.map(sample => sample.cpuPercent).filter(value => value !== null), 0.95),
    cpuPeakPercent: max(samples.map(sample => sample.cpuPercent).filter(value => value !== null)),
    processCount: max(samples.map(sample => sample.processCount)),
  };
  const configured = Object.values(budgets).some(value => Number.isFinite(value));
  const checks = {
    workingSetMB: checkBudget(peaks.workingSetMB, budgets.workingSetMB),
    privateBytesMB: checkBudget(peaks.privateBytesMB, budgets.privateBytesMB),
    cpuP95Percent: checkBudget(peaks.cpuP95Percent, budgets.cpuP95Percent),
  };
  const configuredChecks = Object.values(checks).filter(item => item.status !== 'NOT_CONFIGURED');
  const budgetStatus = !configured
    ? 'NOT_CONFIGURED'
    : configuredChecks.some(item => item.status === 'INSUFFICIENT_SAMPLES')
      ? 'INSUFFICIENT_SAMPLES'
      : configuredChecks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
  return {
    sampleCount: samples.length,
    durationMs: samples.length ? Math.max(0, samples.at(-1).at - samples[0].at) : 0,
    peaks,
    budgets: { ...budgets },
    budgetStatus,
    budgetChecks: checks,
    samples,
  };
}

export function parseProbeMemoryLog(text) {
  const samples = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('[mem]')) continue;
    const match = line.match(/^(\S+) \[[^\]]+\] \[mem\] (\S+) total=([\d.]+)MB electron=([\d.]+)MB\((\d+)\) children=([\d.]+)MB\((\d+)\)/);
    if (!match) continue;
    samples.push({
      at: match[1],
      reason: match[2],
      totalMB: Number(match[3]),
      electronMB: Number(match[4]),
      electronProcessCount: Number(match[5]),
      childMB: Number(match[6]),
      childProcessCount: Number(match[7]),
    });
  }
  return samples;
}

export function classifyRunCompletion({ exitCode, terminationRequested }) {
  if (terminationRequested) return 'expected-window-stop';
  return exitCode === 0 ? 'completed' : 'failed';
}

function checkBudget(actual, limit) {
  if (!Number.isFinite(limit)) return { status: 'NOT_CONFIGURED', limit: null, actual };
  if (!Number.isFinite(actual)) return { status: 'INSUFFICIENT_SAMPLES', limit, actual: null };
  return { status: actual <= limit ? 'PASS' : 'FAIL', limit, actual };
}

function max(values) {
  return values.length ? round1(Math.max(...values)) : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return round1(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function makeSamplerScript(rootPid, intervalMs, includeNames) {
  const includeLiteral = `@(${includeNames.map(psString).join(',')})`;
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$rootPid = ${rootPid}
$intervalMs = ${intervalMs}
$includeNames = ${includeLiteral}
$filterNames = $includeNames.Count -gt 0
while ($true) {
  $all = @(Get-CimInstance -ClassName Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount, UserModeTime, KernelModeTime)
  $children = @{}
  foreach ($item in $all) {
    $parent = [string]$item.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent] = [System.Collections.Generic.List[int]]::new() }
    $children[$parent].Add([int]$item.ProcessId)
  }
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $queue = [System.Collections.Generic.Queue[int]]::new()
  [void]$seen.Add($rootPid)
  $queue.Enqueue($rootPid)
  while ($queue.Count -gt 0) {
    $parent = [string]$queue.Dequeue()
    if ($children.ContainsKey($parent)) {
      foreach ($child in $children[$parent]) { if ($seen.Add($child)) { $queue.Enqueue($child) } }
    }
  }
  $rootPresent = @($all | Where-Object { [int]$_.ProcessId -eq $rootPid }).Count -gt 0
  $rows = @($all | Where-Object {
    $processId = [int]$_.ProcessId
    $name = [string]$_.Name
    $seen.Contains($processId) -and (-not $filterNames -or $includeNames -contains $name.ToLowerInvariant())
  } | ForEach-Object {
    [ordered]@{
      pid = [int]$_.ProcessId
      parentPid = [int]$_.ParentProcessId
      name = [string]$_.Name
      workingSetBytes = [double]$_.WorkingSetSize
      privateBytes = [double]$_.PrivatePageCount
      cpuTimeMs = [double](($_.UserModeTime + $_.KernelModeTime) / 10000)
    }
  })
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([ordered]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); rootPresent = $rootPresent; processes = $rows }) -Depth 4 -Compress))
  [Console]::Out.Flush()
  if (-not $rootPresent) { break }
  Start-Sleep -Milliseconds $intervalMs
}
`;
}

function terminateTree(pid) {
  if (process.platform !== 'win32') return;
  const executable = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\taskkill.exe`;
  const result = spawnSync(executable, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000, encoding: 'utf8' });
  if (result.error && result.error.code !== 'ESRCH') throw result.error;
  if (result.status !== 0 && !/not found|no running instance/i.test(`${result.stdout || ''} ${result.stderr || ''}`)) {
    throw new Error(`Could not terminate isolated process tree ${pid}: ${result.stderr || result.stdout}`);
  }
}

async function run(options) {
  assert.equal(process.platform, 'win32', 'Runtime resource sampling requires Windows.');
  const [executable, ...args] = options.command;
  const child = spawn(executable, args, { cwd: ROOT, env: { ...process.env, ...options.environment }, windowsHide: true, stdio: 'inherit' });
  if (!child.pid) throw new Error(`Could not start ${basename(executable)}.`);

  const psPath = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const psScript = makeSamplerScript(child.pid, options.intervalMs, options.includeNames);
  const sampler = spawn(psPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(psScript, 'utf16le').toString('base64')], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const snapshots = [];
  const samplerErrors = [];
  let buffer = '';
  const consume = line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try { snapshots.push(parseProcessSnapshot(trimmed)); }
    catch (error) { samplerErrors.push(error.message); }
  };
  sampler.stdout.setEncoding('utf8');
  sampler.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(consume);
  });
  let samplerStderr = '';
  sampler.stderr.setEncoding('utf8');
  sampler.stderr.on('data', chunk => { samplerStderr = (samplerStderr + chunk).slice(-4000); });
  sampler.on('error', error => samplerErrors.push(error.message));

  let terminationRequested = false;
  const terminateTimer = options.terminateAfterMs
    ? setTimeout(() => {
      terminationRequested = true;
      try { terminateTree(child.pid); } catch (error) { samplerErrors.push(error.message); }
    }, options.terminateAfterMs)
    : null;
  const [exitCode, signal] = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, childSignal) => resolveExit([code, childSignal]));
  });
  if (terminateTimer) clearTimeout(terminateTimer);
  if (buffer.trim()) consume(buffer);
  const samplerExit = await new Promise(resolveExit => {
    if (sampler.exitCode !== null || sampler.signalCode !== null) resolveExit({ code: sampler.exitCode, signal: sampler.signalCode });
    else {
      const timeout = setTimeout(() => {
        sampler.kill();
        resolveExit({ code: null, signal: 'cleanup-timeout' });
      }, options.intervalMs * 3 + 5_000);
      sampler.once('exit', (code, childSignal) => {
        clearTimeout(timeout);
        resolveExit({ code, signal: childSignal });
      });
    }
  });
  if (buffer.trim()) consume(buffer);
  if (samplerExit.signal === 'cleanup-timeout') samplerErrors.push('PowerShell process sampler did not exit after the application ended.');
  if (samplerExit.code !== 0 && samplerExit.signal !== 'cleanup-timeout') samplerErrors.push(`PowerShell sampler exited with code ${samplerExit.code}.`);

  const completion = classifyRunCompletion({ exitCode, terminationRequested });
  const summary = summarizeSnapshots(snapshots, options.budgets);
  const probeMemorySamples = options.probeLog ? parseProbeMemoryLog(await readFile(options.probeLog, 'utf8')) : [];
  const report = {
    recordedAt: new Date().toISOString(),
    phase: options.phase,
    command: basename(executable),
    rootPid: child.pid,
    exitCode,
    signal,
    completion,
    intervalMs: options.intervalMs,
    includedProcessNames: options.includeNames,
    environmentNames: Object.keys(options.environment),
    terminateAfterMs: options.terminateAfterMs || null,
    probeMemorySamples,
    sampler: { exitCode: samplerExit.code, signal: samplerExit.signal, errors: samplerErrors, stderr: samplerStderr },
    summary,
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output: options.output, phase: report.phase, rootPid: report.rootPid, exitCode, completion, summary: { sampleCount: summary.sampleCount, durationMs: summary.durationMs, peaks: summary.peaks, budgetStatus: summary.budgetStatus, budgetChecks: summary.budgetChecks }, sampler: report.sampler }, null, 2));
  if (samplerErrors.length || summary.sampleCount < 2) process.exitCode = 2;
  else if (completion === 'failed') process.exitCode = exitCode ?? 1;
  else if (summary.budgetStatus === 'FAIL') process.exitCode = 3;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(parseResourceArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
