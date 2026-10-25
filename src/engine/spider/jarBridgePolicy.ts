import { zipEntrySizes } from '../util/syncZip';

export function spiderProxyPort(loadCp: string, base = 19970, span = 30): number {
  let hash = 0;
  for (let index = 0; index < loadCp.length; index++) hash = (hash * 31 + loadCp.charCodeAt(index)) | 0;
  return base + ((hash >>> 0) % span);
}

export const NATIVE_CALL_MIN_TIMEOUT_MS = 300_000;

export function d2jHeapMb(dexBytes: number, totalMemBytes: number, attempt = 1): number {
  const dexMb = Math.max(0, dexBytes) / (1024 * 1024);
  const capMb = Math.min(1792, Math.max(256, Math.floor(totalMemBytes / 4 / (1024 * 1024))));
  const desiredMb = Math.ceil(dexMb * 128) * Math.max(1, attempt);
  return Math.min(capMb, Math.max(256, desiredMb));
}

export function totalDexBytes(rawJar: Buffer): number {
  const dexBytes = zipEntrySizes(rawJar)
    .filter((entry) => /^classes\d*\.dex$/i.test(entry.name))
    .reduce((sum, entry) => sum + entry.size, 0);
  return dexBytes > 0 ? dexBytes : rawJar.length * 3;
}

export function isOomOutput(output: string): boolean {
  return /OutOfMemoryError|insufficient memory|内存不足/i.test(output || '');
}
