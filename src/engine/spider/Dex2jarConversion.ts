import { isOomOutput as hasOutOfMemoryEvidence, d2jHeapMb as estimateD2jHeapMb } from './jarBridgePolicy';
import type { DetachedDex2jarPort } from './DetachedDex2jar';

export interface Dex2jarConversionRequest {
  executable: string;
  classpath: string;
  rawJar: string;
  key: string;
  dexBytes: number;
  rawJarBytes: number;
}

export interface Dex2jarConversionLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Owns heap sizing, OOM retry, and failure translation for one dex2jar conversion. */
export class Dex2jarConversion {
  constructor(
    private readonly process: Pick<DetachedDex2jarPort, 'run' | 'readLog' | 'partPath'>,
    private readonly totalMemoryBytes: number,
    private readonly logger: Dex2jarConversionLogger,
    private readonly removePart: (path: string) => void,
  ) {}

  async convert(request: Dex2jarConversionRequest): Promise<void> {
    const { executable, classpath, rawJar, key, dexBytes, rawJarBytes } = request;
    let heapMb = estimateD2jHeapMb(dexBytes, this.totalMemoryBytes);

    if (hasOutOfMemoryEvidence(this.process.readLog(key))) {
      const retryHeap = estimateD2jHeapMb(dexBytes, this.totalMemoryBytes, 2);
      if (retryHeap > heapMb) {
        this.logger.warn(`jvm-bridge 上次转换疑似堆不足 → 本次直接按 -Xmx${retryHeap}m 起步（原 -Xmx${heapMb}m）`);
        heapMb = retryHeap;
      }
    }

    this.logger.info(
      `jvm-bridge dex2jar 开始转换：classes.dex ${(dexBytes / 1048576).toFixed(1)}MB，-Xmx${heapMb}m，raw ${(rawJarBytes / 1048576).toFixed(1)}MB`,
    );
    let result = await this.process.run(executable, classpath, heapMb, rawJar, key);

    if (!result.ok && hasOutOfMemoryEvidence(result.output)) {
      const retryHeap = estimateD2jHeapMb(dexBytes, this.totalMemoryBytes, 2);
      if (retryHeap > heapMb) {
        this.logger.warn(
          `jvm-bridge dex2jar 堆不足（-Xmx${heapMb}m，classes.dex ${(dexBytes / 1048576).toFixed(1)}MB）→ 按 -Xmx${retryHeap}m 重试`,
        );
        heapMb = retryHeap;
        result = await this.process.run(executable, classpath, heapMb, rawJar, key);
      }
    }

    if (result.ok) return;

    this.removePart(this.process.partPath(key));
    const dexMb = (dexBytes / 1048576).toFixed(1);
    if (hasOutOfMemoryEvidence(result.output)) {
      throw new Error(
        `dex2jar 转换内存不足（classes.dex 约 ${dexMb}MB，已按 -Xmx${heapMb}m 重试仍失败）：` +
          '该 jar 体积偏大，请在关闭其他占用内存的程序后清理缓存并重试',
      );
    }

    const tail = result.output.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 240);
    throw new Error(`dex2jar 转换失败（进程退出异常${result.timedOut ? '，转换超时' : ''}）：${tail || '无输出'}`);
  }
}
