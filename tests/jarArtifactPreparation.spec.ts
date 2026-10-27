import { describe, expect, it, vi } from 'vitest';
import {
  prepareConvertedJarArtifact,
  type JarArtifactPreparationPorts,
  type JarArtifactPreparationRequest,
} from '../src/engine/spider/JarArtifactPreparation';

const request: JarArtifactPreparationRequest = {
  key: 'source-key',
  rawJar: '/cache/source.jar',
  target: '/cache/converted.jar',
  strict: false,
};

function createPorts() {
  const calls: string[] = [];
  const ports: JarArtifactPreparationPorts = {
    partPath: vi.fn((key) => {
      calls.push(`part:${key}`);
      return `/cache/${key}.part`;
    }),
    sizeOf: vi.fn((path) => {
      calls.push(`size:${path}`);
      return 100;
    }),
    isUsable: vi.fn((path) => {
      calls.push(`usable:${path}`);
      return true;
    }),
    mergeRawResources: vi.fn((raw, part) => { calls.push(`merge:${raw}:${part}`); }),
    repairDexConstructors: vi.fn(async (raw, part) => { calls.push(`constructors:${raw}:${part}`); }),
    repairSelfSuperCalls: vi.fn((part) => { calls.push(`super:${part}`); }),
    patchSpiderProxy: vi.fn((part) => { calls.push(`proxy:${part}`); }),
    promote: vi.fn((part, target) => {
      calls.push(`promote:${part}:${target}`);
      return true;
    }),
  };
  return { calls, ports };
}

describe('prepareConvertedJarArtifact', () => {
  it('skips repairs and publication for a missing partial artifact unless strict mode is requested', async () => {
    const { ports } = createPorts();
    vi.mocked(ports.sizeOf).mockReturnValue(0);

    await expect(prepareConvertedJarArtifact(request, ports)).resolves.toBe(false);
    expect(ports.partPath).toHaveBeenCalledWith('source-key');
    expect(ports.sizeOf).toHaveBeenCalledWith('/cache/source-key.part');
    expect(ports.isUsable).not.toHaveBeenCalled();
    expect(ports.promote).not.toHaveBeenCalled();

    await expect(prepareConvertedJarArtifact({ ...request, strict: true }, ports))
      .rejects.toThrow('dex2jar 转换产物为空');
  });

  it('rejects an unusable archive before mutating or publishing it', async () => {
    const { ports } = createPorts();
    vi.mocked(ports.isUsable).mockReturnValue(false);

    await expect(prepareConvertedJarArtifact(request, ports)).resolves.toBe(false);
    expect(ports.partPath).toHaveBeenCalledWith('source-key');
    expect(ports.sizeOf).toHaveBeenCalledWith('/cache/source-key.part');
    expect(ports.isUsable).toHaveBeenCalledWith('/cache/source-key.part');
    expect(ports.mergeRawResources).not.toHaveBeenCalled();
    expect(ports.promote).not.toHaveBeenCalled();

    await expect(prepareConvertedJarArtifact({ ...request, strict: true }, ports))
      .rejects.toThrow('dex2jar 转换产物为空（只得到空 jar，未产出任何 class）');
  });

  it('runs resource merge and repairs in order before publishing the converted artifact', async () => {
    const { calls, ports } = createPorts();

    await expect(prepareConvertedJarArtifact(request, ports)).resolves.toBe(true);
    expect(calls).toEqual([
      'part:source-key',
      'size:/cache/source-key.part',
      'usable:/cache/source-key.part',
      'merge:/cache/source.jar:/cache/source-key.part',
      'constructors:/cache/source.jar:/cache/source-key.part',
      'super:/cache/source-key.part',
      'proxy:/cache/source-key.part',
      'promote:/cache/source-key.part:/cache/converted.jar',
    ]);
  });

  it('returns false or throws when publication fails according to strict mode', async () => {
    const { ports } = createPorts();
    vi.mocked(ports.promote).mockReturnValue(false);

    await expect(prepareConvertedJarArtifact(request, ports)).resolves.toBe(false);
    await expect(prepareConvertedJarArtifact({ ...request, strict: true }, ports))
      .rejects.toThrow('dex2jar 转换产物不可用（改名失败）');
  });

  it('does not publish when a required asynchronous repair fails', async () => {
    const { ports } = createPorts();
    const repairError = new Error('constructor repair failed');
    vi.mocked(ports.repairDexConstructors).mockRejectedValue(repairError);

    await expect(prepareConvertedJarArtifact(request, ports)).rejects.toBe(repairError);
    expect(ports.repairSelfSuperCalls).not.toHaveBeenCalled();
    expect(ports.patchSpiderProxy).not.toHaveBeenCalled();
    expect(ports.promote).not.toHaveBeenCalled();
  });
});
