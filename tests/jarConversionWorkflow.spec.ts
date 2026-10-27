import { describe, expect, it, vi } from 'vitest';
import { ConversionInFlightError } from '../src/engine/spider/JarConversionRegistry';
import {
  runJarConversionWorkflow,
  type JarConversionLockSnapshot,
  type JarConversionWorkflowPorts,
  type JarConversionWorkflowRequest,
} from '../src/engine/spider/JarConversionWorkflow';

const request: JarConversionWorkflowRequest = {
  jarUrl: 'https://example.com/source.jar',
  key: 'current-key',
  target: '/cache/current-key.jar',
  jarBytes: Buffer.from([1, 2, 3, 4]),
  usedLabel: 'okhttp UA',
};

const liveLock: JarConversionLockSnapshot = { pid: 1234, startedAt: 15_000, heapMb: 512 };

function createWorkflowHarness() {
  const calls: string[] = [];
  const events: string[] = [];
  const lockState: { lock: JarConversionLockSnapshot | null; alive: boolean } = { lock: null, alive: false };
  const ports: JarConversionWorkflowPorts = {
    now: vi.fn(() => 20_000),
    onEvent: vi.fn((event) => { events.push(event.type); calls.push(`event:${event.type}`); }),
    progress: {
      startedAt: vi.fn((url) => { calls.push(`progress-start:${url}`); return 10_000; }),
      setConvertStage: vi.fn((url) => { calls.push(`stage-convert:${url}`); }),
      attachTo: vi.fn((url, startedAt) => { calls.push(`attach:${url}:${startedAt}`); }),
    },
    cache: {
      ensureDirectory: vi.fn(() => { calls.push('cache:ensure'); }),
      rawJarPath: vi.fn((key) => { calls.push(`cache:path:${key}`); return `/cache/${key}.raw.jar`; }),
      writeRawJar: vi.fn((path, bytes) => { calls.push(`cache:write:${path}:${bytes.length}`); }),
      contentKey: vi.fn(() => { calls.push('cache:hash'); return 'content-key'; }),
      reuseByContent: vi.fn(() => { calls.push('cache:reuse'); return { reused: false }; }),
      complete: vi.fn((url, target) => { calls.push(`cache:complete:${url}:${target}`); }),
    },
    artifacts: {
      adoptPart: vi.fn(async (key, rawJar, target, strict) => {
        calls.push(`artifact:adopt:${strict}:${key}:${rawJar}:${target}`);
        return false;
      }),
    },
    detached: {
      readLock: vi.fn((key) => { calls.push(`lock:read:${key}`); return lockState.lock; }),
      isAlive: (lock: JarConversionLockSnapshot | null): lock is JarConversionLockSnapshot => {
        calls.push(`lock:alive:${Boolean(lock)}`);
        return lockState.alive;
      },
      clearLock: vi.fn((key) => { calls.push(`lock:clear:${key}`); }),
      waitForAttached: vi.fn(async (key, lock, adoptPart) => {
        calls.push(`lock:wait:${key}:${lock.pid}`);
        return adoptPart();
      }),
    },
    converter: {
      convert: vi.fn(async ({ rawJar, key, jarBytes }) => {
        calls.push(`converter:${key}:${rawJar}:${jarBytes.length}`);
      }),
    },
  };
  return { calls, events, lockState, ports };
}

