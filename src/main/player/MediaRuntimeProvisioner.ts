import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, realpath as realpathAsync, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { MediaRuntimeId, MediaRuntimeProgress, MediaRuntimeStatus } from '../../shared/player';
import type { Logger } from '../../shared/types';
import { playerSettings } from './playerSettings';
import { distDir, mediaRuntimesDir, userDataDir } from '../util/paths';
import {
  runtimeAssetSha256,
  runtimeReleaseApiUrl,
  selectRuntimeReleaseAsset,
  type MediaRuntimeRelease,
} from './mediaRuntimeReleasePolicy';
import {
  downloadVerifiedMediaRuntime,
  MAX_MEDIA_RUNTIME_ARCHIVE_BYTES,
  nodeMediaRuntimeDownloadPort,
  type MediaRuntimeDownloadPort,
} from './mediaRuntimeDownload';
import { MAX_MEDIA_RUNTIME_LISTING_BYTES, validateMediaRuntimeArchiveListing } from './mediaRuntimeArchivePreflight';
import { runMediaRuntimeArchiveWorker, type MediaRuntimeArchiveWorkerPort } from './mediaRuntimeArchiveWorker';
import {
  MediaRuntimeInstallWorkflow,
  type MediaRuntimeInstallPlan,
  type MediaRuntimeInstallWorkspace,
} from './mediaRuntimeInstallWorkflow';
import {
  assertNoReparsePointPrefix,
  enforceMediaRuntimeExpansionBudgetAsync,
  isPathWithin,
  resolveContainedRealPath,
  type AsyncRuntimeTreeFilesystemPort,
  type RuntimeTreeFilesystemPort,
} from './mediaRuntimePathSafety';

type RuntimeManifest = { version: string; assetName: string; sha256: string; source: string; relativeBinDir?: string; relativeExecutable?: string };

const runtimeTreeFilesystem: RuntimeTreeFilesystemPort = {
  lstat: (path) => lstatSync(path),
  realpath: (path) => realpathSync(path),
  readdir: (path) => readdirSync(path, { withFileTypes: true }),
};
const asyncRuntimeTreeFilesystem: AsyncRuntimeTreeFilesystemPort = {
  lstat: async (path) => lstat(path),
  realpath: (path) => realpathAsync(path),
  readdir: async (path) => readdir(path, { withFileTypes: true }),
};

