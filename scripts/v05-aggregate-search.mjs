import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const MEASURER = join(ROOT, 'scripts', 'measure-runtime-resources.mjs');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const SPEC = join(ROOT, 'tests', 'v05AggregateSearch.spec.ts');
const inside = (parent, target) => {
  const rel = relative(parent, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function positiveInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function positiveBudget(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100_000) {
    throw new Error(`${label} must be a positive number no greater than 100000.`);
  }
  return number;
}

const RESOURCE_BUDGET_FLAGS = [
  ['--budget-working-set-mb', 'workingSetMB'],
  ['--budget-private-bytes-mb', 'privateBytesMB'],
  ['--budget-cpu-p95-percent', 'cpuP95Percent'],
];
const DEFAULT_RESOURCE_BUDGETS = Object.freeze({ workingSetMB: 500, privateBytesMB: 700, cpuP95Percent: 180 });

function resourceBudgetArgs(budgets) {
  return RESOURCE_BUDGET_FLAGS.flatMap(([flag, key]) => Number.isFinite(budgets[key]) ? [flag, String(budgets[key])] : []);
}

export function parseV05SearchArgs(args) {
  const options = { cycles: 10, sources: 1000, outputDirectory: '', budgets: { ...DEFAULT_RESOURCE_BUDGETS } };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--cycles') options.cycles = positiveInteger(value, flag, { min: 10, max: 50 });
    else if (flag === '--sources') options.sources = positiveInteger(value, flag, { min: 1000, max: 1000 });
    else if (flag === '--output-dir') options.outputDirectory = resolve(ROOT, value);
    else if (RESOURCE_BUDGET_FLAGS.some(([budgetFlag]) => budgetFlag === flag)) {
      const key = RESOURCE_BUDGET_FLAGS.find(([budgetFlag]) => budgetFlag === flag)[1];
      options.budgets[key] = positiveBudget(value, flag);
    }
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  if (!options.outputDirectory) throw new Error('--output-dir is required.');
  if (!inside(TMP, options.outputDirectory) || dirname(options.outputDirectory) !== TMP || !/^v05-search-[A-Za-z0-9_-]+$/.test(basename(options.outputDirectory))) {
    throw new Error('--output-dir must be a new direct child of workspace .tmp named v05-search-* .');
  }
  return options;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function metricSet(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  const at = fraction => finite.length ? round1(finite[Math.max(0, Math.ceil(fraction * finite.length) - 1)]) : null;
  return {
    p50: at(0.5),
    p95: at(0.95),
    peak: finite.length ? round1(finite.at(-1)) : null,
  };
}

function summarizeProcessSamples(samples) {
  const priorCpuByPid = new Map();
  const groups = new Map();
  const treeWorkingSet = [];
  const treePrivateBytes = [];
  const treeCpuPercent = [];
  let processCountPeak = 0;

  for (const sample of samples) {
    const grouped = new Map();
    let treeCpuMs = 0;
    for (const row of sample.processes) {
      const group = grouped.get(row.name) ?? { workingSet: 0, privateBytes: 0, cpuMs: 0, count: 0 };
      group.workingSet += row.workingSetBytes;
      group.privateBytes += row.privateBytes;
      group.count += 1;
      const priorCpu = priorCpuByPid.get(row.pid);
      const cpuDelta = Number.isFinite(priorCpu) ? Math.max(0, row.cpuTimeMs - priorCpu) : 0;
      group.cpuMs += cpuDelta;
      treeCpuMs += cpuDelta;
      grouped.set(row.name, group);
      priorCpuByPid.set(row.pid, row.cpuTimeMs);
    }
    for (const pid of priorCpuByPid.keys()) {
      if (!sample.processes.some(row => row.pid === pid)) priorCpuByPid.delete(pid);
    }
    const durationMs = Number(sample.elapsedMs) || 0;
    treeWorkingSet.push(sample.workingSetMB);
    treePrivateBytes.push(sample.privateBytesMB);
    if (durationMs > 0) treeCpuPercent.push(treeCpuMs / durationMs * 100);
    processCountPeak = Math.max(processCountPeak, sample.processCount);
    for (const [name, group] of grouped) {
      const series = groups.get(name) ?? { workingSet: [], privateBytes: [], cpuPercent: [], processCount: [] };
      series.workingSet.push(group.workingSet / 1_048_576);
      series.privateBytes.push(group.privateBytes / 1_048_576);
      if (durationMs > 0) series.cpuPercent.push(group.cpuMs / durationMs * 100);
      series.processCount.push(group.count);
      groups.set(name, series);
    }
  }

  return {
    sampleCount: samples.length,
    processTree: {
      workingSetMiB: metricSet(treeWorkingSet),
      privateBytesMiB: metricSet(treePrivateBytes),
      cpuPercent: metricSet(treeCpuPercent),
      processCountPeak,
    },
    byExecutable: [...groups].map(([name, values]) => ({
      name,
      processCountPeak: Math.max(...values.processCount),
      workingSetMiB: metricSet(values.workingSet),
      privateBytesMiB: metricSet(values.privateBytes),
      cpuPercent: metricSet(values.cpuPercent),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function summarizeV05Search(workload, resourceReport, outputDirectory) {
  const cycles = workload.cycles ?? [];
  const durationValues = cycles.map(cycle => cycle.durationMs).filter(Number.isFinite);
  const throughputValues = cycles.map(cycle => cycle.throughputSourcesPerSecond).filter(Number.isFinite);
  const requestLatencyValues = cycles.flatMap(cycle => cycle.requestLatencyMs ?? []);
  const queueOffsetValues = cycles.flatMap(cycle => cycle.dispatchOffsetMs ?? []);
  const memory = cycles.flatMap(cycle => cycle.memorySamples ?? []);
  const cycleResultsValid = workload.status === 'PASS'
    && cycles.length === workload.requestedCycles
    && cycles.every(cycle => cycle.status === 'PASS' && cycle.requestsReceived === workload.sourcesPerCycle && cycle.reportItems === workload.sourcesPerCycle);
  const resilienceScenarios = workload.resilienceScenarios ?? [];
  const expectedScenarios = ['mixed-success-timeout', 'cancel-after-first-result', 'recovery-after-cancel'];
  const scenarioResultsValid = resilienceScenarios.length === expectedScenarios.length
    && expectedScenarios.every(name => resilienceScenarios.some(scenario => scenario.name === name
      && scenario.status === 'PASS'
      && scenario.sourceCount > 1000
      && Number.isFinite(scenario.firstResultMs)
      && scenario.peakConcurrentRequests > 1
      && scenario.activeRequestsAfterSettle === 0))
    && resilienceScenarios.some(scenario => scenario.name === 'mixed-success-timeout'
      && scenario.failedSources > 0
      && scenario.timedOutRequests === 1
      && scenario.explicitFixtureFailures > 0)
    && resilienceScenarios.some(scenario => scenario.name === 'cancel-after-first-result'
      && scenario.cancelledRequests > 0
      && scenario.receivedRequests < scenario.sourceCount)
    && resilienceScenarios.some(scenario => scenario.name === 'recovery-after-cancel'
      && scenario.receivedRequests === scenario.sourceCount
      && scenario.failedSources === 0);
  const resourceValid = resourceReport?.completion === 'completed'
    && (resourceReport?.sampler?.errors?.length ?? 1) === 0
    && (resourceReport?.summary?.sampleCount ?? 0) >= 2;
  const budgetStatus = resourceReport?.summary?.budgetStatus ?? 'NOT_CONFIGURED';
  const budgetValid = budgetStatus === 'PASS';

  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    status: cycleResultsValid && scenarioResultsValid && resourceValid && budgetValid ? 'PASS' : 'FAIL',
    scope: {
      implementation: 'AggregateSearchCoordinator + SearchSourceReadiness + SourceSearchHealth + SourceGateway + CmsSourceAdapter + CmsSource',
      sourcesPerCycle: workload.sourcesPerCycle,
      cyclesRequested: workload.requestedCycles,
      cyclesCompleted: cycles.filter(cycle => cycle.status === 'PASS').length,
      totalLocalHttpRequests: cycles.reduce((sum, cycle) => sum + cycle.requestsReceived, 0)
        + resilienceScenarios.reduce((sum, scenario) => sum + scenario.receivedRequests, 0),
      baselineLocalHttpRequests: cycles.reduce((sum, cycle) => sum + cycle.requestsReceived, 0),
      resilienceLocalHttpRequests: resilienceScenarios.reduce((sum, scenario) => sum + scenario.receivedRequests, 0),
      profileCount: workload.profileCount,
      concurrencyLimit: workload.concurrencyLimit,
      fixture: 'synthetic CMS JSON served by an ephemeral 127.0.0.1 loopback HTTP server; baseline uses deterministic 4-8 ms success responses; resilience scenarios add fixture-only HTTP 503, a declared 5-second source timeout, delayed in-flight requests canceled after first result, and a subsequent recovery search',
      externalSources: 'NOT_ACCESSED',
      userConfiguration: 'NOT_ACCESSED; all three profiles and all source entries are generated in-process',
      searchWorkload: 'synthetic only; this exercises production aggregate scheduling, cross-profile worker budgeting, gateway routing, CMS request parsing, and result aggregation',
    },
    performance: {
      cycleLatencyMs: metricSet(durationValues),
      requestLatencyMs: metricSet(requestLatencyValues),
      dispatchOffsetFromCycleStartMs: metricSet(queueOffsetValues),
      throughputSourcesPerSecond: metricSet(throughputValues),
      maxConcurrentLoopbackRequests: metricSet(cycles.map(cycle => cycle.maxConcurrentRequests)),
      cycleCpuPercent: metricSet(cycles.map(cycle => cycle.cpuPercent)),
      sampledProcessMemoryMiB: {
        rss: metricSet(memory.map(sample => sample.rssMiB)),
        heapUsed: metricSet(memory.map(sample => sample.heapUsedMiB)),
        external: metricSet(memory.map(sample => sample.externalMiB)),
        arrayBuffers: metricSet(memory.map(sample => sample.arrayBuffersMiB)),
      },
      resilienceScenarios: resilienceScenarios.map(scenario => ({
        name: scenario.name,
        status: scenario.status,
        sourceCount: scenario.sourceCount,
        receivedRequests: scenario.receivedRequests,
        hitSources: scenario.hitSources,
        failedSources: scenario.failedSources,
        firstResultMs: scenario.firstResultMs,
        totalDurationMs: scenario.totalDurationMs,
        peakConcurrentRequests: scenario.peakConcurrentRequests,
        cancelledRequests: scenario.cancelledRequests,
        timedOutRequests: scenario.timedOutRequests,
        explicitFixtureFailures: scenario.explicitFixtureFailures,
        activeRequestsAfterSettle: scenario.activeRequestsAfterSettle,
        ...(scenario.cancellationOutcome ? { cancellationOutcome: scenario.cancellationOutcome } : {}),
        ...(scenario.error ? { error: scenario.error } : {}),
      })),
    },
    sampler: {
      intervalMs: resourceReport?.intervalMs ?? null,
      sampleCount: resourceReport?.summary?.sampleCount ?? 0,
      durationMs: resourceReport?.summary?.durationMs ?? 0,
      budgetStatus: resourceReport?.summary?.budgetStatus ?? 'NOT_CONFIGURED',
      budgets: resourceReport?.summary?.budgets ?? { workingSetMB: null, privateBytesMB: null, cpuP95Percent: null },
      budgetChecks: resourceReport?.summary?.budgetChecks ?? {},
      errors: resourceReport?.sampler?.errors ?? [],
      processes: summarizeProcessSamples(resourceReport?.summary?.samples ?? []),
    },
    cycles: cycles.map(cycle => ({
      index: cycle.index,
      status: cycle.status,
      durationMs: cycle.durationMs ?? null,
      requestsReceived: cycle.requestsReceived,
      reportItems: cycle.reportItems,
      hitSources: cycle.hitSources,
      failedSources: cycle.failedSources,
      progressSourceEvents: cycle.progressSourceEvents,
      maxConcurrentRequests: cycle.maxConcurrentRequests,
      throughputSourcesPerSecond: cycle.throughputSourcesPerSecond,
      requestLatencyMs: metricSet(cycle.requestLatencyMs ?? []),
      dispatchOffsetFromCycleStartMs: metricSet(cycle.dispatchOffsetMs ?? []),
      cpuPercent: cycle.cpuPercent ?? null,
      memorySamples: cycle.memorySamples?.length ?? 0,
    })),
    limitations: [
      'This is an isolated synthetic CMS workload. It does not contact third-party sources, import user configuration, or measure the reliability/latency of real websites.',
      'Spider/JAR/Python runtimes, their readiness/download work, IPC, source-specific parsers, and multi-source content variability are not exercised; the production CMS path is exercised through the loopback HTTP client.',
      'The per-cycle process.memoryUsage values belong to the Vitest test worker and include test/runtime overhead. The Windows process tree groups by node.exe and cannot separate Vitest parent, test worker, and any Node roles by image name alone.',
      'Queue wait has no dedicated production instrumentation. Dispatch offsets measure when each source entered the injected search port relative to its cycle start; they include scheduling and earlier work, not a pure queue-wait duration.',
      budgetStatus === 'NOT_CONFIGURED'
        ? 'No performance budgets are configured. Results provide repeatable distributions and resource observations only; they do not claim a budget pass or prove absence of leaks.'
        : 'Configured resource budgets apply to the sampled synthetic benchmark process tree, including its Vitest driver; they are regression guardrails for this harness, not application-only limits.',
      'A 4-8 ms loopback fixture is useful for exercising fan-out and queue behavior, but it does not model remote DNS/TLS, real server throttling, response-size variance, or user-visible search quality.',
      'The resilience scenarios use loopback-generated delays and HTTP 503 responses; the timeout and abort outcomes confirm local cancellation propagation/cleanup only, not third-party source behavior or real user experience.',
      'The Windows sampler uses a 250 ms interval; very short spikes between samples may be missed, and the first CPU interval has no prior process sample.',
    ],
    outputDirectory,
  };
}

async function run(options) {
  assert.equal(process.platform, 'win32', 'V05 process-tree sampling requires Windows.');
  const realTmp = await realpath(TMP);
  const parent = await realpath(dirname(options.outputDirectory));
  assert.equal(parent, realTmp, 'V05 output must resolve directly inside workspace .tmp.');
  assert.equal(dirname(options.outputDirectory), TMP, 'V05 output must be a direct .tmp child.');
  await stat(VITEST);
  await stat(SPEC);
  await mkdir(options.outputDirectory, { recursive: false });

  const resourcesPath = join(options.outputDirectory, 'resources.json');
  const cyclePath = join(options.outputDirectory, 'cycles.json');
  const summaryPath = join(options.outputDirectory, 'summary.json');
  const vitestArgs = [VITEST, 'run', SPEC, '--reporter=verbose'];
  const samplerArgs = [
    MEASURER,
    '--phase', 'v05-search',
    '--output', resourcesPath,
    '--interval-ms', '250',
    '--env', 'V05_SEARCH_RUN=1',
    '--env', `V05_SEARCH_OUTPUT_DIR=${options.outputDirectory}`,
    '--env', `V05_SEARCH_CYCLES=${options.cycles}`,
    '--env', `V05_SEARCH_SOURCES=${options.sources}`,
    '--include-name', 'node.exe',
    ...resourceBudgetArgs(options.budgets),
    '--', process.execPath, ...vitestArgs,
  ];
  const child = spawn(process.execPath, samplerArgs, { cwd: ROOT, windowsHide: true, stdio: 'inherit' });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', code => resolveExit(code));
  });
  const workload = JSON.parse(await readFile(cyclePath, 'utf8'));
  const resourceReport = JSON.parse(await readFile(resourcesPath, 'utf8'));
  const summary = summarizeV05Search(workload, resourceReport, options.outputDirectory);
  summary.commandExitCode = exitCode;
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({
    status: summary.status,
    outputDirectory: summary.outputDirectory,
    cyclesCompleted: summary.scope.cyclesCompleted,
    totalLocalHttpRequests: summary.scope.totalLocalHttpRequests,
    cycleLatencyMs: summary.performance.cycleLatencyMs,
    requestLatencyMs: summary.performance.requestLatencyMs,
    throughputSourcesPerSecond: summary.performance.throughputSourcesPerSecond,
    sampledProcessMemoryMiB: summary.performance.sampledProcessMemoryMiB,
    processTree: summary.sampler.processes.processTree,
    byExecutable: summary.sampler.processes.byExecutable,
    budgetStatus: summary.sampler.budgetStatus,
    exitCode,
  }, null, 2));
  if (exitCode !== 0 || summary.status !== 'PASS') process.exitCode = exitCode || 1;
}

async function main(args) {
  await run(parseV05SearchArgs(args));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}
