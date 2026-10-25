import { spawn } from 'node:child_process';
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { formatDuration } from './formatDuration';

export { formatDuration } from './formatDuration';

export const DEX2JAR_TIMEOUT_MS = 600_000;
const ATTACH_POLL_MS = 1500;
const CONVERSION_LOG_INTERVAL_MS = 15_000;
const EOCD_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const EOCD_TAIL_WINDOW = 70 * 1024;

export interface DetachedConversionLock {
  pid: number;
  startedAt: number;
  heapMb: number;
}

export interface Dex2jarRunResult {
  ok: boolean;
  output: string;
  timedOut?: boolean;
}

/** Process and lock-file boundary for detached dex2jar work. */
export interface DetachedDex2jarPort {
  partPath(key: string): string;
  readLog(key: string): string;
  readLock(key: string): DetachedConversionLock | null;
  clearLock(key: string): void;
  isAlive(lock: DetachedConversionLock | null): lock is DetachedConversionLock;
  run(jdk: string, classpath: string, heapMb: number, rawJar: string, key: string): Promise<Dex2jarRunResult>;
  waitForAttached(
    key: string,
    lock: DetachedConversionLock,
    adoptPart: () => Promise<boolean>,
  ): Promise<boolean>;
}

export interface DetachedDex2jarLogger {
  info(message: string): void;
}

export class DetachedDex2jarCoordinator implements DetachedDex2jarPort {
  constructor(
    private readonly cacheDir: string,
    private readonly logger: DetachedDex2jarLogger,
  ) {}

  partPath(key: string): string {
    return join(this.cacheDir, key + '.part.jar');
  }

  private lockPath(key: string): string {
    return join(this.cacheDir, key + '.lock');
  }

  private logPath(key: string): string {
    return join(this.cacheDir, key + '.d2j.log');
  }

  readLock(key: string): DetachedConversionLock | null {
    try {
      const value = JSON.parse(readFileSync(this.lockPath(key), 'utf8')) as DetachedConversionLock;
      return value && typeof value.pid === 'number' && typeof value.startedAt === 'number' ? value : null;
    } catch {
      return null;
    }
  }

  private writeLock(key: string, lock: DetachedConversionLock): void {
    try {
      writeFileSync(this.lockPath(key), JSON.stringify(lock));
    } catch {
      // The detached process can still finish; the next app start will validate its output.
    }
  }

  clearLock(key: string): void {
    try {
      rmSync(this.lockPath(key), { force: true });
    } catch {
      // A stale lock is harmless and will be overwritten on the next conversion.
    }
  }

  readLog(key: string): string {
    try {
      return readFileSync(this.logPath(key), 'utf8').slice(-8000);
    } catch {
      return '';
    }
  }

  isAlive(lock: DetachedConversionLock | null): lock is DetachedConversionLock {
    if (!lock || !(lock.startedAt > 0) || lock.pid <= 0) return false;
    if (Date.now() - lock.startedAt > DEX2JAR_TIMEOUT_MS) return false;
    try {
      process.kill(lock.pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }

  async run(
    jdk: string,
    classpath: string,
    heapMb: number,
    rawJar: string,
    key: string,
  ): Promise<Dex2jarRunResult> {
    const part = this.partPath(key);
    const logFile = this.logPath(key);
    const args = [
      '-Xmx' + heapMb + 'm',
      '-XX:+UseSerialGC',
      '-XX:TieredStopAtLevel=1',
      '-XX:ReservedCodeCacheSize=32m',
      '-Dfile.encoding=UTF-8',
      '-cp',
      classpath,
      'com.googlecode.dex2jar.tools.Dex2jarCmd',
      rawJar,
      '-o',
      part,
      '--force',
    ];

    return new Promise((resolve) => {
      let fd = -1;
      try {
        writeFileSync(logFile, '');
        fd = openSync(logFile, 'a');
      } catch {
        fd = -1;
      }
      let output = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      let progressTimer: ReturnType<typeof setInterval> | undefined;
      let settled = false;
      const finish = (result: Dex2jarRunResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (progressTimer) clearInterval(progressTimer);
        this.clearLock(key);
        resolve(result);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(jdk, args, {
          windowsHide: true,
          detached: true,
          stdio: fd >= 0 ? ['ignore', fd, fd] : 'ignore',
        });
      } catch (error) {
        if (fd >= 0) {
          try { closeSync(fd); } catch { /* ignore */ }
        }
        finish({ ok: false, output: 'spawn 失败: ' + (error as Error).message });
        return;
      }
      if (fd >= 0) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
      const startedAt = Date.now();
      this.writeLock(key, { pid: child.pid ?? 0, startedAt, heapMb });
      child.unref?.();
      const keepTail = (data: Buffer | string) => {
        output = (output + String(data)).slice(-8000);
      };
      child.stdout?.on('data', keepTail);
      child.stderr?.on('data', keepTail);
      progressTimer = setInterval(() => {
        this.logger.info(
          'jvm-bridge dex2jar 进行中：已 ' + formatDuration(Date.now() - startedAt) +
          '（-Xmx' + heapMb + 'm，pid=' + (child.pid ?? 0) + '）',
        );
      }, CONVERSION_LOG_INTERVAL_MS);
      progressTimer.unref?.();
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        finish({ ok: false, output: this.readLog(key) || output, timedOut: true });
      }, DEX2JAR_TIMEOUT_MS);
      timer.unref?.();
      child.on('error', (error) => finish({ ok: false, output: 'spawn 失败: ' + error.message + '\n' + output }));
      child.on('close', (code) => finish({ ok: code === 0, output: output || this.readLog(key) }));
    });
  }

  async waitForAttached(
    key: string,
    lock: DetachedConversionLock,
    adoptPart: () => Promise<boolean>,
  ): Promise<boolean> {
    const deadline = Math.min(lock.startedAt + DEX2JAR_TIMEOUT_MS, Date.now() + DEX2JAR_TIMEOUT_MS);
    let nextLog = Date.now() + CONVERSION_LOG_INTERVAL_MS;
    while (Date.now() < deadline) {
      if (this.partLooksComplete(key) && await adoptPart()) return true;
      if (!this.isAlive(lock)) return adoptPart();
      if (Date.now() >= nextLog) {
        nextLog = Date.now() + CONVERSION_LOG_INTERVAL_MS;
        this.logger.info(
          'jvm-bridge dex2jar 后台转换进行中（接管等待）：已 ' +
          formatDuration(Date.now() - lock.startedAt) + '（pid=' + lock.pid + '）',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, ATTACH_POLL_MS));
    }
    return adoptPart();
  }

  private partLooksComplete(key: string): boolean {
    let fd = -1;
    try {
      const part = this.partPath(key);
      const length = statSync(part).size;
      if (length < 32) return false;
      fd = openSync(part, 'r');
      const windowSize = Math.min(EOCD_TAIL_WINDOW, length);
      const tail = Buffer.alloc(windowSize);
      readSync(fd, tail, 0, windowSize, length - windowSize);
      return tail.includes(EOCD_MAGIC);
    } catch {
      return false;
    } finally {
      if (fd >= 0) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }
  }
}