describe('runJarConversionWorkflow', () => {
  it('writes raw bytes and reuses a matching content artifact before detached recovery', async () => {
    const { calls, events, ports } = createWorkflowHarness();
    vi.mocked(ports.cache.reuseByContent).mockImplementation(() => {
      calls.push('cache:reuse');
      return { reused: true, from: '/cache/previous.jar' };
    });

    await expect(runJarConversionWorkflow(request, ports)).resolves.toBe(request.target);

    expect(calls).toEqual([
      `progress-start:${request.jarUrl}`,
      'event:download-completed',
      `stage-convert:${request.jarUrl}`,
      'event:download-retry-succeeded',
      'cache:ensure',
      `cache:path:${request.key}`,
      `cache:write:/cache/${request.key}.raw.jar:${request.jarBytes.length}`,
      'cache:hash',
      'cache:reuse',
      'event:content-reused',
      `cache:complete:${request.jarUrl}:${request.target}`,
    ]);
    expect(events).toEqual(['download-completed', 'download-retry-succeeded', 'content-reused']);
    expect(ports.artifacts.adoptPart).not.toHaveBeenCalled();
    expect(ports.detached.readLock).not.toHaveBeenCalled();
    expect(ports.converter.convert).not.toHaveBeenCalled();
  });

  it('adopts a completed detached artifact before reading its lock or starting conversion', async () => {
    const { calls, ports } = createWorkflowHarness();
    vi.mocked(ports.artifacts.adoptPart).mockImplementationOnce(async (key, rawJar, target, strict) => {
      calls.push(`artifact:adopt:${strict}:${key}:${rawJar}:${target}`);
      return true;
    });

    await expect(runJarConversionWorkflow({ ...request, usedLabel: undefined }, ports)).resolves.toBe(request.target);

    expect(calls.slice(-3)).toEqual([
      `artifact:adopt:false:${request.key}:/cache/${request.key}.raw.jar:${request.target}`,
      'event:detached-part-adopted',
      `cache:complete:${request.jarUrl}:${request.target}`,
    ]);
    expect(ports.detached.readLock).not.toHaveBeenCalled();
    expect(ports.converter.convert).not.toHaveBeenCalled();
  });

  it('attaches to a live same-key conversion and adopts its part instead of launching another process', async () => {
    const { calls, lockState, ports } = createWorkflowHarness();
    vi.mocked(ports.detached.readLock).mockImplementation((key) => { calls.push(`lock:read:${key}`); return liveLock; });
    lockState.lock = liveLock;
    lockState.alive = true;
    const adoptionResults = [false, true];
    vi.mocked(ports.artifacts.adoptPart).mockImplementation(async (key, rawJar, target, strict) => {
      calls.push(`artifact:adopt:${strict}:${key}:${rawJar}:${target}`);
      return adoptionResults.shift() ?? false;
    });
    vi.mocked(ports.detached.waitForAttached).mockImplementation(async (key, lock, adoptPart) => {
      calls.push(`lock:wait:${key}:${lock.pid}`);
      return adoptPart();
    });

    await expect(runJarConversionWorkflow({ ...request, usedLabel: undefined }, ports)).resolves.toBe(request.target);

    expect(calls.slice(-7)).toEqual([
      'lock:read:current-key',
      'lock:alive:true',
      'event:attached-to-detached-conversion',
      `attach:${request.jarUrl}:${liveLock.startedAt}`,
      'lock:wait:current-key:1234',
      `artifact:adopt:false:${request.key}:/cache/${request.key}.raw.jar:${request.target}`,
      `cache:complete:${request.jarUrl}:${request.target}`,
    ]);
    expect(ports.converter.convert).not.toHaveBeenCalled();
    expect(ports.cache.complete).toHaveBeenCalledOnce();
  });

  it('raises the in-flight signal when a live process has not published a usable part yet', async () => {
    const { lockState, ports } = createWorkflowHarness();
    lockState.lock = liveLock;
    lockState.alive = true;
    vi.mocked(ports.detached.waitForAttached).mockResolvedValue(false);

    await expect(runJarConversionWorkflow({ ...request, usedLabel: undefined }, ports))
      .rejects.toBeInstanceOf(ConversionInFlightError);
    expect(ports.converter.convert).not.toHaveBeenCalled();
    expect(ports.cache.complete).not.toHaveBeenCalled();
  });

  it('clears a stale lock, starts one conversion, strictly adopts the output, then registers completion', async () => {
    const { calls, lockState, ports } = createWorkflowHarness();
    const staleLock = { ...liveLock, pid: 0 };
    lockState.lock = staleLock;
    const adoptionResults = [false, true];
    vi.mocked(ports.artifacts.adoptPart).mockImplementation(async (key, rawJar, target, strict) => {
      calls.push(`artifact:adopt:${strict}:${key}:${rawJar}:${target}`);
      return adoptionResults.shift() ?? false;
    });

    await expect(runJarConversionWorkflow({ ...request, usedLabel: undefined }, ports)).resolves.toBe(request.target);

    expect(calls.slice(-6)).toEqual([
      'lock:read:current-key',
      'lock:alive:true',
      'lock:clear:current-key',
      `converter:${request.key}:/cache/${request.key}.raw.jar:${request.jarBytes.length}`,
      `artifact:adopt:true:${request.key}:/cache/${request.key}.raw.jar:${request.target}`,
      `cache:complete:${request.jarUrl}:${request.target}`,
    ]);
    expect(ports.detached.clearLock).toHaveBeenCalledWith(request.key);
    expect(ports.converter.convert).toHaveBeenCalledOnce();
    expect(ports.artifacts.adoptPart).toHaveBeenLastCalledWith(request.key, `/cache/${request.key}.raw.jar`, request.target, true);
  });

  it('preserves a conversion error and does not register an incomplete artifact', async () => {
    const { ports } = createWorkflowHarness();
    const conversionError = new Error('dex2jar failed');
    vi.mocked(ports.converter.convert).mockRejectedValue(conversionError);

    await expect(runJarConversionWorkflow({ ...request, usedLabel: undefined }, ports)).rejects.toBe(conversionError);
    expect(ports.cache.complete).not.toHaveBeenCalled();
    expect(ports.artifacts.adoptPart).toHaveBeenCalledOnce();
  });
});
