import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it } from 'vitest';
import type { HttpClient, HttpRequest, Logger, SourceBean } from '../src/shared/types';
import { CmsSource } from '../src/engine/vod/CmsSource';
import { CmsSourceAdapter } from '../src/engine/vod/CmsSourceAdapter';
import { SourceGateway } from '../src/engine/vod/SourceGateway';
import { SourceSearchHealth } from '../src/engine/vod/SourceSearchHealth';
import { SearchSourceReadiness } from '../src/engine/vod/SearchSourceReadiness';
import { sourceTimeoutMs } from '../src/engine/spider/sourceTimeout';
import { FairProfileWorkerBudget, raceTimeout } from '../src/engine/vod/searchRuntime';
import { AggregateSearchCoordinator, type AggregateSearchDependencies } from '../src/main/spider/AggregateSearchCoordinator';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const outputDirectory = resolve(process.env['V05_SEARCH_OUTPUT_DIR'] || '');
const requestedCycles = Number(process.env['V05_SEARCH_CYCLES'] || 0);
const sourcesPerCycle = Number(process.env['V05_SEARCH_SOURCES'] || 0);
const PROFILE_IDS = ['fixture-a', 'fixture-b', 'fixture-c'];
const CONCURRENCY_LIMIT = 48;
const MEMORY_SAMPLE_INTERVAL_MS = 50;
const workloadSuite = process.env['V05_SEARCH_RUN'] === '1' ? describe : describe.skip;

type RequestMetric = {
  profileId: string;
  sourceKey: string;
  dispatchOffsetMs: number;
  latencyMs?: number;
  status?: 'ok' | 'error';
};

type CycleEvidence = {
  index: number;
  term: string;
  status: 'RUNNING' | 'PASS' | 'FAIL';
  startedAt: string;
  startedAtEpochMs: number;
  durationMs?: number;
  requestsReceived: number;
  reportItems: number;
  hitSources: number;
  failedSources: number;
  progressSourceEvents: number;
  maxConcurrentRequests: number;
  throughputSourcesPerSecond: number;
  requestLatencyMs: number[];
  dispatchOffsetMs: number[];
  cpuPercent?: number;
  memorySamples?: Array<{ rssMiB: number; heapUsedMiB: number; externalMiB: number; arrayBuffersMiB: number }>;
  error?: string;
};

type ResilienceScenarioEvidence = {
  name: 'mixed-success-timeout' | 'cancel-after-first-result' | 'recovery-after-cancel';
  status: 'PASS' | 'FAIL';
  sourceCount: number;
  receivedRequests: number;
  hitSources: number | null;
  failedSources: number | null;
  firstResultMs: number | null;
  totalDurationMs: number;
  peakConcurrentRequests: number;
  cancelledRequests: number;
  timedOutRequests: number;
  explicitFixtureFailures: number;
  activeRequestsAfterSettle: number;
  cancellationOutcome?: string;
  error?: string;
};

const evidence = {
  schemaVersion: 1,
  status: 'RUNNING' as 'RUNNING' | 'PASS' | 'FAIL',
  workload: 'AggregateSearchCoordinator over 1,000 synthetic CMS sources per repeated cycle plus 1,001-source mixed-success, timeout, cancellation, and recovery scenarios, split across three in-memory synthetic profiles; SourceGateway/CMS adapter/parser requests go only to loopback.',
  requestedCycles,
  sourcesPerCycle,
  profileCount: PROFILE_IDS.length,
  concurrencyLimit: CONCURRENCY_LIMIT,
  cycles: [] as CycleEvidence[],
  resilienceScenarios: [] as ResilienceScenarioEvidence[],
  processMemorySamples: [] as Array<{ atEpochMs: number; cycleIndex: number | null; rssMiB: number; heapUsedMiB: number; externalMiB: number; arrayBuffersMiB: number }>,
};