const SEVEN_ZIP_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
(async () => {
  const imported = require(workerData.modulePath);
  const factory = imported.default || imported;
  let listingOutput = '';
  let listingBytes = 0;
  let listingTooLarge = false;
  let diagnostics = '';
  const sevenZip = await factory({
    print(text) {
      if (listingTooLarge) return;
      const value = String(text);
      const size = Buffer.byteLength(value, 'utf8') + 1;
      if (listingBytes + size > workerData.maxListingBytes) {
        listingTooLarge = true;
        return;
      }
      listingBytes += size;
      listingOutput += value + '\\n';
    },
    printErr(text) {
      const value = String(text);
      if (diagnostics.length < 4096) diagnostics += value.slice(0, 4096 - diagnostics.length) + '\\n';
    },
  });
  const mountPoint = '/winbox-runtime';
  if (!sevenZip.FS.analyzePath(mountPoint).exists) sevenZip.FS.mkdir(mountPoint);
  sevenZip.FS.mount(sevenZip.NODEFS, { root: workerData.tempRoot.replace(/\\\\/g, '/') }, mountPoint);
  const previous = sevenZip.FS.cwd();
  sevenZip.FS.chdir(mountPoint);
  try {
    sevenZip.callMain(['l', '-slt', '-bd', path.basename(workerData.archivePath)]);
    if (listingTooLarge) throw new Error('发行包目录清单超过安全上限，已停止解压');
    if (diagnostics.trim()) throw new Error('读取发行包目录清单失败：' + diagnostics.trim().slice(0, 1000));
    parentPort.postMessage({ phase: 'listing', listing: listingOutput });
    const command = await new Promise(resolve => parentPort.once('message', resolve));
    if (!command || command.type !== 'extract') throw new Error('发行包安全预检未通过，已停止解压');
    sevenZip.callMain(['x', path.basename(workerData.archivePath), '-o' + path.basename(workerData.extractedRoot), '-y', '-bd']);
  } finally {
    sevenZip.FS.chdir(previous);
    sevenZip.FS.unmount(mountPoint);
  }
  parentPort.postMessage({ phase: 'complete', ok: true });
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

  constructor(
    private readonly log: Logger,
    onProgress?: (event: MediaRuntimeProgress) => void,
    private readonly downloadPort: MediaRuntimeDownloadPort = nodeMediaRuntimeDownloadPort,
  ) {
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
    const workflow = new MediaRuntimeInstallWorkflow({
      resolvePlan: async (selectedRuntime, signal) => {
        const release = await this.getRelease(selectedRuntime, signal);
        const asset = selectRuntimeReleaseAsset(selectedRuntime, release);
        const sha256 = runtimeAssetSha256(asset);
        const version = String(release.tag_name || '').trim();
        if (!version || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_MEDIA_RUNTIME_ARCHIVE_BYTES) {
          throw new Error('官方发行包信息异常，已停止安装');
        }
        return {
          version,
          assetName: asset.name,
          source: release.html_url,
          sha256,
          size: asset.size,
          downloadUrl: asset.browser_download_url,
        } satisfies MediaRuntimeInstallPlan;
      },
      activeStatus: (selectedRuntime) => this.readManifest(selectedRuntime),
      createWorkspace: async (selectedRuntime) => {
        const root = await mkdtemp(join(tmpdir(), 'winbox-media-'));
        const runtimeRoot = join(mediaRuntimesDir(), selectedRuntime);
        return {
          root,
          archivePath: join(root, selectedRuntime === 'mpv' ? 'mpv.7z' : 'ffmpeg.zip'),
          extractedRoot: join(root, 'extracted'),
          runtimeRoot,
          versionsDirectory: join(runtimeRoot, 'versions'),
        } satisfies MediaRuntimeInstallWorkspace;
      },
      download: async (plan, destination, signal, onProgress) => {
        await downloadVerifiedMediaRuntime({
          url: plan.downloadUrl,
          destination,
          expectedBytes: plan.size,
          expectedSha256: plan.sha256,
          signal,
          onProgress,
        }, this.downloadPort);
      },
      extract: async (workspace, signal) => {
        await mkdir(workspace.extractedRoot, { recursive: true });
        await this.extract(workspace.archivePath, workspace.root, workspace.extractedRoot, signal);
        await enforceMediaRuntimeExpansionBudgetAsync(workspace.extractedRoot, asyncRuntimeTreeFilesystem, signal);
      },
      findRuntimeFiles: (selectedRuntime, workspace) => this.findRuntimeFiles(selectedRuntime, workspace.extractedRoot),
      validateRuntimeFiles: async (selectedRuntime, files) => {
        if (!(await isWindowsX64Pe(files.executable))) throw new Error('发行包中的程序不是 Windows x64 可执行文件');
        if (selectedRuntime === 'ffmpeg' && (!files.probe || !(await isWindowsX64Pe(files.probe)))) {
          throw new Error('发行包中的 ffprobe 不是 Windows x64 可执行文件');
        }
      },
      prepareVersion: async (selectedRuntime, plan, files, workspace, signal) => {
        const appRoot = realpathSync(userDataDir());
        const safeRuntimeRoot = await ensureContainedDirectory(appRoot, join(appRoot, 'media-runtimes', selectedRuntime));
        const safeVersionsDirectory = await ensureContainedDirectory(safeRuntimeRoot, join(safeRuntimeRoot, 'versions'));
        const slug = safeSlug(plan.version.slice(0, 48) + '-' + plan.sha256.slice(0, 16) + '-' + Date.now().toString(36));
        const installDirectory = join(safeVersionsDirectory, slug);
        const stageDirectory = await mkdtemp(join(safeVersionsDirectory, '.install-'));
        let prepared: { directory: string; executablePath?: string; manifest: RuntimeManifest } | null = null;
        let preparationError: unknown;
        let versionDirectoryCreated = false;
        try {
          await copyRegularTree(files.directory, stageDirectory, signal);
          await copyLicenseFiles(workspace.extractedRoot, join(stageDirectory, 'licenses'), signal);
          this.throwIfCanceled(signal);
          await rename(stageDirectory, installDirectory);
          versionDirectoryCreated = true;
          const relativeExecutable = selectedRuntime === 'mpv' ? relative(files.directory, files.executable) : undefined;
          const manifest: RuntimeManifest = {
            version: plan.version,
            assetName: plan.assetName,
            sha256: plan.sha256,
            source: plan.source,
            ...(selectedRuntime === 'ffmpeg' ? { relativeBinDir: toPosixPath(join('versions', slug)) } : {}),
            ...(relativeExecutable ? { relativeExecutable: toPosixPath(join('versions', slug, relativeExecutable)) } : {}),
          };
          prepared = {
            directory: installDirectory,
            ...(relativeExecutable ? { executablePath: join(installDirectory, ...toPosixPath(relativeExecutable).split('/')) } : {}),
            manifest,
          };
        } catch (error) {
          preparationError = error;
        }
        const cleanupErrors: string[] = [];
        try { await this.removeContainedPath(stageDirectory); }
        catch (cleanupError) { cleanupErrors.push(`媒体组件暂存文件清理失败，可能残留：${stageDirectory}（${errorText(cleanupError)}）`); }
        if (preparationError && versionDirectoryCreated && !prepared) {
          try { await this.removeContainedPath(installDirectory); }
          catch (cleanupError) { cleanupErrors.push(`未激活版本清理失败，可能残留：${installDirectory}（${errorText(cleanupError)}）`); }
        }
        if (cleanupErrors.length) {
          const message = [...(preparationError ? [errorText(preparationError)] : []), ...cleanupErrors].join('；');
          this.log.w(message);
          throw new Error(message, preparationError ? { cause: preparationError } : undefined);
        }
        if (preparationError) throw preparationError;
        if (!prepared) throw new Error('媒体组件暂存目录未能生成');
        return prepared;
      },
      commitActive: async (selectedRuntime, manifest) => {
        const appRoot = realpathSync(userDataDir());
        const safeRuntimeRoot = await ensureContainedDirectory(appRoot, join(appRoot, 'media-runtimes', selectedRuntime));
        await writeManifestAtomically(safeRuntimeRoot, manifest);
      },
      setPreferredPlayerPath: (path) => { playerSettings.update({ mpvPath: path }); },
      cleanupOldVersions: (selectedRuntime, keepDirectory) => this.cleanupOldVersions(selectedRuntime, keepDirectory),
      removePath: (path) => this.removeContainedPath(path),
      status: () => this.status(),
      emit: (event) => {
        try { this.progress?.(event); } catch { /* UI may have closed */ }
      },
      info: (message) => this.log.i(message),
      warn: (message) => this.log.w(message),
    });
    try {
      return await workflow.install(runtime, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        const message = errorText(error);
        this.emit(runtime, 'canceled', 0, 0, message);
        if (message.includes('清理失败') || message.includes('残留')) throw error;
        throw error instanceof Error && message.includes('取消') ? error : new Error('已取消下载');
      }
      throw error;
    } finally {
      this.controller = null;
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

  private async extract(archivePath: string, tempRoot: string, extractedRoot: string, signal: AbortSignal): Promise<void> {
    const require = createRequire(join(distDir(), 'main.cjs'));
    const modulePath = require.resolve('7z-wasm');
    const worker = new Worker(SEVEN_ZIP_WORKER, {
      eval: true,
      name: 'winbox-media-extract',
      workerData: { modulePath, tempRoot: resolve(tempRoot), archivePath, extractedRoot, maxListingBytes: MAX_MEDIA_RUNTIME_LISTING_BYTES },
    });
    const workerPort: MediaRuntimeArchiveWorkerPort = {
      listenMessages: (listener) => { worker.on('message', listener); },
      removeMessages: (listener) => { worker.off('message', listener); },
      listenError: (listener) => { worker.on('error', listener); },
      removeError: (listener) => { worker.off('error', listener); },
      listenExit: (listener) => { worker.on('exit', listener); },
      removeExit: (listener) => { worker.off('exit', listener); },
      send: (message) => { worker.postMessage(message); },
      terminate: () => worker.terminate(),
    };
    await runMediaRuntimeArchiveWorker(workerPort, signal, validateMediaRuntimeArchiveListing);
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
    try {
      const appRoot = realpathSync(userDataDir());
      const runtimeRoot = resolveContainedRealPath(appRoot, join(appRoot, 'media-runtimes', runtime), runtimeTreeFilesystem);
      const versionsRoot = resolveContainedRealPath(appRoot, join(runtimeRoot, 'versions'), runtimeTreeFilesystem);
      const activePath = resolveContainedRealPath(appRoot, join(runtimeRoot, 'active.json'), runtimeTreeFilesystem);
      if (!lstatSync(activePath).isFile()) return { installed: false };
      const value = JSON.parse(readFileSync(activePath, 'utf8')) as RuntimeManifest;
      if (!isValidManifest(value)) return { installed: false };

      if (runtime === 'mpv' && value.relativeExecutable && isSafeRelative(value.relativeExecutable)) {
        const candidate = join(runtimeRoot, ...value.relativeExecutable.split(/[\\/]/));
        const executable = resolveContainedRealPath(appRoot, candidate, runtimeTreeFilesystem);
        const info = lstatSync(executable);
        if (isPathWithin(versionsRoot, executable) && info.isFile() && basename(executable).toLowerCase() === 'mpv.exe') {
          return { installed: true, version: value.version, path: executable, sha256: value.sha256, assetName: value.assetName };
        }
      }
      if (runtime === 'ffmpeg' && value.relativeBinDir && isSafeRelative(value.relativeBinDir)) {
        const candidate = join(runtimeRoot, ...value.relativeBinDir.split(/[\\/]/));
        const binDir = resolveContainedRealPath(appRoot, candidate, runtimeTreeFilesystem);
        if (!isPathWithin(versionsRoot, binDir) || !lstatSync(binDir).isDirectory()) return { installed: false };
        const ffmpeg = resolveContainedRealPath(appRoot, join(binDir, 'ffmpeg.exe'), runtimeTreeFilesystem);
        const ffprobe = resolveContainedRealPath(appRoot, join(binDir, 'ffprobe.exe'), runtimeTreeFilesystem);
        if (isPathWithin(versionsRoot, ffmpeg) && isPathWithin(versionsRoot, ffprobe) && lstatSync(ffmpeg).isFile() && lstatSync(ffprobe).isFile()) {
          return { installed: true, version: value.version, path: binDir, sha256: value.sha256, assetName: value.assetName };
        }
      }
    } catch { /* not installed or metadata damaged */ }
    return { installed: false };
  }

  private cleanupOldVersions(runtime: MediaRuntimeId, keep: string): string[] {
    const warnings: string[] = [];
    try {
      const appRoot = realpathSync(userDataDir());
      const runtimeRoot = join(appRoot, 'media-runtimes', runtime);
      const versionsDirectory = join(runtimeRoot, 'versions');
      assertNoReparsePointPrefix(appRoot, versionsDirectory, runtimeTreeFilesystem);
      const safeVersionsDirectory = resolveContainedRealPath(appRoot, versionsDirectory, runtimeTreeFilesystem);
      const keepDirectory = resolve(keep);
      const staleInstallAgeMs = 24 * 60 * 60 * 1000;
      for (const entry of readdirSync(safeVersionsDirectory, { withFileTypes: true })) {
        const candidate = join(safeVersionsDirectory, entry.name);
        if (isPathWithin(candidate, keepDirectory) && isPathWithin(keepDirectory, candidate)) continue;
        if (entry.isSymbolicLink()) {
          warnings.push(`跳过包含符号链接或 Windows reparse point 的旧版本：${candidate}`);
          continue;
        }
        if (!entry.isDirectory()) continue;
        try {
          assertNoReparsePointPrefix(appRoot, candidate, runtimeTreeFilesystem);
          const safeCandidate = resolveContainedRealPath(appRoot, candidate, runtimeTreeFilesystem);
          if (entry.name.startsWith('.install-')) {
            const info = lstatSync(safeCandidate);
            if (info.mtimeMs !== undefined && Date.now() - info.mtimeMs < staleInstallAgeMs) continue;
          }
          removeTreeWithoutFollowingLinks(safeCandidate, appRoot);
          if (pathExists(safeCandidate)) throw new Error('删除后目录仍然存在');
        } catch (error) {
          warnings.push(`旧媒体组件清理失败，残留路径：${candidate}（${errorText(error)}）`);
        }
      }
    } catch (error) {
      warnings.push(`旧媒体组件清理失败：${errorText(error)}`);
    }
    return warnings;
  }

  private async removeContainedPath(path: string): Promise<void> {
    const candidate = resolve(path);
    const appRoot = realpathSync(userDataDir());
    const mediaRuntimeRoot = join(appRoot, 'media-runtimes');
    const temporaryRoot = realpathSync(tmpdir());
    const isRuntimeAsset = isPathWithin(mediaRuntimeRoot, candidate) && candidate !== resolve(mediaRuntimeRoot);
    const temporaryRelative = relative(temporaryRoot, candidate);
    const isInstallerWorkspace = !temporaryRelative.includes(sep)
      && temporaryRelative !== ''
      && basename(candidate).startsWith('winbox-media-');
    const trustedRoot = isRuntimeAsset ? appRoot : isInstallerWorkspace ? temporaryRoot : null;
    if (!trustedRoot) throw new Error(`拒绝清理应用数据目录和临时目录之外的路径：${candidate}`);
    assertNoReparsePointPrefix(trustedRoot, candidate, runtimeTreeFilesystem);
    if (!pathExists(candidate)) return;
    const safeCandidate = resolveContainedRealPath(trustedRoot, candidate, runtimeTreeFilesystem);
    removeTreeWithoutFollowingLinks(safeCandidate, trustedRoot);
    if (pathExists(safeCandidate)) throw new Error(`清理后仍有文件残留：${safeCandidate}`);
  }

  private throwIfCanceled(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('已取消下载');
  }
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if (isMissingPathError(error)) return false; throw error; }
}

async function ensureContainedDirectory(trustedRoot: string, target: string): Promise<string> {
  const root = realpathSync(trustedRoot);
  const absoluteTarget = resolve(target);
  if (!isPathWithin(root, absoluteTarget)) throw new Error('媒体组件目录越出应用数据目录');
  let current = root;
  for (const part of relative(root, absoluteTarget).split(sep).filter(Boolean)) {
    current = join(current, part);
    assertNoReparsePointPrefix(root, current, runtimeTreeFilesystem);
    try { await mkdir(current); }
    catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    current = resolveContainedRealPath(root, current, runtimeTreeFilesystem);
    if (!lstatSync(current).isDirectory()) throw new Error(`媒体组件路径不是目录：${current}`);
  }
  return current;
}

function isSafeRelative(value: string): boolean {
  if (!value || value.includes('\0') || value.startsWith('/') || value.startsWith('\\') || /^[a-z]:/i.test(value)) return false;
  const parts = value.split(/[\\/]/);
  return parts.every((part) => !!part && part !== '.' && part !== '..' && !part.includes(':'));
}

function isValidManifest(value: RuntimeManifest): boolean {
  return !!value && typeof value === 'object'
    && typeof value.version === 'string' && !!value.version
    && typeof value.assetName === 'string' && !!value.assetName
    && typeof value.source === 'string' && !!value.source
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(value.sha256);
}

function isMissingPathError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'EEXIST';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Recursively remove entries without ever traversing a symlink or junction target. */
function removeTreeWithoutFollowingLinks(path: string, trustedRoot: string): void {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    // rmSync without recursive removes the link itself; it does not visit its target.
    rmSync(path, { force: true });
    return;
  }
  if (!info.isDirectory()) {
    rmSync(path, { force: true });
    return;
  }
  const actualDirectory = realpathSync(path);
  if (!isPathWithin(trustedRoot, actualDirectory)) throw new Error(`拒绝跟随越界的目录重解析点：${path}`);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (!isPathWithin(path, child) || resolve(child) === resolve(path)) throw new Error(`拒绝清理目录之外的路径：${child}`);
    removeTreeWithoutFollowingLinks(child, trustedRoot);
  }
  rmdirSync(path);
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

async function copyRegularTree(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('已取消下载');
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (signal?.aborted) throw new Error('已取消下载');
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await copyRegularTree(from, to, signal);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function copyLicenseFiles(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  let copied = 0;
  const walk = async (dir: string): Promise<void> => {
    if (signal?.aborted) throw new Error('已取消下载');
    if (copied >= 24) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (signal?.aborted) throw new Error('已取消下载');
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
  const temporaryManifest = join(root, `.active-${randomUUID()}.json`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryManifest, 'wx');
    await handle.writeFile(JSON.stringify(manifest, null, 2), 'utf8');
    await handle.close();
    handle = null;
    await rename(temporaryManifest, target);
  } catch (error) {
    const cleanupErrors: string[] = [];
    if (handle) {
      try { await handle.close(); }
      catch (cleanupError) { cleanupErrors.push(`文件句柄关闭失败：${errorText(cleanupError)}`); }
    }
    try { await rm(temporaryManifest, { force: true }); }
    catch (cleanupError) {
      if (!isMissingPathError(cleanupError)) cleanupErrors.push(`active manifest 暂存文件清理失败，可能残留：${temporaryManifest}（${errorText(cleanupError)}）`);
    }
    if (cleanupErrors.length) throw new Error(`${errorText(error)}；${cleanupErrors.join('；')}`, { cause: error });
    throw error;
  }
}
