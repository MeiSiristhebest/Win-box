import { describe, expect, it, vi } from 'vitest';
import {
  buildDexConstructorRepairCommand,
  repairDexConstructorArtifact,
  type DexConstructorRepairCommand,
  type DexConstructorRepairPorts,
  type DexConstructorRepairRequest,
  type DexConstructorRepairRuntime,
} from '../src/engine/spider/dexConstructorRepair';

const request: DexConstructorRepairRequest = {
  rawJar: 'C:/cache/raw.jar',
  partialJar: 'C:/cache/converted.part.jar',
  bridgeJar: 'C:/jvm/native-bridge/native-bridge.jar',
  timeoutMs: 90_000,
};

const runtime: DexConstructorRepairRuntime = {
  javaExecutable: 'C:/jvm/bin/java.exe',
  bridgeJar: 'C:/jvm/native-bridge/native-bridge.jar',
  dex2jarClasspath: 'C:/jvm/d2j/dex-tools.jar;C:/jvm/d2j/dex-reader.jar',
};

function createHarness() {
  const calls: string[] = [];
  const ports: DexConstructorRepairPorts = {
    shouldRepair: vi.fn((raw) => { calls.push(`inspect:${raw}`); return true; }),
    repairToolExists: vi.fn((bridge) => { calls.push(`tool:${bridge}`); return true; }),
    runtime: vi.fn(() => { calls.push('runtime'); return runtime; }),
    workspacePath: vi.fn((partial) => { calls.push(`workspace:${partial}`); return `${partial}.constructors.jar`; }),
    copy: vi.fn((source, target) => { calls.push(`copy:${source}:${target}`); }),
    run: vi.fn(async (command: DexConstructorRepairCommand) => {
      calls.push(`run:${command.executable}`);
      return '[dexjar-repair] fixed sites = 348';
    }),
    isUsable: vi.fn((path) => { calls.push(`usable:${path}`); return true; }),
    promote: vi.fn((source, target) => { calls.push(`promote:${source}:${target}`); }),
    remove: vi.fn((path) => { calls.push(`remove:${path}`); }),
  };
  return { calls, ports };
}

describe('repairDexConstructorArtifact', () => {
  it('skips work when the source does not need DEX repair', async () => {
    const { ports } = createHarness();
    vi.mocked(ports.shouldRepair).mockReturnValue(false);

    await expect(repairDexConstructorArtifact(request, ports))
      .resolves.toEqual({ status: 'skipped', reason: 'not-needed' });
    expect(ports.shouldRepair).toHaveBeenCalledWith(request.rawJar);
    expect(ports.repairToolExists).not.toHaveBeenCalled();
    expect(ports.runtime).not.toHaveBeenCalled();
    expect(ports.copy).not.toHaveBeenCalled();
  });

  it('skips safely when the native bridge repair tool is absent', async () => {
    const { ports } = createHarness();
    vi.mocked(ports.repairToolExists).mockReturnValue(false);

    await expect(repairDexConstructorArtifact(request, ports))
      .resolves.toEqual({ status: 'skipped', reason: 'repair-tool-missing' });
    expect(ports.shouldRepair).toHaveBeenCalledWith(request.rawJar);
    expect(ports.repairToolExists).toHaveBeenCalledWith(request.bridgeJar);
    expect(ports.runtime).not.toHaveBeenCalled();
    expect(ports.copy).not.toHaveBeenCalled();
  });

  it('copies, runs, validates, promotes, and cleans the temporary artifact in order', async () => {
    const { calls, ports } = createHarness();

    await expect(repairDexConstructorArtifact(request, ports))
      .resolves.toEqual({ status: 'repaired', fixedSites: 348 });
    expect(calls).toEqual([
      'inspect:C:/cache/raw.jar',
      'tool:C:/jvm/native-bridge/native-bridge.jar',
      'runtime',
      'workspace:C:/cache/converted.part.jar',
      'copy:C:/cache/converted.part.jar:C:/cache/converted.part.jar.constructors.jar',
      'run:C:/jvm/bin/java.exe',
      'usable:C:/cache/converted.part.jar.constructors.jar',
      'promote:C:/cache/converted.part.jar.constructors.jar:C:/cache/converted.part.jar',
      'remove:C:/cache/converted.part.jar.constructors.jar',
    ]);
  });

  it('does not publish an unverified repair and always removes its working copy', async () => {
    const { ports } = createHarness();
    vi.mocked(ports.run).mockResolvedValue('repair returned without a fixed-sites marker');

    await expect(repairDexConstructorArtifact(request, ports)).rejects.toThrow('DEX 构造器修复未完成');
    expect(ports.promote).not.toHaveBeenCalled();
    expect(ports.remove).toHaveBeenCalledWith(`${request.partialJar}.constructors.jar`);
  });

  it('cleans up when copying or the process adapter fails', async () => {
    const copyFailure = createHarness();
    vi.mocked(copyFailure.ports.copy).mockImplementation(() => { throw new Error('copy failed'); });
    await expect(repairDexConstructorArtifact(request, copyFailure.ports)).rejects.toThrow('copy failed');
    expect(copyFailure.ports.run).not.toHaveBeenCalled();
    expect(copyFailure.ports.remove).toHaveBeenCalledWith(`${request.partialJar}.constructors.jar`);

    const processFailure = createHarness();
    const failure = new Error('repair process failed');
    vi.mocked(processFailure.ports.run).mockRejectedValue(failure);
    await expect(repairDexConstructorArtifact(request, processFailure.ports)).rejects.toBe(failure);
    expect(processFailure.ports.promote).not.toHaveBeenCalled();
    expect(processFailure.ports.remove).toHaveBeenCalledWith(`${request.partialJar}.constructors.jar`);
  });
});

describe('buildDexConstructorRepairCommand', () => {
  it('builds the fixed JVM launch contract with resolved paths and an explicit timeout', () => {
    expect(buildDexConstructorRepairCommand(request, 'C:/cache/work.jar', runtime)).toEqual({
      executable: 'C:/jvm/bin/java.exe',
      timeoutMs: 90_000,
      args: [
        '-Xmx384m',
        '-XX:+UseSerialGC',
        '-XX:TieredStopAtLevel=1',
        '-Dfile.encoding=UTF-8',
        '-cp', `${runtime.bridgeJar};${runtime.dex2jarClasspath}`,
        'com.winbox.nativebridge.DexJarRepair',
        request.rawJar,
        'C:/cache/work.jar',
        runtime.javaExecutable,
        runtime.dex2jarClasspath,
      ],
    });
  });
});
