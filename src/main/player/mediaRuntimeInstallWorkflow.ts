import type { MediaRuntimeId, MediaRuntimeProgress, MediaRuntimeStatus } from '../../shared/player';

export interface MediaRuntimeInstallPlan {
  version: string;
  assetName: string;
  source: string;
  sha256: string;
  size: number;
  downloadUrl: string;
}

export interface MediaRuntimeInstallWorkspace {
  root: string;
  archivePath: string;
  extractedRoot: string;
  runtimeRoot: string;
  versionsDirectory: string;
}

export interface MediaRuntimeFiles {
  executable: string;
  probe?: string;
  directory: string;
}

export interface MediaRuntimeInstallManifest {
  version: string;
  assetName: string;
  sha256: string;
  source: string;
  relativeBinDir?: string;
  relativeExecutable?: string;
}

export interface PreparedMediaRuntimeVersion {
  directory: string;
  executablePath?: string;
  manifest: MediaRuntimeInstallManifest;
}

/** Side effects used by the media runtime installation workflow. */
export interface MediaRuntimeInstallPorts {
  resolvePlan(runtime: MediaRuntimeId, signal: AbortSignal): Promise<MediaRuntimeInstallPlan>;
  activeStatus(runtime: MediaRuntimeId): MediaRuntimeStatus['mpv'] | MediaRuntimeStatus['ffmpeg'];
  createWorkspace(runtime: MediaRuntimeId): Promise<MediaRuntimeInstallWorkspace>;
  download(plan: MediaRuntimeInstallPlan, destination: string, signal: AbortSignal, onProgress: (received: number, total: number) => void): Promise<void>;
  extract(workspace: MediaRuntimeInstallWorkspace, signal: AbortSignal): Promise<void>;
  findRuntimeFiles(runtime: MediaRuntimeId, workspace: MediaRuntimeInstallWorkspace): Promise<MediaRuntimeFiles>;
  validateRuntimeFiles(runtime: MediaRuntimeId, files: MediaRuntimeFiles): Promise<void>;
  prepareVersion(runtime: MediaRuntimeId, plan: MediaRuntimeInstallPlan, files: MediaRuntimeFiles, workspace: MediaRuntimeInstallWorkspace, signal: AbortSignal): Promise<PreparedMediaRuntimeVersion>;
  commitActive(runtime: MediaRuntimeId, manifest: MediaRuntimeInstallManifest): Promise<void>;
  setPreferredPlayerPath(path: string): void;
  cleanupOldVersions(runtime: MediaRuntimeId, keepDirectory: string): string[] | void;
  removePath(path: string): Promise<void>;
  status(): MediaRuntimeStatus;
  emit(event: MediaRuntimeProgress): void;
  info(message: string): void;
  warn(message: string): void;
}

/** Coordinates the install transaction; infrastructure remains behind the supplied ports. */
export class MediaRuntimeInstallWorkflow {
  private installing = false;

  constructor(private readonly ports: MediaRuntimeInstallPorts) {}

  async install(runtime: MediaRuntimeId, signal: AbortSignal): Promise<MediaRuntimeStatus> {
    if (this.installing) throw new Error('另一个媒体组件正在安装');
    this.installing = true;
    try {
      return await this.installOne(runtime, signal);
    } finally {
      this.installing = false;
    }
  }

