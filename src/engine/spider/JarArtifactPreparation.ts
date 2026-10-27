export interface JarArtifactPreparationRequest {
  key: string;
  rawJar: string;
  target: string;
  strict: boolean;
}

/**
 * The archive-to-cache workflow owns the preparation order; the bridge supplies
 * filesystem, bytecode-repair, and promotion adapters.
 */
export interface JarArtifactPreparationPorts {
  partPath(key: string): string;
  sizeOf(path: string): number;
  isUsable(path: string): boolean;
  mergeRawResources(rawJar: string, partialJar: string): void;
  repairDexConstructors(rawJar: string, partialJar: string): Promise<void>;
  repairSelfSuperCalls(partialJar: string): void;
  patchSpiderProxy(partialJar: string): void;
  promote(partialJar: string, target: string): boolean;
}

/** Validate, repair, and atomically publish one detached dex2jar artifact. */
export async function prepareConvertedJarArtifact(
  request: JarArtifactPreparationRequest,
  ports: JarArtifactPreparationPorts,
): Promise<boolean> {
  const partialJar = ports.partPath(request.key);
  if (ports.sizeOf(partialJar) === 0) {
    if (request.strict) throw new Error('dex2jar 转换产物为空');
    return false;
  }
  if (!ports.isUsable(partialJar)) {
    if (request.strict) throw new Error('dex2jar 转换产物为空（只得到空 jar，未产出任何 class）');
    return false;
  }

  ports.mergeRawResources(request.rawJar, partialJar);
  await ports.repairDexConstructors(request.rawJar, partialJar);
  ports.repairSelfSuperCalls(partialJar);
  ports.patchSpiderProxy(partialJar);

  if (ports.promote(partialJar, request.target)) return true;
  if (request.strict) throw new Error('dex2jar 转换产物不可用（改名失败）');
  return false;
}
