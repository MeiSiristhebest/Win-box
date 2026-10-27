import { ConversionInFlightError } from './JarConversionRegistry';
import { formatDuration } from './formatDuration';

export interface JarConversionLockSnapshot {
  pid: number;
  startedAt: number;
  heapMb: number;
}

export interface JarConversionWorkflowRequest {
  jarUrl: string;
  key: string;
  target: string;
  jarBytes: Uint8Array;
  usedLabel?: string;
}

export type JarConversionWorkflowEvent =
  | { type: 'download-completed'; key: string; byteLength: number; elapsedMs: number }
  | { type: 'download-retry-succeeded'; jarUrl: string; usedLabel: string }
  | { type: 'content-reused'; jarUrl: string; byteLength: number; from?: string; target: string }
  | { type: 'detached-part-adopted'; target: string }
  | { type: 'attached-to-detached-conversion'; pid: number; elapsedMs: number };

export interface JarConversionWorkflowPorts {
  now(): number;
  onEvent(event: JarConversionWorkflowEvent): void;
  progress: {
    startedAt(jarUrl: string): number | null;
    setConvertStage(jarUrl: string): void;
    attachTo(jarUrl: string, startedAt: number): void;
  };
  cache: {
    ensureDirectory(): void;
    rawJarPath(key: string): string;
    writeRawJar(path: string, bytes: Uint8Array): void;
    contentKey(bytes: Uint8Array): string;
    reuseByContent(contentKey: string, key: string): { reused: boolean; from?: string };
    complete(jarUrl: string, target: string, contentKey: string): void;
  };
  artifacts: {
    adoptPart(key: string, rawJar: string, target: string, strict: boolean): Promise<boolean>;
  };
  detached: {
    readLock(key: string): JarConversionLockSnapshot | null;
    isAlive(lock: JarConversionLockSnapshot | null): lock is JarConversionLockSnapshot;
    clearLock(key: string): void;
    waitForAttached(
      key: string,
      lock: JarConversionLockSnapshot,
      adoptPart: () => Promise<boolean>,
    ): Promise<boolean>;
  };
  converter: {
    convert(input: { rawJar: string; key: string; jarBytes: Uint8Array }): Promise<void>;
  };
}

/** Coordinate post-download reuse, detached conversion recovery, and fresh conversion. */
export async function runJarConversionWorkflow(
  request: JarConversionWorkflowRequest,
  ports: JarConversionWorkflowPorts,
): Promise<string> {
  const { jarUrl, key, target, jarBytes, usedLabel } = request;
  const progressStartedAt = ports.progress.startedAt(jarUrl);
  ports.onEvent({
    type: 'download-completed',
    key,
    byteLength: jarBytes.length,
    elapsedMs: progressStartedAt === null ? 0 : ports.now() - progressStartedAt,
  });
  ports.progress.setConvertStage(jarUrl);
  if (usedLabel && usedLabel !== '默认 UA') {
    ports.onEvent({ type: 'download-retry-succeeded', jarUrl, usedLabel });
  }

  ports.cache.ensureDirectory();
  const rawJar = ports.cache.rawJarPath(key);
  ports.cache.writeRawJar(rawJar, jarBytes);
  const contentKey = ports.cache.contentKey(jarBytes);
  const reused = ports.cache.reuseByContent(contentKey, key);
  if (reused.reused) {
    ports.onEvent({ type: 'content-reused', jarUrl, byteLength: jarBytes.length, from: reused.from, target });
    ports.cache.complete(jarUrl, target, contentKey);
    return target;
  }

  if (await ports.artifacts.adoptPart(key, rawJar, target, false)) {
    ports.onEvent({ type: 'detached-part-adopted', target });
    ports.cache.complete(jarUrl, target, contentKey);
    return target;
  }

  const lock = ports.detached.readLock(key);
  if (ports.detached.isAlive(lock)) {
    ports.onEvent({
      type: 'attached-to-detached-conversion',
      pid: lock.pid,
      elapsedMs: ports.now() - lock.startedAt,
    });
    ports.progress.attachTo(jarUrl, lock.startedAt);
    const adopted = await ports.detached.waitForAttached(
      key,
      lock,
      () => ports.artifacts.adoptPart(key, rawJar, target, false),
    );
    if (!adopted) {
      throw new ConversionInFlightError(
        `该 jar 的后台转换仍在进行（已 ${formatDuration(ports.now() - lock.startedAt)}），稍后自动重试`,
      );
    }
    ports.cache.complete(jarUrl, target, contentKey);
    return target;
  }
  if (lock) ports.detached.clearLock(key);

  await ports.converter.convert({ rawJar, key, jarBytes });
  await ports.artifacts.adoptPart(key, rawJar, target, true);
  ports.cache.complete(jarUrl, target, contentKey);
  return target;
}
