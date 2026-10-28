import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPlayback } from './verify-playback.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const SCRIPT = fileURLToPath(import.meta.url);
const MEASURER = join(ROOT, 'scripts', 'measure-runtime-resources.mjs');
const inside = (parent, target) => {
  const rel = relative(parent, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function positiveBudget(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100_000) throw new Error(`${label} must be a positive number no greater than 100000.`);
  return number;
}

const RESOURCE_BUDGET_FLAGS = [
  ['--budget-working-set-mb', 'workingSetMB'],
  ['--budget-private-bytes-mb', 'privateBytesMB'],
  ['--budget-cpu-p95-percent', 'cpuP95Percent'],
];

function resourceBudgetArgs(budgets) {
  return RESOURCE_BUDGET_FLAGS.flatMap(([flag, key]) => Number.isFinite(budgets[key]) ? [flag, String(budgets[key])] : []);
}

export function parseRepeatedPlaybackArgs(args) {
  const options = { packagedAppDirectory: '', cycles: 10, outputDirectory: '', worker: false, budgets: { workingSetMB: null, privateBytesMB: null, cpuP95Percent: null } };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--worker') { options.worker = true; continue; }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--packaged-app') options.packagedAppDirectory = resolve(value);
    else if (flag === '--cycles') options.cycles = positiveInteger(value, flag);
    else if (flag === '--output-dir') options.outputDirectory = resolve(value);
    else if (RESOURCE_BUDGET_FLAGS.some(([budgetFlag]) => budgetFlag === flag)) {
      const key = RESOURCE_BUDGET_FLAGS.find(([budgetFlag]) => budgetFlag === flag)[1];
      options.budgets[key] = positiveBudget(value, flag);
    }
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  if (!options.packagedAppDirectory) throw new Error('--packaged-app is required.');
  if (!options.outputDirectory) throw new Error('--output-dir is required.');
  if (options.cycles < 10 || options.cycles > 50) throw new Error('--cycles must be between 10 and 50.');
  if (!inside(TMP, options.outputDirectory) || dirname(options.outputDirectory) !== TMP || !/^v05-[A-Za-z0-9_-]+$/.test(options.outputDirectory.slice(TMP.length + 1))) {
    throw new Error('--output-dir must be a new direct child of workspace .tmp named v05-*.');
  }
  if (!inside(ROOT, options.packagedAppDirectory)) throw new Error('--packaged-app must be inside the workspace.');
  return options;
}

function percentile(values, fraction) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return null;
  return round1(finite[Math.max(0, Math.ceil(fraction * finite.length) - 1)]);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function metricSet(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    peak: values.filter(Number.isFinite).length ? round1(Math.max(...values.filter(Number.isFinite))) : null,
  };
}

function executableRole(name) {
  const normalized = name.toLowerCase();
  if (normalized === 'win-box.exe') return 'Win-Box/Electron process image; Chromium main, renderer, GPU and utility roles are not separable here';
  if (normalized === 'mpv.exe') return 'managed MPV playback process';
  if (normalized === 'node.exe') return 'acceptance driver and local fixture server';
  return `process image ${name}`;
}

