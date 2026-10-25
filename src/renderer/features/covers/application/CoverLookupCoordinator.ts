import type { CoverClockPort, CoverLookupPort, CoverLookupSettings, CoverProvider } from './coverLookupPort';

export interface CoverLookupCoordinator {
  loadSettings(forceRefresh?: boolean): Promise<CoverLookupSettings>;
  searchPoster(name: string, year: string | undefined, provider: CoverProvider, settingsKey: string): Promise<string>;
  enqueue<T>(job: () => Promise<T>): Promise<T>;
}

const settingsLifetimeMs = 30_000;
const maximumPosterQueries = 500;
const lookupLanes = 4;

/** Coordinates shared lookup caching and bounded concurrency without depending on React or browser APIs. */
export function createCoverLookupCoordinator(
  port: CoverLookupPort,
  clock: CoverClockPort,
): CoverLookupCoordinator {
  const posterQueries = new Map<string, Promise<string>>();
  const lanes: Promise<unknown>[] = Array.from({ length: lookupLanes }, () => Promise.resolve());
  let nextLane = 0;
  let settingsRequest: Promise<CoverLookupSettings> | null = null;
  let settingsSnapshot: CoverLookupSettings | null = null;
  let settingsExpiresAt = 0;

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const slot = nextLane++ % lanes.length;
    const pending = lanes[slot].then(job);
    lanes[slot] = pending.catch(() => undefined);
    return pending;
  };

  const loadSettings = (forceRefresh = false): Promise<CoverLookupSettings> => {
    if (settingsRequest) return settingsRequest;
    if (!forceRefresh && settingsSnapshot && clock.now() < settingsExpiresAt) {
      return Promise.resolve(settingsSnapshot);
    }
    const request = port.loadSettings().then((snapshot) => {
      settingsSnapshot = snapshot;
      settingsExpiresAt = clock.now() + settingsLifetimeMs;
      return snapshot;
    });
    settingsRequest = request;
    const clear = (): void => {
      if (settingsRequest === request) settingsRequest = null;
    };
    void request.then(clear, clear);
    return request;
  };

  const searchPoster = (
    name: string,
    year: string | undefined,
    provider: CoverProvider,
    settingsKey: string,
  ): Promise<string> => {
    const queryKey = JSON.stringify([settingsKey, provider, name, year]);
    let request = posterQueries.get(queryKey);
    if (request) return request;

    request = port.searchPoster(name, year, provider).catch(() => '');
    if (posterQueries.size >= maximumPosterQueries) {
      posterQueries.delete(posterQueries.keys().next().value!);
    }
    posterQueries.set(queryKey, request);
    void request.then((poster) => {
      if (!poster && posterQueries.get(queryKey) === request) posterQueries.delete(queryKey);
    });
    return request;
  };

  return { loadSettings, searchPoster, enqueue };
}

const coordinators = new WeakMap<CoverLookupPort, WeakMap<CoverClockPort, CoverLookupCoordinator>>();

/** Reuses one coordinator per injected lookup adapter so sibling views share caches and request lanes. */
export function sharedCoverLookupCoordinator(port: CoverLookupPort, clock: CoverClockPort): CoverLookupCoordinator {
  let coordinatorsByClock = coordinators.get(port);
  if (!coordinatorsByClock) {
    coordinatorsByClock = new WeakMap();
    coordinators.set(port, coordinatorsByClock);
  }
  let coordinator = coordinatorsByClock.get(clock);
  if (!coordinator) {
    coordinator = createCoverLookupCoordinator(port, clock);
    coordinatorsByClock.set(clock, coordinator);
  }
  return coordinator;
}
