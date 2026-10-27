const PREPARATION_RETRY_DELAY_MS = 20_000;
const MAX_PREPARATION_RETRIES = 12;

export interface HomeBrowseTimerPort {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface HomeBrowseRequestToken {
  generation: number;
  signal: AbortSignal;
}

interface ActiveBrowseRequest {
  token: HomeBrowseRequestToken;
  controller: AbortController;
}

export interface HomeBrowseRequestSession {
  activate(): void;
  beginHomeRequest(retry: boolean): HomeBrowseRequestToken;
  beginCategoryRequest(): HomeBrowseRequestToken;
  beginMetadataRequest(): HomeBrowseRequestToken;
  resetPreparationRetryBudget(): void;
  isListRequestCurrent(request: HomeBrowseRequestToken): boolean;
  isMetadataRequestCurrent(request: HomeBrowseRequestToken): boolean;
  invalidateBrowseRequests(): void;
  schedulePreparationRetry(options: { isCurrent(): boolean; retry(): void }): boolean;
  dispose(): void;
}

const browserTimer: HomeBrowseTimerPort = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Owns stale-request generations and delayed source-preparation retries for a browse session. */
export function createHomeBrowseRequestSession(timer: HomeBrowseTimerPort = browserTimer): HomeBrowseRequestSession {
  let listGeneration = 0;
  let metadataGeneration = 0;
  let preparationRetries = 0;
  let retryTimer: unknown = null;
  let retryGeneration = 0;
  let disposed = false;
  let activeListRequest: ActiveBrowseRequest | null = null;
  let activeMetadataRequest: ActiveBrowseRequest | null = null;

  function abortRequest(request: ActiveBrowseRequest | null, message: string): void {
    if (request && !request.token.signal.aborted) request.controller.abort(new Error(message));
  }

  function createRequest(generation: number): ActiveBrowseRequest {
    const controller = new AbortController();
    return { token: { generation, signal: controller.signal }, controller };
  }

  function cancelActiveListRequest(): void {
    abortRequest(activeListRequest, '首页浏览请求已被后续请求替代');
    activeListRequest = null;
  }

  function cancelActiveMetadataRequest(): void {
    abortRequest(activeMetadataRequest, '首页元数据请求已被后续状态替代');
    activeMetadataRequest = null;
  }

  function cancelPreparationRetry(): void {
    retryGeneration += 1;
    if (retryTimer === null) return;
    timer.cancel(retryTimer);
    retryTimer = null;
  }

  return {
    activate() {
      disposed = false;
    },
    beginHomeRequest(retry) {
      cancelPreparationRetry();
      cancelActiveListRequest();
      cancelActiveMetadataRequest();
      if (!retry) preparationRetries = 0;
      metadataGeneration += 1;
      const activeRequest = createRequest(++listGeneration);
      const request = activeRequest.token;
      activeListRequest = activeRequest;
      return request;
    },
    beginCategoryRequest() {
      cancelPreparationRetry();
      cancelActiveListRequest();
      const activeRequest = createRequest(++listGeneration);
      activeListRequest = activeRequest;
      return activeRequest.token;
    },
    beginMetadataRequest() {
      cancelActiveMetadataRequest();
      const activeRequest = createRequest(++metadataGeneration);
      activeMetadataRequest = activeRequest;
      return activeRequest.token;
    },
    resetPreparationRetryBudget() {
      preparationRetries = 0;
    },
    isListRequestCurrent(request) {
      return !disposed && request === activeListRequest?.token && request.generation === listGeneration && !request.signal.aborted;
    },
    isMetadataRequestCurrent(request) {
      return !disposed && request === activeMetadataRequest?.token && request.generation === metadataGeneration && !request.signal.aborted;
    },
    invalidateBrowseRequests() {
      cancelPreparationRetry();
      cancelActiveListRequest();
      cancelActiveMetadataRequest();
      listGeneration += 1;
      metadataGeneration += 1;
    },
    schedulePreparationRetry({ isCurrent, retry }) {
      if (disposed || preparationRetries >= MAX_PREPARATION_RETRIES || !isCurrent()) return false;
      cancelPreparationRetry();
      preparationRetries += 1;
      const generation = retryGeneration;
      retryTimer = timer.schedule(() => {
        if (disposed || generation !== retryGeneration) return;
        retryTimer = null;
        if (isCurrent()) retry();
      }, PREPARATION_RETRY_DELAY_MS);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPreparationRetry();
      cancelActiveListRequest();
      cancelActiveMetadataRequest();
      listGeneration += 1;
      metadataGeneration += 1;
    },
  };
}