/** Summarize already sampled rows without treating the test driver as app memory. */
export function summarizeProcessSamples(samples) {
  const priorCpuByPid = new Map();
  const names = new Set(samples.flatMap(sample => sample.processes.map(row => row.name)));
  const grouped = new Map([...names].map(name => [name, { workingSet: [], privateBytes: [], cpu: [], processCount: [] }]));
  const treeWorkingSet = [];
  const treePrivateBytes = [];
  const treeCpu = [];
  const processCount = [];

  for (const sample of samples) {
    const currentCpuByPid = new Map();
    const groupedRows = new Map();
    let treeCpuMs = 0;
    for (const row of sample.processes) {
      const name = row.name;
      const group = groupedRows.get(name) ?? { workingSet: 0, privateBytes: 0, cpuMs: 0, count: 0 };
      group.workingSet += row.workingSetBytes;
      group.privateBytes += row.privateBytes;
      group.count += 1;
      const priorCpu = priorCpuByPid.get(row.pid);
      const delta = sample.elapsedMs > 0 && Number.isFinite(priorCpu) ? Math.max(0, row.cpuTimeMs - priorCpu) : 0;
      group.cpuMs += delta;
      treeCpuMs += delta;
      groupedRows.set(name, group);
      currentCpuByPid.set(row.pid, row.cpuTimeMs);
    }
    priorCpuByPid.clear();
    for (const [pid, cpu] of currentCpuByPid) priorCpuByPid.set(pid, cpu);
    treeWorkingSet.push(sample.workingSetMB);
    treePrivateBytes.push(sample.privateBytesMB);
    treeCpu.push(sample.elapsedMs > 0 ? treeCpuMs / sample.elapsedMs * 100 : null);
    processCount.push(sample.processCount);
    for (const [name, series] of grouped) {
      const current = groupedRows.get(name);
      series.workingSet.push(round1((current?.workingSet ?? 0) / 1_048_576));
      series.privateBytes.push(round1((current?.privateBytes ?? 0) / 1_048_576));
      series.cpu.push(sample.elapsedMs > 0 ? round1((current?.cpuMs ?? 0) / sample.elapsedMs * 100) : null);
      series.processCount.push(current?.count ?? 0);
    }
  }

  return {
    sampleCount: samples.length,
    durationMs: samples.length ? Math.max(0, samples.at(-1).at - samples[0].at) : 0,
    processTree: {
      workingSetMiB: metricSet(treeWorkingSet),
      privateBytesMiB: metricSet(treePrivateBytes),
      cpuPercent: metricSet(treeCpu),
      processCountPeak: processCount.length ? Math.max(...processCount) : 0,
    },
    byExecutable: [...grouped].map(([name, series]) => ({
      name,
      role: executableRole(name),
      processCountPeak: series.processCount.length ? Math.max(...series.processCount) : 0,
      workingSetMiB: metricSet(series.workingSet),
      privateBytesMiB: metricSet(series.privateBytes),
      cpuPercent: metricSet(series.cpu),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await rename(temporaryPath, path);
}

async function validatePaths(options) {
  const realTmp = await realpath(TMP);
  const realOutputParent = await realpath(dirname(options.outputDirectory));
  assert.equal(realOutputParent, realTmp, 'V05 output parent must resolve to workspace .tmp.');
  const executable = join(options.packagedAppDirectory, 'Win-Box.exe');
  const executableInfo = await import('node:fs/promises').then(fs => fs.stat(executable).catch(() => null));
  assert.ok(executableInfo?.isFile(), 'Packaged candidate is missing Win-Box.exe.');
  return executable;
}

async function runWorker(options) {
  await validatePaths(options);
  const cyclesPath = join(options.outputDirectory, 'cycles.json');
  const cycles = { schemaVersion: 1, requestedCycles: options.cycles, status: 'RUNNING', workload: 'fresh isolated packaged Win-Box launch; local loopback repository import; generated VP8 video; HTML5 → managed MPV → automatic kernel; seek/pause/resume; close player and app', cycles: [] };
  await writeJsonAtomically(cyclesPath, cycles);
  for (let index = 1; index <= options.cycles; index += 1) {
    const cycle = { index, status: 'RUNNING', startedAt: new Date().toISOString(), startedAtMs: Date.now() };
    cycles.cycles.push(cycle);
    await writeJsonAtomically(cyclesPath, cycles);
    try {
      const acceptance = await verifyPlayback({
        packagedAppDirectory: options.packagedAppDirectory,
        artifactDirectory: join(options.outputDirectory, `cycle-${String(index).padStart(2, '0')}`),
        playbackOnly: true,
      });
      cycle.status = acceptance.status;
      cycle.completedChecks = acceptance.steps.map(step => step.name);
      cycle.appPid = acceptance.electronPid;
      cycle.processExited = acceptance.processExited;
      cycle.cleaned = acceptance.cleaned;
      cycle.rendererErrorCount = acceptance.rendererErrors.length;
      if (acceptance.status !== 'PASS' || !acceptance.processExited || !acceptance.cleaned || acceptance.rendererErrors.length) {
        throw new Error(`Cycle ${index} acceptance did not complete cleanly.`);
      }
      cycle.endedAt = new Date().toISOString();
      cycle.endedAtMs = Date.now();
      cycle.durationMs = cycle.endedAtMs - cycle.startedAtMs;
      await writeJsonAtomically(cyclesPath, cycles);
      console.log(`V05 cycle ${index}/${options.cycles} PASS (${cycle.durationMs} ms, pid ${cycle.appPid})`);
    } catch (error) {
      cycle.status = 'FAIL';
      cycle.error = String(error?.stack || error);
      cycle.endedAt = new Date().toISOString();
      cycle.endedAtMs = Date.now();
      cycle.durationMs = cycle.endedAtMs - cycle.startedAtMs;
      cycles.status = 'FAIL';
      await writeJsonAtomically(cyclesPath, cycles);
      throw error;
    }
  }
  cycles.status = 'PASS';
  await writeJsonAtomically(cyclesPath, cycles);
}

export function summarizeV05Run(cycleReport, resourceReport) {
  const samples = resourceReport.summary.samples;
  const cycles = cycleReport.cycles.map(cycle => {
    const scoped = cycle.endedAtMs
      ? samples.filter(sample => sample.at >= cycle.startedAtMs && sample.at <= cycle.endedAtMs)
      : [];
    const durationValues = cycle.durationMs ? [cycle.durationMs] : [];
    return {
      index: cycle.index,
      status: cycle.status,
      durationMs: cycle.durationMs ?? null,
      sampleCount: scoped.length,
      applicationPid: cycle.appPid ?? null,
      processExited: cycle.processExited ?? false,
      cleaned: cycle.cleaned ?? false,
      rendererErrorCount: cycle.rendererErrorCount ?? null,
      completionChecks: cycle.completedChecks ?? [],
      resources: summarizeProcessSamples(scoped),
      durationMsStats: metricSet(durationValues),
    };
  });
  const budgetStatus = resourceReport.summary.budgetStatus ?? 'NOT_CONFIGURED';
  const budgetValid = budgetStatus === 'NOT_CONFIGURED' || budgetStatus === 'PASS';
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    status: cycleReport.status === 'PASS' && resourceReport.completion === 'completed' && resourceReport.sampler.errors.length === 0 && budgetValid ? 'PASS' : 'FAIL',
    workload: {
      cyclesRequested: cycleReport.requestedCycles,
      cyclesCompleted: cycleReport.cycles.filter(cycle => cycle.status === 'PASS').length,
      cycleDurationMs: metricSet(cycleReport.cycles.map(cycle => cycle.durationMs)),
      fixture: 'per-cycle browser-generated local VP8 WebM, 320x180, approximately 14 seconds, served over loopback by existing acceptance fixture',
      operations: ['isolated app/profile startup', 'import two local fixture profiles and activate one', 'HTML5 real decode/progress/pause/resume', 'switch to MPV, seek and pause/resume', 'restore automatic kernel and paused position', 'close player and application; verify process cleanup'],
      externalSources: 'NOT_RUN',
      userDatabase: 'NOT_ACCESSED; each cycle uses a fresh temporary APPDATA/LOCALAPPDATA/portable profile',
      search: 'NOT_RUN; this V05 workload measures repeated local playback lifecycle, not aggregate-search performance',
    },
    sampler: {
      intervalMs: resourceReport.intervalMs,
      sampleCount: resourceReport.summary.sampleCount,
      durationMs: resourceReport.summary.durationMs,
      errors: resourceReport.sampler.errors,
      budgetStatus: resourceReport.summary.budgetStatus,
      budgetChecks: resourceReport.summary.budgetChecks,
      budgets: resourceReport.summary.budgets ?? { workingSetMB: null, privateBytesMB: null, cpuP95Percent: null },
    },
    resources: summarizeProcessSamples(samples),
    cycles,
    limitations: [
      'Deterministic 320x180 VP8 local fixture does not represent 1080p/4K decoding, dense danmaku, external network sources, or a 1,000-source search catalog.',
      'Win-Box.exe process rows combine Electron/Chromium main, renderer, GPU, and utility roles; the Windows sampler records image name and parent PID, not Chromium --type arguments.',
      'node.exe attribution includes the Playwright acceptance driver and local fixture server; do not count it as application memory.',
      budgetStatus === 'NOT_CONFIGURED'
        ? 'No performance budget was configured. Ten runs show repeatability and resource ranges only; they do not establish a pass/fail budget or prove absence of leaks.'
        : 'Configured budgets apply to the Win-Box.exe and mpv.exe process images sampled by this local fixture workload; they are candidate regression guardrails, not cross-device guarantees.',
      'Each cycle launches and closes a fresh isolated app process; it does not exercise same-process profile switching or persistent real user state.',
      'Per-cycle percentiles use one-second samples inside that cycle; the first CPU interval after a process appears has no prior sample and contributes zero delta.',
    ],
  };
}

async function runMeasured(options) {
  assert.equal(process.platform, 'win32', 'V05 process-tree sampling requires Windows.');
  await validatePaths(options);
  await mkdir(options.outputDirectory, { recursive: false });
  const resourcesPath = join(options.outputDirectory, 'resources.json');
  const workerArgs = [SCRIPT, '--worker', '--packaged-app', options.packagedAppDirectory, '--cycles', String(options.cycles), '--output-dir', options.outputDirectory];
  const samplerArgs = [MEASURER, '--phase', 'v05-repeat', '--output', resourcesPath, '--interval-ms', '1000', '--include-name', 'Win-Box.exe,mpv.exe', ...resourceBudgetArgs(options.budgets), '--', process.execPath, ...workerArgs];
  const child = spawn(process.execPath, samplerArgs, { cwd: ROOT, windowsHide: true, stdio: 'inherit' });
  const [exitCode] = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', code => resolveExit([code]));
  });
  const cycles = JSON.parse(await readFile(join(options.outputDirectory, 'cycles.json'), 'utf8'));
  const resources = JSON.parse(await readFile(resourcesPath, 'utf8'));
  const summary = summarizeV05Run(cycles, resources);
  summary.commandExitCode = exitCode;
  summary.rootProcessCompletion = resources.completion;
  summary.outputDirectory = options.outputDirectory;
  await writeFile(join(options.outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ status: summary.status, outputDirectory: summary.outputDirectory, cyclesCompleted: summary.workload.cyclesCompleted, cycleDurationMs: summary.workload.cycleDurationMs, sampleCount: summary.sampler.sampleCount, processTree: summary.resources.processTree, byExecutable: summary.resources.byExecutable, budgetStatus: summary.sampler.budgetStatus, exitCode }, null, 2));
  if (exitCode !== 0 || summary.status !== 'PASS') process.exitCode = exitCode || 1;
}

async function main(args) {
  const options = parseRepeatedPlaybackArgs(args);
  if (options.worker) await runWorker(options);
  else await runMeasured(options);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; }
}
