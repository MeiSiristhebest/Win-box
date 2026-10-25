import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpClient, HttpResponse, KVStore, Logger } from '../src/shared/types';
import type { SpiderHostInfrastructurePorts } from '../src/main/spider/SpiderHostInfrastructurePorts';
import type { SourceBean } from '../src/shared/types';
import type { SpiderSourceCapabilities, SpiderSourceProviderPort } from '../src/engine/vod/SpiderSourcePorts';

type TestObjectStore = {
  getObject<T>(key: string, fallback: T): T;
  setObject<T>(key: string, value: T): void;
  setObjectStrict<T>(key: string, value: T): void;
  flush(): void;
  flushStrict(): void;
};

const objectStores = new Map<string, Map<string, unknown>>();
const keyValueStores = new Map<string, Map<string, string>>();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function storeFor(registry: Map<string, Map<string, unknown>>, name: string): Map<string, unknown> {
  let store = registry.get(name);
  if (!store) {
    store = new Map();
    registry.set(name, store);
  }
  return store;
}

function objectStore(name: string): TestObjectStore {
  const values = storeFor(objectStores, name);
  const setObject = <T>(key: string, value: T): void => { values.set(key, clone(value)); };
  return {
    getObject: <T>(key: string, fallback: T): T => values.has(key) ? clone(values.get(key) as T) : clone(fallback),
    setObject,
    setObjectStrict: setObject,
    flush: () => undefined,
    flushStrict: () => undefined,
  };
}

function keyValueStore(name: string): KVStore {
  const values = storeFor(keyValueStores as Map<string, Map<string, unknown>>, name);
  return {
    get: (key) => String(values.get(key) ?? ''),
    set: (key, value) => values.set(key, value),
    delete: (key) => { values.delete(key); },
  };
}

const silentLogger: Logger = { i: () => undefined, w: () => undefined, e: () => undefined };

const unexpectedNetworkRequest: HttpClient = {
  async request(request): Promise<HttpResponse> {
    throw new Error(`Unexpected network request in SpiderHost test fixture: ${request.method ?? 'get'} ${request.url}`);
  },
};

function spiderJson(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? {}) ?? '{}';
}

export interface SpiderHostTestSourceBehavior {
  homeContent?: (source: SourceBean, filter: boolean) => unknown | Promise<unknown>;
  homeVideoContent?: (source: SourceBean) => unknown | Promise<unknown>;
  categoryContent?: (source: SourceBean, tid: string, page: string, filter: boolean, extend: Record<string, string>) => unknown | Promise<unknown>;
  detailContent?: (source: SourceBean, ids: string[]) => unknown | Promise<unknown>;
  searchContent?: (source: SourceBean, keyword: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal) => unknown | Promise<unknown>;
  playerContent?: (source: SourceBean, flag: string, id: string, vipFlags: string[]) => unknown | Promise<unknown>;
  proxyPort?: (source: SourceBean) => number | null;
  lastReason?: (source: SourceBean) => string | undefined;
}

/** Test source adapter that exercises application services without constructing runtime workers. */
export function createSpiderHostTestSourceProvider(behavior: SpiderHostTestSourceBehavior): SpiderSourceProviderPort {
  return {
    forSource(source): SpiderSourceCapabilities {
      return {
        ...(behavior.homeContent ? { homeContent: async (filter) => spiderJson(await behavior.homeContent!(source, filter)) } : {}),
        ...(behavior.homeVideoContent ? { homeVideoContent: async () => spiderJson(await behavior.homeVideoContent!(source)) } : {}),
        ...(behavior.categoryContent ? {
          categoryContent: async (tid, page, filter, extend) =>
            spiderJson(await behavior.categoryContent!(source, tid, page, filter, extend)),
        } : {}),
        ...(behavior.detailContent ? { detailContent: async (ids) => spiderJson(await behavior.detailContent!(source, ids)) } : {}),
        ...(behavior.searchContent ? {
          searchContent: async (keyword, quick, timeoutMs, signal) =>
            spiderJson(await behavior.searchContent!(source, keyword, quick, timeoutMs, signal)),
        } : {}),
        ...(behavior.playerContent ? {
          playerContent: async (flag, id, vipFlags) => spiderJson(await behavior.playerContent!(source, flag, id, vipFlags)),
        } : {}),
        ...(behavior.proxyPort ? { proxyPort: () => behavior.proxyPort!(source) } : {}),
        ...(behavior.lastReason ? { get lastReason() { return behavior.lastReason!(source); } } : {}),
      };
    },
  };
}

export interface SpiderHostTestInfrastructureOverrides {
  http?: HttpClient;
  logger?: Logger;
}

/**
 * Creates test-owned platform adapters. Network access is denied by default;
 * durable file stores used by drive assemblies still live under one disposable
 * per-test directory, while application state and runtime KV are in memory.
 */
export function createSpiderHostTestInfrastructure(
  overrides: SpiderHostTestInfrastructureOverrides = {},
): SpiderHostInfrastructurePorts {
  const globalState = globalThis as typeof globalThis & { __shostDir?: string };
  const userData = globalState.__shostDir || mkdtempSync(join(tmpdir(), 'winbox-spider-host-'));
  globalState.__shostDir = userData;

  // Existing suites remove this directory after each test. A removed root marks
  // a new fixture lifetime, so the corresponding in-memory repositories reset.
  if (!existsSync(userData)) {
    const prefix = `${userData}::`;
    for (const key of objectStores.keys()) if (key.startsWith(prefix)) objectStores.delete(key);
    for (const key of keyValueStores.keys()) if (key.startsWith(prefix)) keyValueStores.delete(key);
  }

  const cache = join(userData, 'cache');
  const resources = join(userData, 'resources');
  const spiderCache = join(userData, 'spider-cache');
  mkdirSync(cache, { recursive: true });
  mkdirSync(resources, { recursive: true });
  mkdirSync(spiderCache, { recursive: true });

  const storeKey = (name: string): string => `${userData}::${name}`;
  return {
    http: overrides.http ?? unexpectedNetworkRequest,
    runtimeStore: {
      ...keyValueStore(storeKey('runtime')),
    },
    userConfigPersistence: objectStore(storeKey('user-config')),
    learnedDriveBindingStore: objectStore(storeKey('drive-binding-learning')),
    logger: overrides.logger ?? silentLogger,
    directories: {
      userData,
      cache,
      resources,
      spiderCache,
      workerBundle: join(resources, 'js-worker.cjs'),
    },
    credentialCodec: {
      encode: (plain) => plain,
      decode: (stored) => stored,
    },
  };
}
