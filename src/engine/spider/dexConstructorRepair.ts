export interface DexConstructorRepairCommand {
  executable: string;
  args: string[];
  timeoutMs: number;
}

export interface DexConstructorRepairRuntime {
  javaExecutable: string;
  bridgeJar: string;
  dex2jarClasspath: string;
}

export interface DexConstructorRepairRequest {
  rawJar: string;
  partialJar: string;
  bridgeJar: string;
  timeoutMs: number;
}

export interface DexConstructorRepairPorts {
  shouldRepair(rawJar: string): boolean;
  repairToolExists(bridgeJar: string): boolean;
  runtime(): DexConstructorRepairRuntime;
  workspacePath(partialJar: string): string;
  copy(source: string, destination: string): void;
  run(command: DexConstructorRepairCommand): Promise<string>;
  isUsable(path: string): boolean;
  promote(workspaceJar: string, partialJar: string): void;
  remove(path: string): void;
}

export type DexConstructorRepairResult =
  | { status: 'skipped'; reason: 'not-needed' | 'repair-tool-missing' }
  | { status: 'repaired'; fixedSites: number };

/** Build the JVM command without filesystem or process access. All paths are adapter-resolved. */
export function buildDexConstructorRepairCommand(
  request: DexConstructorRepairRequest,
  workspaceJar: string,
  runtime: DexConstructorRepairRuntime,
): DexConstructorRepairCommand {
  return {
    executable: runtime.javaExecutable,
    timeoutMs: request.timeoutMs,
    args: [
      '-Xmx384m',
      '-XX:+UseSerialGC',
      '-XX:TieredStopAtLevel=1',
      '-Dfile.encoding=UTF-8',
      '-cp', [runtime.bridgeJar, runtime.dex2jarClasspath].join(';'),
      'com.winbox.nativebridge.DexJarRepair',
      request.rawJar,
      workspaceJar,
      runtime.javaExecutable,
      runtime.dex2jarClasspath,
    ],
  };
}

/**
 * Decides whether the DEX repair is needed and publishes a repaired copy only
 * after the subprocess reports a repair and the resulting archive is usable.
 */
export async function repairDexConstructorArtifact(
  request: DexConstructorRepairRequest,
  ports: DexConstructorRepairPorts,
): Promise<DexConstructorRepairResult> {
  if (!ports.shouldRepair(request.rawJar)) return { status: 'skipped', reason: 'not-needed' };
  if (!ports.repairToolExists(request.bridgeJar)) {
    return { status: 'skipped', reason: 'repair-tool-missing' };
  }

  const runtime = ports.runtime();
  const workspaceJar = ports.workspacePath(request.partialJar);
  try {
    ports.copy(request.partialJar, workspaceJar);
    const output = await ports.run(buildDexConstructorRepairCommand(request, workspaceJar, runtime));
    const fixedSites = /fixed sites = (\d+)/.exec(output);
    if (!fixedSites || !ports.isUsable(workspaceJar)) {
      throw new Error(`DEX 构造器修复未完成：${output.slice(-400)}`);
    }
    ports.promote(workspaceJar, request.partialJar);
    return { status: 'repaired', fixedSites: Number(fixedSites[1]) };
  } finally {
    ports.remove(workspaceJar);
  }
}
