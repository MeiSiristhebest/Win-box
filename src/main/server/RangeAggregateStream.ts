import { buildSlices, parseByteRange } from './mediaTransforms';

export const AGGREGATE_CHUNK = 512 * 1024;
export const AGGREGATE_CONCURRENCY = 8;
export const AGGREGATE_MIN_LEN = 1 * 1024 * 1024;

export interface RangeResponseSink {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: Buffer): boolean;
  end(): void;
  destroy(): unknown;
  on(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
  once(event: 'drain', listener: () => void): unknown;
}

export interface PartialRangeResponse {
  status: number;
  headers: Record<string, unknown>;
}

export interface RangeAggregateDiagnostic {
  reason: string;
  url: string;
  total?: number;
}

export interface RangeAggregatePorts {
  fetchRange(target: string, headers: Record<string, string>): Promise<Buffer>;
  diagnose(event: RangeAggregateDiagnostic): void;
  warn(message: string): void;
  error(message: string, cause: unknown): void;
}

/** Parse the total byte count from a single-range Content-Range response. */
export function partialRangeTotal(headers: Record<string, unknown>): number | null {
  const raw = headers['content-range'];
  if (raw === undefined || raw === null) return null;
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const match = /^bytes \d+-\d+\/(\d+)/.exec(value);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Bounded, ordered Range fan-out for media responses. Request transport, diagnostics,
 * and the HTTP response sink are supplied by adapters so the scheduling policy can
 * be exercised without coupling it to LocalProxyServer.
 */
export class RangeAggregateStream {
  constructor(private readonly ports: RangeAggregatePorts) {}

  async tryHandle(
    target: string,
    headers: Record<string, string>,
    rangeHeader: string,
    probe: PartialRangeResponse,
    response: RangeResponseSink,
    concurrency = AGGREGATE_CONCURRENCY,
  ): Promise<boolean> {
    const total = partialRangeTotal(probe.headers);
    if (total === null) {
      this.ports.diagnose({ reason: 'no-content-range', url: target });
      return false;
    }
    const parsed = parseByteRange(rangeHeader);
    if (!parsed) {
      this.ports.diagnose({ reason: `range-parse-fail:${rangeHeader}`, url: target });
      return false;
    }
    const start = parsed.start;
    const end = parsed.end === undefined ? total - 1 : Math.min(parsed.end, total - 1);
    const length = end - start + 1;
    if (length < AGGREGATE_MIN_LEN) {
      this.ports.diagnose({ reason: `range-too-small:${length}<${AGGREGATE_MIN_LEN}`, total, url: target });
      return false;
    }

    const contentType = (probe.headers['content-type'] as string | undefined) || 'application/octet-stream';
    response.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': String(length),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
    });

    const slices = buildSlices(start, end, AGGREGATE_CHUNK);
    const aborted = { flag: false };
    const onClientClose = (): void => { aborted.flag = true; };
    response.on('close', onClientClose);
    try {
      await this.aggregatePipelined(slices, target, headers, response, aborted, concurrency);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') this.ports.error('proxy /play 聚合流错误', error);
    } finally {
      response.removeListener('close', onClientClose);
    }
    return true;
  }

  private async aggregatePipelined(
    slices: Array<{ start: number; end: number }>,
    target: string,
    headers: Record<string, string>,
    response: RangeResponseSink,
    aborted: { flag: boolean },
    concurrency: number,
  ): Promise<void> {
    const ready = new Map<number, Buffer>();
    let nextWrite = 0;
    let dispatched = 0;
    let draining = false;
    let finished = false;

    const maybeFinish = (): void => {
      if (!finished && nextWrite === slices.length && !response.writableEnded) {
        finished = true;
        response.end();
      }
    };

    const dispatch = (): void => {
      while (!aborted.flag && dispatched < slices.length && dispatched - nextWrite < concurrency) {
        const index = dispatched++;
        void this.fetchSliceOne(slices[index], target, headers, response).then(
          (chunk) => {
            if (aborted.flag) return;
            ready.set(index, chunk);
            void drain();
          },
          (error) => {
            if (aborted.flag) return;
            aborted.flag = true;
            if (!(error instanceof Error) || error.name !== 'AbortError') {
              this.ports.warn(`proxy /play 切片回源失败: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (!response.writableEnded) response.destroy();
          },
        );
      }
    };

    const drain = async (): Promise<void> => {
      if (draining || aborted.flag) return;
      draining = true;
      try {
        while (ready.has(nextWrite)) {
          const chunk = ready.get(nextWrite)!;
          ready.delete(nextWrite);
          nextWrite++;
          if (!response.write(chunk)) {
            await new Promise<void>((resolve) => response.once('drain', resolve));
            if (aborted.flag) return;
          }
        }
        maybeFinish();
      } finally {
        draining = false;
        if (!aborted.flag && !finished) dispatch();
      }
    };

    dispatch();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (finished || aborted.flag) {
          clearInterval(timer);
          resolve();
        }
      }, 25);
    });
  }

  private async fetchSliceOne(
    slice: { start: number; end: number },
    target: string,
    headers: Record<string, string>,
    response: RangeResponseSink,
  ): Promise<Buffer> {
    const requestHeaders = { ...headers, Range: `bytes=${slice.start}-${slice.end}` };
    const expectedLength = slice.end - slice.start + 1;
    try {
      const chunk = await this.ports.fetchRange(target, requestHeaders);
      if (chunk.length !== expectedLength) {
        const retry = await this.ports.fetchRange(target, requestHeaders);
        if (retry.length === expectedLength) return retry;
        if (chunk.length >= expectedLength * 0.5) {
          this.ports.warn(`proxy /play 切片长度 ${chunk.length} != ${expectedLength}，截断容错`);
          return chunk.subarray(0, expectedLength);
        }
        throw new Error(`切片长度不符 ${chunk.length} != ${expectedLength} (${slice.start}-${slice.end})`);
      }
      return chunk;
    } catch (error) {
      if (response.destroyed || (error instanceof Error && error.name === 'AbortError')) {
        const aborted = new Error('CLIENT_CLOSE');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw error;
    }
  }
}