let server: Server | undefined;
let activeCycleIndex: number | null = null;
let cycleRequestCounts = new Map<string, number>();
let cycleActiveCounts = new Map<string, number>();
let cycleConcurrencyPeaks = new Map<string, number>();
let cycleCancelledCounts = new Map<string, number>();
let cycleTimedOutCounts = new Map<string, number>();
let cycleFixtureFailureCounts = new Map<string, number>();
let scenarioModeByCycle = new Map<string, 'baseline' | 'mixed' | 'cancel' | 'recovery'>();
let memoryTimer: ReturnType<typeof setInterval> | undefined;

function toMiB(bytes: number): number {
  return Math.round(bytes / 1_048_576 * 10) / 10;
}

function captureMemory(cycleIndex: number | null): { rssMiB: number; heapUsedMiB: number; externalMiB: number; arrayBuffersMiB: number } {
  const usage = process.memoryUsage();
  const row = {
    rssMiB: toMiB(usage.rss),
    heapUsedMiB: toMiB(usage.heapUsed),
    externalMiB: toMiB(usage.external),
    arrayBuffersMiB: toMiB(usage.arrayBuffers),
  };
  evidence.processMemorySamples.push({ atEpochMs: Date.now(), cycleIndex, ...row });
  return row;
}

async function writeEvidence(): Promise<void> {
  await writeFile(join(outputDirectory, 'cycles.json'), JSON.stringify(evidence, null, 2));
}

function sourceBean(profileId: string, sourceIndex: number, origin: string, scenario: 'baseline' | 'mixed' | 'cancel' | 'recovery' = 'baseline'): SourceBean {
  const key = `v05-${profileId}-${String(sourceIndex).padStart(4, '0')}`;
  const api = `${origin}/synthetic/${profileId}/${sourceIndex}`;
  assert.equal(new URL(api).hostname, '127.0.0.1');
  return {
    key,
    name: `Synthetic ${profileId} ${sourceIndex}`,
    type: 1,
    api,
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    filterable: 1,
    playUrl: '',
    ext: '',
    jar: '',
    playerType: -1,
    categories: null,
    timeout: scenario === 'mixed' && profileId === 'fixture-a' && sourceIndex === 333 ? 5 : 10,
    click: '',
    style: '',
  };
}

function parseCycleFromTerm(term: string): string {
  const match = term.match(/^v05-synthetic-cycle-(\d+)$/);
  assert.ok(match, `Unexpected synthetic search term: ${term}`);
  return match[1] as string;
}

async function startLoopbackFixture(): Promise<{ origin: string; close: () => Promise<void> }> {
  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const route = url.pathname.match(/^\/synthetic\/([^/]+)\/(\d+)$/);
    if (request.method !== 'GET' || !route || url.searchParams.get('ac') !== 'detail') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('fixture route not found');
      return;
    }
    const profileId = route[1] as string;
    const sourceIndex = Number(route[2]);
    const term = url.searchParams.get('wd') || '';
    let cycleId: string;
    try { cycleId = parseCycleFromTerm(term); }
    catch {
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end('invalid synthetic term');
      return;
    }
    const requestCount = (cycleRequestCounts.get(cycleId) || 0) + 1;
    cycleRequestCounts.set(cycleId, requestCount);
    const active = (cycleActiveCounts.get(cycleId) || 0) + 1;
    cycleActiveCounts.set(cycleId, active);
    cycleConcurrencyPeaks.set(cycleId, Math.max(cycleConcurrencyPeaks.get(cycleId) || 0, active));
    const scenario = scenarioModeByCycle.get(cycleId) || 'baseline';
    const isFixtureFailure = scenario === 'mixed' && sourceIndex % 97 === 0;
    const isTimeoutProbe = scenario === 'mixed' && profileId === 'fixture-a' && sourceIndex === 333;
    const delayMs = scenario === 'cancel'
      ? (sourceIndex === 0 ? 2 : 2000)
      : isTimeoutProbe ? 7000 : 4 + (sourceIndex % 5);
    const body = JSON.stringify({
      page: 1,
      pagecount: 1,
      limit: 1,
      total: 1,
      list: [{
        vod_id: `${profileId}-${sourceIndex}`,
        vod_name: `V05 Synthetic ${profileId} ${sourceIndex}`,
        type_name: 'local-fixture',
      }],
    });
    let settled = false;
    const finishActiveRequest = (): void => {
      if (settled) return;
      settled = true;
      cycleActiveCounts.set(cycleId, Math.max(0, (cycleActiveCounts.get(cycleId) || 1) - 1));
    };
    const timer = setTimeout(() => {
      finishActiveRequest();
      if (response.destroyed) return;
      if (isFixtureFailure) {
        cycleFixtureFailureCounts.set(cycleId, (cycleFixtureFailureCounts.get(cycleId) || 0) + 1);
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('synthetic fixture failure');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(body);
    }, delayMs);
    response.once('close', () => {
      if (response.writableEnded) return;
      clearTimeout(timer);
      if (isTimeoutProbe) cycleTimedOutCounts.set(cycleId, (cycleTimedOutCounts.get(cycleId) || 0) + 1);
      else cycleCancelledCounts.set(cycleId, (cycleCancelledCounts.get(cycleId) || 0) + 1);
      finishActiveRequest();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      if (!server) return;
      server.closeIdleConnections();
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => {
        server!.close((error) => error ? rejectClose(error) : resolveClose());
      });
      server = undefined;
    },
  };
}