  private async installOne(runtime: MediaRuntimeId, signal: AbortSignal): Promise<MediaRuntimeStatus> {
    let workspace: MediaRuntimeInstallWorkspace | null = null;
    let prepared: PreparedMediaRuntimeVersion | null = null;
    let activeCommitted = false;
    let failure: unknown;
    let status: MediaRuntimeStatus | null = null;
    let completedBytes = 0;
    const warnings: string[] = [];
    try {
      this.emit(runtime, 'resolve', 0, 0, '正在读取官方发行信息');
      const plan = await this.ports.resolvePlan(runtime, signal);
      completedBytes = plan.size;
      const active = this.ports.activeStatus(runtime);
      if (active.installed && active.sha256 === plan.sha256) {
        const warning = this.applyPreferredPath(runtime, active.path);
        const currentStatus = this.ports.status();
        if (warning) currentStatus.warnings = [warning];
        this.emit(runtime, 'complete', plan.size, plan.size, warning ?? '已是当前官方版本');
        return currentStatus;
      }

      this.throwIfCanceled(signal);
      workspace = await this.ports.createWorkspace(runtime);
      await this.ports.download(plan, workspace.archivePath, signal, (received, total) => {
        const label = received === 0 ? '正在从 GitHub 下载 ' + plan.assetName : '正在下载 ' + plan.version;
        this.emit(runtime, 'download', received, total, label);
      });
      this.throwIfCanceled(signal);
      this.emit(runtime, 'verify', plan.size, plan.size, 'SHA-256 校验通过');
      this.emit(runtime, 'extract', plan.size, plan.size, '正在解压到临时目录');
      await this.ports.extract(workspace, signal);
      this.throwIfCanceled(signal);

      const files = await this.ports.findRuntimeFiles(runtime, workspace);
      await this.ports.validateRuntimeFiles(runtime, files);
      this.throwIfCanceled(signal);
      prepared = await this.ports.prepareVersion(runtime, plan, files, workspace, signal);
      this.throwIfCanceled(signal);

      // commitActive must replace active.json atomically. Until this returns, the old manifest stays authoritative.
      await this.ports.commitActive(runtime, prepared.manifest);
      activeCommitted = true;
      const preferenceWarning = this.applyPreferredPath(runtime, prepared.executablePath);
      try {
        const oldVersionWarnings = this.ports.cleanupOldVersions(runtime, prepared.directory);
        if (oldVersionWarnings) warnings.push(...oldVersionWarnings);
      } catch (error) {
        warnings.push('旧媒体组件清理失败：' + errorText(error));
      }
      if (preferenceWarning) warnings.push(preferenceWarning);
      status = this.ports.status();
      this.ports.info('媒体组件已安装：' + runtime + ' ' + plan.version + ' (' + plan.assetName + ')');
    } catch (error) {
      failure = signal.aborted && !errorText(error).includes('清理失败')
        ? new Error('已取消下载', { cause: error })
        : error;
    }

    if (prepared && !activeCommitted) {
      try { await this.ports.removePath(prepared.directory); }
      catch (error) { warnings.push(`新版本暂存目录清理失败，可能残留：${prepared.directory}（${errorText(error)}）`); }
    }
    if (workspace) {
      try { await this.ports.removePath(workspace.root); }
      catch (error) { warnings.push(`安装临时目录清理失败，可能残留：${workspace.root}（${errorText(error)}）`); }
    }

    for (const warning of warnings) this.ports.warn(warning);
    if (failure !== undefined) {
      const detail = [errorText(failure), ...warnings].join('；');
      this.emit(runtime, 'error', 0, 0, detail);
      throw new Error(detail, { cause: failure });
    }

    const result = status ?? this.ports.status();
    if (warnings.length) result.warnings = warnings;
    const completionMessage = warnings.length ? warnings.join('；') : '安装完成';
    this.emit(runtime, 'complete', completedBytes, completedBytes, completionMessage);
    return result;
  }

  private applyPreferredPath(runtime: MediaRuntimeId, path: string | undefined): string | undefined {
    if (runtime !== 'mpv' || !path) return undefined;
    try { this.ports.setPreferredPlayerPath(path); }
    catch {
      // Runtime activation is already durable; a stale preference must not turn a successful install into a false failure.
      return 'MPV 已安装，但播放器路径未自动保存，请在设置中手动指定';
    }
    return undefined;
  }

  private emit(runtime: MediaRuntimeId, phase: MediaRuntimeProgress['phase'], received: number, total: number, message: string): void {
    this.ports.emit({ runtime, phase, received, total, message });
  }

  private throwIfCanceled(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('已取消下载');
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
