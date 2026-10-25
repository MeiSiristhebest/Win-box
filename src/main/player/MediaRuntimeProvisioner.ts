import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import type { MediaRuntimeId, MediaRuntimeProgress, MediaRuntimeStatus } from '../../shared/player';
import type { Logger } from '../../shared/types';
import { playerSettings } from './playerSettings';
import { distDir, mediaRuntimesDir } from '../util/paths';
import {
  isTrustedRuntimeDownloadRedirect,
  runtimeAssetSha256,
  runtimeReleaseApiUrl,
  selectRuntimeReleaseAsset,
  type MediaRuntimeRelease,
  type MediaRuntimeReleaseAsset,
} from './mediaRuntimeReleasePolicy';

type RuntimeManifest = { version: string; assetName: string; sha256: string; source: string; relativeBinDir?: string; relativeExecutable?: string };

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const SEVEN_ZIP_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
(async () => {
  const imported = require(workerData.modulePath);
  const factory = imported.default || imported;
  const sevenZip = await factory();
  const mountPoint = '/winbox-runtime';
  if (!sevenZip.FS.analyzePath(mountPoint).exists) sevenZip.FS.mkdir(mountPoint);
  sevenZip.FS.mount(sevenZip.NODEFS, { root: workerData.tempRoot.replace(/\\\\/g, '/') }, mountPoint);
  const previous = sevenZip.FS.cwd();
  sevenZip.FS.chdir(mountPoint);
  try {
    sevenZip.callMain(['x', path.basename(workerData.archivePath), '-o' + path.basename(workerData.extractedRoot), '-y', '-bd']);
  } finally {
    sevenZip.FS.chdir(previous);
    sevenZip.FS.unmount(mountPoint);
  }
  parentPort.postMessage({ ok: true });
})().catch(error => parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) }));
`;

/**
 * Downloads optional playback runtimes from projects linked by their upstream installation pages.
 * The application never mirrors or re-uploads these binaries. The exact GitHub asset digest is
 * checked before extraction, and runtimes live in the per-user data directory.
 */
export class MediaRuntimeProvisioner {
  private controller: AbortController | null = null;
  private progress: ((event: MediaRuntimeProgress) => void) | null = null;

  constructor(private readonly log: Logger, onProgress?: (event: MediaRuntimeProgress) => void) {
    this.progress = onProgress ?? null;
  }

  setProgressHandler(handler: ((event: MediaRuntimeProgress) => void) | null): void {
    this.progress = handler;
  }

  status(): MediaRuntimeStatus {
    return { mpv: this.readManifest('mpv'), ffmpeg: this.readManifest('ffmpeg') };
  }

  cancel(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }

  async install(runtime: MediaRuntimeId): Promise<MediaRuntimeStatus> {
    if (runtime !== 'mpv' && runtime !== 'ffmpeg') throw new Error('不支持的媒体组件');
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('内置下载目前只支持 Windows 64 位');
    if (this.controller) throw new Error('另一个媒体组件正在安装');
    const controller = new AbortController();
    this.controller = controller;
    let tempRoot = '';
    let stageInstall = '';
    try {
      this.emit(runtime, 'resolve', 0, 0, '正在读取官方发行信息');
      const release = await this.getRelease(runtime, controller.signal);
      const asset = selectRuntimeReleaseAsset(runtime, release);
      const digest = runtimeAssetSha256(asset);
      const version = String(release.tag_name || '').trim();
      if (!version || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ARCHIVE_BYTES) {
        throw new Error('官方发行包信息异常，已停止安装');
      }
      const alreadyInstalled = this.readManifest(runtime);
      if (alreadyInstalled.installed && alreadyInstalled.sha256 === digest) {
        if (runtime === 'mpv' && alreadyInstalled.path) playerSettings.update({ mpvPath: alreadyInstalled.path });
        this.emit(runtime, 'complete', asset.size, asset.size, '已是当前官方版本');
        return this.status();
      }

      tempRoot = await mkdtemp(join(tmpdir(), 'winbox-media-'));
      const archivePath = join(tempRoot, runtime === 'mpv' ? 'mpv.7z' : 'ffmpeg.zip');
      await this.download(asset, runtime, version, digest, archivePath, controller.signal);
      this.throwIfCanceled(controller.signal);
      this.emit(runtime, 'verify', asset.size, asset.size, 'SHA-256 校验通过');

      this.emit(runtime, 'extract', asset.size, asset.size, '正在解压到临时目录');
      const extractedRoot = join(tempRoot, 'extracted');
      await mkdir(extractedRoot, { recursive: true });
      await this.extract(archivePath, tempRoot, extractedRoot, controller.signal);
      this.throwIfCanceled(controller.signal);
      const extracted = await this.findRuntimeFiles(runtime, extractedRoot);
      if (!(await isWindowsX64Pe(extracted.executable))) throw new Error('发行包中的程序不是 Windows x64 可执行文件');
      if (runtime === 'ffmpeg') {
        if (!(await isWindowsX64Pe(extracted.probe!))) throw new Error('发行包中的 ffprobe 不是 Windows x64 可执行文件');
      }

      const root = join(mediaRuntimesDir(), runtime);
      const versionsDir = join(root, 'versions');
      await mkdir(versionsDir, { recursive: true });
      const slug = safeSlug(version + '-' + digest.slice(0, 12));
      const installDir = join(versionsDir, slug);
      stageInstall = join(versionsDir, '.install-' + Date.now().toString(36));
      await rm(stageInstall, { recursive: true, force: true });
      await mkdir(stageInstall, { recursive: true });
      await copyRegularTree(extracted.directory, stageInstall);
      await copyLicenseFiles(extractedRoot, join(stageInstall, 'licenses'));
      this.throwIfCanceled(controller.signal);
      await rm(installDir, { recursive: true, force: true });
      this.throwIfCanceled(controller.signal);
      await rename(stageInstall, installDir);
      stageInstall = '';

      const relativeExecutable = runtime === 'mpv' ? relative(extracted.directory, extracted.executable) : undefined;
      const manifest: RuntimeManifest = {
        version,
        assetName: asset.name,
        sha256: digest,
        source: release.html_url,
        ...(runtime === 'ffmpeg' ? { relativeBinDir: toPosixPath(join('versions', slug)) } : {}),
        ...(relativeExecutable ? { relativeExecutable: toPosixPath(join('versions', slug, relativeExecutable)) } : {}),
      };
      await writeManifestAtomically(root, manifest);
      if (runtime === 'mpv') {
        const executable = join(installDir, ...(toPosixPath(relative(extracted.directory, extracted.executable))).split('/'));
        playerSettings.update({ mpvPath: executable });
      }
      this.cleanupOldVersions(versionsDir, slug);
      this.emit(runtime, 'complete', asset.size, asset.size, '安装完成');
      this.log.i('媒体组件已安装：' + runtime + ' ' + version + ' (' + asset.name + ')');
      return this.status();
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit(runtime, 'canceled', 0, 0, '已取消');
        throw new Error('已取消下载');
      }
      this.emit(runtime, 'error', 0, 0, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.controller = null;
      if (stageInstall) await rm(stageInstall, { recursive: true, force: true }).catch(() => undefined);
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private emit(runtime: MediaRuntimeId, phase: MediaRuntimeProgress['phase'], received: number, total: number, message: string): void {
    try { this.progress?.({ runtime, phase, received, total, message }); } catch { /* UI may have closed */ }
  }

  private async getRelease(runtime: MediaRuntimeId, signal: AbortSignal): Promise<MediaRuntimeRelease> {
    const url = runtimeReleaseApiUrl(runtime);
    const response = await fetch(url, {
      signal,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'Win-Box media runtime installer',
      },
    });
    if (!response.ok) throw new Error('读取官方发行信息失败（HTTP ' + response.status + '）');
    const value = await response.json() as Partial<MediaRuntimeRelease>;
    if (!Array.isArray(value.assets) || typeof value.tag_name !== 'string' || typeof value.html_url !== 'string') {
      throw new Error('官方发行信息格式异常');
    }
    return value as MediaRuntimeRelease;
  }

  private async download(asset: MediaRuntimeReleaseAsset, runtime: MediaRuntimeId, version: string, expected: string, path: string, signal: AbortSignal): Promise<void> {
    this.throwIfCanceled(signal);
    this.emit(runtime, 'download', 0, asset.size, '正在从 GitHub 下载 ' + asset.name);
    const response = await fetch(asset.browser_download_url, { signal, headers: { 'user-agent': 'Win-Box media runtime installer' } });
    if (!response.ok || !response.body) throw new Error('下载官方发行包失败（HTTP ' + response.status + '）');
    if (!isTrustedRuntimeDownloadRedirect(response.url)) throw new Error('发行包重定向到了未认可的域名');
    const hash = createHash('sha256');
    let received = 0;
    let lastUpdate = 0;
    const meter = new Transform({
      transform: (chunk: Buffer | string, _encoding, callback) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += bytes.length;
        hash.update(bytes);
        const now = Date.now();
        if (now - lastUpdate > 200 || received === asset.size) {
          lastUpdate = now;
          this.emit(runtime, 'download', received, asset.size, '正在下载 ' + version);
        }
        callback(null, bytes);
      },
    });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, createWriteStream(path, { flags: 'wx' }), { signal });
    const actual = hash.digest('hex');
    if (received !== asset.size) throw new Error('下载文件大小与官方记录不符');
    if (actual !== expected) throw new Error('SHA-256 校验失败，文件已丢弃');
  }

  private async extract(archivePath: string, tempRoot: string, extractedRoot: string, signal: AbortSignal): Promise<void> {
    const require = createRequire(join(distDir(), 'main.cjs'));
    const modulePath = require.resolve('7z-wasm');
    const worker = new Worker(SEVEN_ZIP_WORKER, {
      eval: true,
      name: 'winbox-media-extract',
      workerData: { modulePath, tempRoot: resolve(tempRoot), archivePath, extractedRoot },
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) rejectPromise(error);
        else resolvePromise();
      };
      const onAbort = (): void => {
        void worker.terminate().then(
          () => finish(new Error('解压已取消')),
          () => finish(new Error('解压已取消')),
        );
      };
      signal.addEventListener('abort', onAbort, { once: true });
      worker.once('message', (message: { ok?: boolean; error?: string }) => {
        if (message?.ok) finish();
        else finish(new Error(message?.error || '解压媒体组件失败'));
        void worker.terminate();
      });
      worker.once('error', (error) => { finish(error instanceof Error ? error : new Error(String(error))); void worker.terminate(); });
      worker.once('exit', (code) => {
        if (!settled) finish(new Error(code === 0 ? '解压工作线程未返回结果' : '解压工作线程异常退出（' + code + '）'));
      });
      if (signal.aborted) onAbort();
    });
  }

  private async findRuntimeFiles(runtime: MediaRuntimeId, root: string): Promise<{ executable: string; probe?: string; directory: string }> {
    const executables: string[] = [];
    const probes: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) {
          if (entry.name.toLowerCase() === (runtime === 'mpv' ? 'mpv.exe' : 'ffmpeg.exe')) executables.push(path);
          if (runtime === 'ffmpeg' && entry.name.toLowerCase() === 'ffprobe.exe') probes.push(path);
        }
      }
    };
    await walk(root);
    if (executables.length !== 1) throw new Error('发行包内的 ' + (runtime === 'mpv' ? 'mpv.exe' : 'ffmpeg.exe') + ' 数量异常');
    const executable = executables[0];
    if (runtime === 'mpv') return { executable, directory: dirname(executable) };
    const probe = probes.find(path => dirname(path) === dirname(executable));
    if (!probe) throw new Error('发行包缺少同目录的 ffprobe.exe');
    return { executable, probe, directory: dirname(executable) };
  }

  private readManifest(runtime: MediaRuntimeId): MediaRuntimeStatus['mpv'] | MediaRuntimeStatus['ffmpeg'] {
    const root = join(mediaRuntimesDir(), runtime);
    try {
      const value = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as RuntimeManifest;
      const base = resolve(root);
      if (runtime === 'mpv' && value.relativeExecutable && isSafeRelative(value.relativeExecutable)) {
        const path = resolve(base, ...value.relativeExecutable.split(/[\\/]/));
        if (path.startsWith(base + sep) && path.toLowerCase().endsWith('mpv.exe') && exists(path)) {
          return { installed: true, version: value.version, path, sha256: value.sha256, assetName: value.assetName };
        }
      }
      if (runtime === 'ffmpeg' && value.relativeBinDir && isSafeRelative(value.relativeBinDir)) {
        const binDir = resolve(base, ...value.relativeBinDir.split(/[\\/]/));
        if (binDir.startsWith(base + sep) && exists(join(binDir, 'ffmpeg.exe')) && exists(join(binDir, 'ffprobe.exe'))) {
          return { installed: true, version: value.version, path: binDir, sha256: value.sha256, assetName: value.assetName };
        }
      }
    } catch { /* not installed or metadata damaged */ }
    return { installed: false };
  }

  private cleanupOldVersions(versionsDir: string, keep: string): void {
    for (const entry of readdirSync(versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === keep || entry.name.startsWith('.install-')) continue;
      try { rmSync(join(versionsDir, entry.name), { recursive: true, force: true }); }
      catch (error) { this.log.w('旧媒体组件仍被占用，稍后可清理：' + entry.name + ' (' + String(error) + ')'); }
    }
  }

  private throwIfCanceled(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('已取消下载');
  }
}

function exists(path: string): boolean {
  try { return existsSync(path); } catch { return false; }
}

function isSafeRelative(value: string): boolean {
  return !!value && !value.startsWith('/') && !/^[a-z]:/i.test(value) && !value.split(/[\\/]/).some(part => part === '..');
}

function safeSlug(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'runtime';
}

function toPosixPath(value: string): string {
  return value.split(sep).join('/');
}

async function isWindowsX64Pe(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false;
    const peOffset = bytes.readUInt32LE(0x3c);
    return peOffset + 6 <= bytesRead && bytes.readUInt32LE(peOffset) === 0x00004550 && bytes.readUInt16LE(peOffset + 4) === 0x8664;
  } finally {
    await handle.close();
  }
}

async function copyRegularTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await copyRegularTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function copyLicenseFiles(source: string, destination: string): Promise<void> {
  let copied = 0;
  const walk = async (dir: string): Promise<void> => {
    if (copied >= 24) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(from); continue; }
      if (!entry.isFile() || !/^(license|copying|copyright)([-_.].*)?$/i.test(entry.name)) continue;
      const size = (await lstat(from)).size;
      if (size > 2 * 1024 * 1024) continue;
      const rel = relative(source, from);
      const to = join(destination, rel);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      copied++;
    }
  };
  await walk(source);
}

async function writeManifestAtomically(root: string, manifest: RuntimeManifest): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = join(root, 'active.json');
  const temp = join(root, '.active-' + Date.now().toString(36) + '.tmp');
  await writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8');
  await rename(temp, target);
}