function createCoordinator(origin: string, metrics: RequestMetric[], cycleStartedAt: number, sourceCount = sourcesPerCycle, scenario: 'baseline' | 'mixed' | 'cancel' | 'recovery' = 'baseline'): AggregateSearchCoordinator {
  const profilePools = new Map<string, SourceBean[]>();
  const profileBySourceKey = new Map<string, string>();
  for (const profileId of PROFILE_IDS) {
    const pool = Array.from({ length: Math.floor(sourceCount / PROFILE_IDS.length) + (PROFILE_IDS.indexOf(profileId) < sourceCount % PROFILE_IDS.length ? 1 : 0) }, (_value, index) => {
      const source = sourceBean(profileId, index, origin, scenario);
      profileBySourceKey.set(source.key, profileId);
      return source;
    });
    profilePools.set(profileId, pool);
  }
  const profiles = PROFILE_IDS.map((id, profileOrder) => ({ id, name: `Synthetic Profile ${profileOrder + 1}` }));
  const logger: Pick<Logger, 'i' | 'w'> = { i: () => undefined, w: () => undefined };
  const loopbackHttp: Pick<HttpClient, 'request'> = {
    request: async (request: HttpRequest) => {
      const parsed = new URL(request.url);
      assert.equal(parsed.hostname, '127.0.0.1', 'Synthetic CMS client attempted to leave loopback.');
      assert.equal(parsed.port, new URL(origin).port, 'Synthetic CMS client attempted to access an unexpected port.');
      const timeoutMs = Math.max(1, Math.floor(request.totalTimeoutMs || request.timeoutMs || 10000));
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(request.url, { method: 'GET', signal });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        content: await response.text(),
        finalUrl: response.url,
      };
    },
  };
  const cmsAdapter = new CmsSourceAdapter(new CmsSource({ http: loopbackHttp, logger }));
  const gateway = new SourceGateway({ catalog: [cmsAdapter], playback: [cmsAdapter], proxy: [] }, logger);
  const readiness = new SearchSourceReadiness({ inspect: () => null }, logger);
  const health = new SourceSearchHealth();
  const dependencies: AggregateSearchDependencies = {
    profiles: {
      list: () => profiles,
      executionContext: (profileId = PROFILE_IDS[0]!) => ({ profileId, config: null }),
      revision: () => 1,
      activeProfileId: () => PROFILE_IDS[0]!,
      activeSourceKey: () => '',
    },
    sources: {
      searchable: (profileId = PROFILE_IDS[0]!) => profilePools.get(profileId) || [],
      search: async (source, term, timeoutMs, signal) => {
        const requestMetric: RequestMetric = {
          profileId: profileBySourceKey.get(source.key) || 'unknown',
          sourceKey: source.key,
          dispatchOffsetMs: performance.now() - cycleStartedAt,
        };
        metrics.push(requestMetric);
        try {
          const items = await gateway.search(source, term, false, timeoutMs, signal);
          requestMetric.latencyMs = performance.now() - cycleStartedAt - requestMetric.dispatchOffsetMs;
          requestMetric.status = 'ok';
          return items;
        } catch (error) {
          requestMetric.latencyMs = performance.now() - cycleStartedAt - requestMetric.dispatchOffsetMs;
          requestMetric.status = 'error';
          throw error;
        }
      },
    },
    readiness,
    createWorkerBudget: (limit, profileIds, initiallyActive) => new FairProfileWorkerBudget(limit, profileIds, initiallyActive),
    health: {
      scheduleOrder: (sources) => health.scheduleOrder(sources),
      sourceBudget: (source, maximumMs) => health.budget(source, sourceTimeoutMs(source), maximumMs),
      succeeded: (scope, elapsedMs, empty) => health.succeeded(scope, elapsedMs, empty),
      failed: (scope) => health.failed(scope),
    },
    timing: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
      withTimeout: raceTimeout,
    },
    logger,
  };
  return new AggregateSearchCoordinator(dependencies);
}

