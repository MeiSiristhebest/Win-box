import type { MediaRuntimeId, MediaRuntimeProgress, MediaRuntimeStatus } from '../../shared/player';
import type { Logger } from '../../shared/types';
import {
  nodeMediaRuntimeDownloadPort,
  type MediaRuntimeDownloadPort,
} from './mediaRuntimeDownload';
import { MediaRuntimeInstallWorkflow, type MediaRuntimeInstallPorts } from './mediaRuntimeInstallWorkflow';
import { MediaRuntimeInstallRuntimeAdapter } from './mediaRuntimeInstallRuntimeAdapter';

export interface MediaRuntimeProvisionerDependencies {
  /** Replace the runtime adapter and all download, archive, storage, and settings ports. */
  installPorts?: MediaRuntimeInstallPorts;
  /** Host capability port; production defaults to the actual process platform and architecture. */
  host?: { platform: string; arch: string };
}

/** Public lifecycle boundary for optional media runtime installs. */
export class MediaRuntimeProvisioner {
  private controller: AbortController | null = null;
  private progress: ((event: MediaRuntimeProgress) => void) | null;
  private readonly runtime: MediaRuntimeInstallPorts;
  private readonly workflow: MediaRuntimeInstallWorkflow;
  private readonly host: { platform: string; arch: string };

  constructor(
    log: Logger,
    onProgress?: (event: MediaRuntimeProgress) => void,
    downloadPort: MediaRuntimeDownloadPort = nodeMediaRuntimeDownloadPort,
    dependencies: MediaRuntimeProvisionerDependencies = {},
  ) {
    this.progress = onProgress ?? null;
    this.host = dependencies.host ?? process;
    this.runtime = dependencies.installPorts ?? new MediaRuntimeInstallRuntimeAdapter(log, downloadPort, event => this.emit(event));
    this.workflow = new MediaRuntimeInstallWorkflow(this.runtime);
  }

  setProgressHandler(handler: ((event: MediaRuntimeProgress) => void) | null): void {
    this.progress = handler;
  }

  status(): MediaRuntimeStatus {
    return this.runtime.status();
  }

  cancel(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }

  async install(runtime: MediaRuntimeId): Promise<MediaRuntimeStatus> {
    if (runtime !== 'mpv' && runtime !== 'ffmpeg') throw new Error('不支持的媒体组件');
    if (this.host.platform !== 'win32' || this.host.arch !== 'x64') throw new Error('内置下载目前只支持 Windows 64 位');
    if (this.controller) throw new Error('另一个媒体组件正在安装');
    const controller = new AbortController();
    this.controller = controller;
    try {
      return await this.workflow.install(runtime, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        const message = errorText(error);
        this.emit({ runtime, phase: 'canceled', received: 0, total: 0, message });
        if (message.includes('清理失败') || message.includes('残留')) throw error;
        throw error instanceof Error && message.includes('取消') ? error : new Error('已取消下载');
      }
      throw error;
    } finally {
      this.controller = null;
    }
  }

  private emit(event: MediaRuntimeProgress): void {
    try { this.progress?.(event); } catch { /* UI may have closed */ }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