function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return Math.round(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]! * 10) / 10;
}

async function waitForNoActiveRequests(cycleId: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while ((cycleActiveCounts.get(cycleId) || 0) > 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return cycleActiveCounts.get(cycleId) || 0;
}

workloadSuite('V05 aggregate-search synthetic workload', () => {
  afterAll(async () => {
    if (memoryTimer) clearInterval(memoryTimer);
    if (server) {
      server.closeIdleConnections();
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
      server = undefined;
    }
  });

  it('runs 1,000 local CMS sources through production scheduling for at least ten cycles', async () => {
    assert.equal(process.platform, 'win32', 'The Windows process sampler is expected to wrap this workload.');
    assert.ok(Number.isInteger(requestedCycles) && requestedCycles >= 10 && requestedCycles <= 50);
    assert.equal(sourcesPerCycle, 1000, 'This harness is defined for exactly 1,000 generated sources.');
    assert.ok(outputDirectory.startsWith(TMP + '\\'), 'Evidence must be written under workspace .tmp/v05-search-* only.');
    assert.match(basename(outputDirectory), /^v05-search-[A-Za-z0-9_-]+$/);
    assert.equal(dirname(outputDirectory), TMP);
    assert.equal(await realpath(dirname(outputDirectory)), await realpath(TMP));

    const fixture = await startLoopbackFixture();
    assert.equal(new URL(fixture.origin).hostname, '127.0.0.1');
    let currentCycle: CycleEvidence | undefined;
    let currentCycleStartedAt = 0;
    let requestMetrics: RequestMetric[] = [];
    let progressSourceEvents = 0;
    evidence.processMemorySamples = [];
    captureMemory(null);
    memoryTimer = setInterval(() => captureMemory(activeCycleIndex), MEMORY_SAMPLE_INTERVAL_MS);
    await writeEvidence();

    try {
      for (let cycleIndex = 1; cycleIndex <= requestedCycles; cycleIndex += 1) {
        const cycleId = String(cycleIndex).padStart(2, '0');
        const term = `v05-synthetic-cycle-${cycleId}`;
        currentCycleStartedAt = performance.now();
        activeCycleIndex = cycleIndex;
        requestMetrics = [];
        progressSourceEvents = 0;
        cycleRequestCounts.set(cycleId, 0);
        cycleActiveCounts.set(cycleId, 0);
        cycleConcurrencyPeaks.set(cycleId, 0);
        const cycle: CycleEvidence = {
          index: cycleIndex,
          term,
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
          startedAtEpochMs: Date.now(),
          requestsReceived: 0,
          reportItems: 0,
          hitSources: 0,
          failedSources: 0,
          progressSourceEvents: 0,
          maxConcurrentRequests: 0,
          throughputSourcesPerSecond: 0,
          requestLatencyMs: [],
          dispatchOffsetMs: [],
          memorySamples: [],
        };
        evidence.cycles.push(cycle);
        currentCycle = cycle;
        await writeEvidence();
        const coordinator = createCoordinator(fixture.origin, requestMetrics, currentCycleStartedAt);
        const cpuStart = process.cpuUsage();
        captureMemory(cycleIndex);
        const startedAt = performance.now();
        const report = await coordinator.run(term, { refresh: true, profileIds: [...PROFILE_IDS] }, (event) => {
          if (event.source) progressSourceEvents += 1;
        });
        const durationMs = performance.now() - startedAt;
        const cpu = process.cpuUsage(cpuStart);
        captureMemory(cycleIndex);
        const cycleMemory = evidence.processMemorySamples.filter(sample => sample.cycleIndex === cycleIndex);
        const requestLatencyMs = requestMetrics.map(metric => metric.latencyMs).filter((value): value is number => Number.isFinite(value));
        const dispatchOffsetMs = requestMetrics.map(metric => metric.dispatchOffsetMs);
        const received = cycleRequestCounts.get(cycleId) || 0;
        const maxConcurrentRequests = cycleConcurrencyPeaks.get(cycleId) || 0;
        cycle.durationMs = Math.round(durationMs * 10) / 10;
        cycle.requestsReceived = received;
        cycle.reportItems = report.items.length;
        cycle.hitSources = report.hitSources;
        cycle.failedSources = report.failedSources;
        cycle.progressSourceEvents = progressSourceEvents;
        cycle.maxConcurrentRequests = maxConcurrentRequests;
        cycle.throughputSourcesPerSecond = Math.round(received / (durationMs / 1000) * 10) / 10;
        cycle.requestLatencyMs = requestLatencyMs;
        cycle.dispatchOffsetMs = dispatchOffsetMs;
        cycle.cpuPercent = durationMs > 0 ? Math.round(((cpu.user + cpu.system) / 1000) / durationMs * 1000) / 10 : 0;
        cycle.memorySamples = cycleMemory.map(({ rssMiB, heapUsedMiB, externalMiB, arrayBuffersMiB }) => ({ rssMiB, heapUsedMiB, externalMiB, arrayBuffersMiB }));
        cycle.status = 'PASS';
        activeCycleIndex = null;
        await writeEvidence();

        assert.equal(received, sourcesPerCycle, `Cycle ${cycleIndex} did not send exactly one request per synthetic source.`);
        assert.equal(report.perSource.length, sourcesPerCycle, `Cycle ${cycleIndex} did not report every synthetic source.`);
        assert.equal(report.items.length, sourcesPerCycle, `Cycle ${cycleIndex} did not parse one synthetic item per source.`);
        assert.equal(report.hitSources, sourcesPerCycle);
        assert.equal(report.failedSources, 0);
        assert.equal(progressSourceEvents, sourcesPerCycle);
        assert.ok(maxConcurrentRequests > 1, 'The local fixture observed no concurrent requests.');
        assert.ok(maxConcurrentRequests <= CONCURRENCY_LIMIT, `Observed ${maxConcurrentRequests} active requests above the shared ${CONCURRENCY_LIMIT}-worker budget.`);
        assert.ok(requestLatencyMs.length === sourcesPerCycle);
        assert.ok(dispatchOffsetMs.length === sourcesPerCycle);
        assert.ok(cycleMemory.length > 0);
        console.log(`V05 search cycle ${cycleIndex}/${requestedCycles} PASS (${cycle.durationMs} ms; ${cycle.throughputSourcesPerSecond} sources/s; ${received} loopback requests; peak in-flight ${maxConcurrentRequests})`);
      }
      evidence.status = 'PASS';
    } catch (error) {
      if (currentCycle) {
        currentCycle.status = 'FAIL';
        currentCycle.error = String(error instanceof Error ? error.stack || error.message : error);
      }
      evidence.status = 'FAIL';
      await writeEvidence();
      throw error;
    } finally {
      activeCycleIndex = null;
      if (memoryTimer) clearInterval(memoryTimer);
      memoryTimer = undefined;
      captureMemory(null);
      await fixture.close();
      await writeEvidence();
    }

    const allDurations = evidence.cycles.map(cycle => cycle.durationMs || 0);
    const allLatencies = evidence.cycles.flatMap(cycle => cycle.requestLatencyMs);
    const allDispatchOffsets = evidence.cycles.flatMap(cycle => cycle.dispatchOffsetMs);
    const runStats = {
      cycleLatencyMs: { p50: percentile(allDurations, 0.5), p95: percentile(allDurations, 0.95), peak: Math.max(...allDurations) },
      requestLatencyMs: { p50: percentile(allLatencies, 0.5), p95: percentile(allLatencies, 0.95), peak: Math.max(...allLatencies) },
      dispatchOffsetFromCycleStartMs: { p50: percentile(allDispatchOffsets, 0.5), p95: percentile(allDispatchOffsets, 0.95), peak: Math.max(...allDispatchOffsets) },
    };
    console.log(`V05 search summary: ${JSON.stringify(runStats)}`);
  }, 120_000);

  it('measures first result, partial success, source timeout, cancellation cleanup, and recovery with 1,001 synthetic sources', async () => {
    assert.equal(process.platform, 'win32', 'The Windows process sampler is expected to wrap this workload.');
    assert.ok(Number.isInteger(sourcesPerCycle) && sourcesPerCycle >= 1000);
    assert.ok(outputDirectory.startsWith(TMP + '\\'), 'Evidence must be written under workspace .tmp/v05-search-* only.');

    const fixture = await startLoopbackFixture();
    const sourceCount = sourcesPerCycle + 1;
    const evidenceByName = new Map<ResilienceScenarioEvidence['name'], ResilienceScenarioEvidence>();
    let activeScenarioName: ResilienceScenarioEvidence['name'] = 'mixed-success-timeout';
    const resetCycle = (cycleId: string, mode: 'mixed' | 'cancel' | 'recovery'): void => {
      scenarioModeByCycle.set(cycleId, mode);
      cycleRequestCounts.set(cycleId, 0);
      cycleActiveCounts.set(cycleId, 0);
      cycleConcurrencyPeaks.set(cycleId, 0);
      cycleCancelledCounts.set(cycleId, 0);
      cycleTimedOutCounts.set(cycleId, 0);
      cycleFixtureFailureCounts.set(cycleId, 0);
    };
    const firstResultTime = (event: { source?: { status?: string; items?: unknown[] } }, startedAt: number, current: number | null): number | null =>
      current === null && event.source?.status === 'ok' && (event.source.items?.length || 0) > 0
        ? Math.round((performance.now() - startedAt) * 10) / 10
        : current;

    try {
      resetCycle('11', 'mixed');
      const mixedMetrics: RequestMetric[] = [];
      const mixedCoordinator = createCoordinator(fixture.origin, mixedMetrics, performance.now(), sourceCount, 'mixed');
      const mixedStartedAt = performance.now();
      let mixedFirstResultMs: number | null = null;
      const mixedReport = await mixedCoordinator.run('v05-synthetic-cycle-11', { refresh: true, profileIds: [...PROFILE_IDS] }, (event) => {
        mixedFirstResultMs = firstResultTime(event, mixedStartedAt, mixedFirstResultMs);
      });
      const mixedDurationMs = Math.round((performance.now() - mixedStartedAt) * 10) / 10;
      const mixedReceived = cycleRequestCounts.get('11') || 0;
      const mixedPeak = cycleConcurrencyPeaks.get('11') || 0;
      const mixedActiveAfter = await waitForNoActiveRequests('11', 3000);
      const mixedFailures = cycleFixtureFailureCounts.get('11') || 0;
      const mixedTimeouts = cycleTimedOutCounts.get('11') || 0;
      const expectedFixtureFailures = PROFILE_IDS.reduce((total, profileId, profileIndex) => {
        const count = Math.floor(sourceCount / PROFILE_IDS.length) + (profileIndex < sourceCount % PROFILE_IDS.length ? 1 : 0);
        return total + Array.from({ length: count }, (_value, index) => index).filter(index => index % 97 === 0).length;
      }, 0);
      const mixedEvidence: ResilienceScenarioEvidence = {
        name: 'mixed-success-timeout',
        status: 'PASS',
        sourceCount,
        receivedRequests: mixedReceived,
        hitSources: mixedReport.hitSources,
        failedSources: mixedReport.failedSources,
        firstResultMs: mixedFirstResultMs,
        totalDurationMs: mixedDurationMs,
        peakConcurrentRequests: mixedPeak,
        cancelledRequests: cycleCancelledCounts.get('11') || 0,
        timedOutRequests: mixedTimeouts,
        explicitFixtureFailures: mixedFailures,
        activeRequestsAfterSettle: mixedActiveAfter,
      };
      assert.equal(mixedReceived, sourceCount);
      assert.equal(mixedReport.perSource.length, sourceCount);
      assert.equal(mixedFailures, expectedFixtureFailures);
      assert.equal(mixedTimeouts, 1, 'The designated 5-second source must be canceled by its declared timeout.');
      assert.equal(mixedReport.failedSources, mixedFailures + mixedTimeouts);
      assert.equal(mixedReport.hitSources, sourceCount - mixedFailures - mixedTimeouts);
      assert.ok(mixedFirstResultMs !== null, 'At least one source must yield a first result.');
      assert.ok(mixedPeak > 1 && mixedPeak <= CONCURRENCY_LIMIT);
      assert.equal(mixedActiveAfter, 0, 'All mixed-result loopback requests must settle.');
      evidenceByName.set(mixedEvidence.name, mixedEvidence);
      evidence.resilienceScenarios.push(mixedEvidence);
      await writeEvidence();

      resetCycle('12', 'cancel');
      activeScenarioName = 'cancel-after-first-result';
      const cancelMetrics: RequestMetric[] = [];
      const cancelStartedAt = performance.now();
      const cancelCoordinator = createCoordinator(fixture.origin, cancelMetrics, cancelStartedAt, sourceCount, 'cancel');
      const cancelController = new AbortController();
      let cancelFirstResultMs: number | null = null;
      let cancelObserved = false;
      let cancelHitSources = 0;
      let cancelError = '';
      try {
        await cancelCoordinator.run('v05-synthetic-cycle-12', { refresh: true, profileIds: [...PROFILE_IDS] }, (event) => {
          cancelFirstResultMs = firstResultTime(event, cancelStartedAt, cancelFirstResultMs);
          if (event.source?.status === 'ok') cancelHitSources += 1;
          if (!cancelObserved && cancelFirstResultMs !== null) {
            cancelObserved = true;
            cancelController.abort(new Error('synthetic cancellation after first result'));
          }
        }, cancelController.signal);
      } catch (error) {
        cancelError = error instanceof Error ? error.name + ': ' + error.message : String(error);
      }
      const cancelDurationMs = Math.round((performance.now() - cancelStartedAt) * 10) / 10;
      const cancelReceived = cycleRequestCounts.get('12') || 0;
      const cancelPeak = cycleConcurrencyPeaks.get('12') || 0;
      const cancelActiveAfter = await waitForNoActiveRequests('12', 3000);
      const cancellationEvidence: ResilienceScenarioEvidence = {
        name: 'cancel-after-first-result',
        status: 'PASS',
        sourceCount,
        receivedRequests: cancelReceived,
        hitSources: cancelHitSources,
        failedSources: null,
        firstResultMs: cancelFirstResultMs,
        totalDurationMs: cancelDurationMs,
        peakConcurrentRequests: cancelPeak,
        cancelledRequests: cycleCancelledCounts.get('12') || 0,
        timedOutRequests: cycleTimedOutCounts.get('12') || 0,
        explicitFixtureFailures: cycleFixtureFailureCounts.get('12') || 0,
        activeRequestsAfterSettle: cancelActiveAfter,
        cancellationOutcome: cancelError,
      };
      assert.ok(cancelObserved, 'Caller cancellation must be triggered by the first successful result.');
      assert.match(cancelError, /AbortError|cancel/i, 'Canceled aggregate search must reject as canceled.');
      assert.ok(cancelReceived < sourceCount, 'Cancellation should stop dispatch before every source is requested.');
      assert.ok(cancelPeak > 1 && cancelPeak <= CONCURRENCY_LIMIT);
      assert.ok(cancellationEvidence.cancelledRequests > 0, 'The fixture must observe in-flight HTTP cancellations.');
      assert.equal(cancelActiveAfter, 0, 'Active HTTP fixture requests must be reclaimed after cancellation.');
      evidenceByName.set(cancellationEvidence.name, cancellationEvidence);
      evidence.resilienceScenarios.push(cancellationEvidence);
      await writeEvidence();

      resetCycle('13', 'recovery');
      activeScenarioName = 'recovery-after-cancel';
      const recoveryStartedAt = performance.now();
      let recoveryFirstResultMs: number | null = null;
      const recoveryReport = await cancelCoordinator.run('v05-synthetic-cycle-13', { refresh: true, profileIds: [...PROFILE_IDS] }, (event) => {
        recoveryFirstResultMs = firstResultTime(event, recoveryStartedAt, recoveryFirstResultMs);
      });
      const recoveryDurationMs = Math.round((performance.now() - recoveryStartedAt) * 10) / 10;
      const recoveryEvidence: ResilienceScenarioEvidence = {
        name: 'recovery-after-cancel',
        status: 'PASS',
        sourceCount,
        receivedRequests: cycleRequestCounts.get('13') || 0,
        hitSources: recoveryReport.hitSources,
        failedSources: recoveryReport.failedSources,
        firstResultMs: recoveryFirstResultMs,
        totalDurationMs: recoveryDurationMs,
        peakConcurrentRequests: cycleConcurrencyPeaks.get('13') || 0,
        cancelledRequests: cycleCancelledCounts.get('13') || 0,
        timedOutRequests: cycleTimedOutCounts.get('13') || 0,
        explicitFixtureFailures: cycleFixtureFailureCounts.get('13') || 0,
        activeRequestsAfterSettle: await waitForNoActiveRequests('13', 3000),
      };
      assert.equal(recoveryEvidence.receivedRequests, sourceCount);
      assert.equal(recoveryReport.hitSources, sourceCount);
      assert.equal(recoveryReport.failedSources, 0);
      assert.ok(recoveryEvidence.firstResultMs !== null);
      assert.ok(recoveryEvidence.peakConcurrentRequests > 1 && recoveryEvidence.peakConcurrentRequests <= CONCURRENCY_LIMIT);
      assert.equal(recoveryEvidence.activeRequestsAfterSettle, 0);
      evidenceByName.set(recoveryEvidence.name, recoveryEvidence);
      evidence.resilienceScenarios.push(recoveryEvidence);
      await writeEvidence();
    } catch (error) {
      const failedScenario = {
        name: activeScenarioName,
        status: 'FAIL',
        sourceCount,
        receivedRequests: 0,
        hitSources: 0,
        failedSources: 0,
        firstResultMs: null,
        totalDurationMs: 0,
        peakConcurrentRequests: 0,
        cancelledRequests: 0,
        timedOutRequests: 0,
        explicitFixtureFailures: 0,
        activeRequestsAfterSettle: 0,
        error: String(error instanceof Error ? error.stack || error.message : error),
      } satisfies ResilienceScenarioEvidence;
      const priorScenario = evidence.resilienceScenarios.find(scenario => scenario.name === failedScenario.name);
      if (priorScenario) {
        priorScenario.status = 'FAIL';
        priorScenario.error = failedScenario.error;
      } else {
        evidence.resilienceScenarios.push(failedScenario);
      }
      evidence.status = 'FAIL';
      await writeEvidence();
      throw error;
    } finally {
      await fixture.close();
    }

    assert.equal(evidenceByName.size, 3);
    console.log(`V05 resilience summary: ${JSON.stringify(evidence.resilienceScenarios)}`);
  }, 120_000);
});
