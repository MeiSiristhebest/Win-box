import { describe, expect, it, vi } from 'vitest';
import type { MediaRuntimeProgress, MediaRuntimeStatus } from '../src/shared/player';
import { downloadVerifiedMediaRuntime, type MediaRuntimeDownloadPort } from '../src/main/player/mediaRuntimeDownload';
import {
  MediaRuntimeInstallWorkflow,
  type MediaRuntimeInstallManifest,
  type MediaRuntimeInstallPlan,
  type MediaRuntimeInstallPorts,
} from '../src/main/player/mediaRuntimeInstallWorkflow';

const oldManifest: MediaRuntimeInstallManifest = {
  version: 'old',
  assetName: 'mpv-old.7z',
  sha256: 'a'.repeat(64),
  source: 'https://github.com/example/old',
  relativeExecutable: 'versions/old/mpv.exe',
};

const newManifest: MediaRuntimeInstallManifest = {
  version: 'new',
  assetName: 'mpv-new.7z',
  sha256: 'b'.repeat(64),
  source: 'https://github.com/example/new',
  relativeExecutable: 'versions/new/mpv.exe',
};

function createPorts(options: {
  failCommit?: boolean;
  failDownload?: string;
  failExtract?: boolean;
  failSetting?: boolean;
  sameDigest?: boolean;
  failRemovePath?: string;
  oldVersionCleanupWarnings?: string[];
  failOldVersionCleanup?: boolean;
  cancelDuringExtract?: AbortController;
  cancelDuringDownload?: AbortController;
  progress?: MediaRuntimeProgress[];
} = {}) {
  let activeManifest = oldManifest;
  const removed: string[] = [];
  const warnings: string[] = [];
  const workspace = {
    root: 'temp/workspace',
    archivePath: 'temp/workspace/mpv.7z',
    extractedRoot: 'temp/workspace/extracted',
    runtimeRoot: 'data/mpv',
    versionsDirectory: 'data/mpv/versions',
  };
  const ports: MediaRuntimeInstallPorts = {
    resolvePlan: vi.fn(async () => ({
      version: 'new',
      assetName: 'mpv-new.7z',
      source: 'https://github.com/example/new',
      sha256: options.sameDigest ? oldManifest.sha256 : newManifest.sha256,
      size: 3,
      downloadUrl: 'https://github.com/example/mpv-new.7z',
    })),
    activeStatus: vi.fn(() => ({
      installed: true,
      path: activeManifest.relativeExecutable ? 'data/mpv/' + activeManifest.relativeExecutable : undefined,
      sha256: activeManifest.sha256,
      version: activeManifest.version,
      assetName: activeManifest.assetName,
    })),
    createWorkspace: vi.fn(async () => workspace),
    download: vi.fn(async (_plan, _destination, signal, onProgress) => {
      if (options.failDownload) throw new Error(options.failDownload);
      if (options.cancelDuringDownload) {
        options.cancelDuringDownload.abort();
        if (signal.aborted) throw new Error('download aborted');
      }
      onProgress(3, 3);
    }),
    extract: vi.fn(async (_workspace, signal) => {
      if (options.cancelDuringExtract) options.cancelDuringExtract.abort();
      if (signal.aborted) return;
      if (options.failExtract) throw new Error('archive failed');
    }),
    findRuntimeFiles: vi.fn(async () => ({ executable: 'temp/workspace/extracted/mpv.exe', directory: 'temp/workspace/extracted' })),
    validateRuntimeFiles: vi.fn(async () => undefined),
    prepareVersion: vi.fn(async () => ({
      directory: 'data/mpv/versions/new',
      executablePath: 'data/mpv/versions/new/mpv.exe',
      manifest: newManifest,
    })),
    commitActive: vi.fn(async (_runtime, manifest) => {
      if (options.failCommit) throw new Error('manifest write failed');
      activeManifest = manifest;
    }),
    setPreferredPlayerPath: vi.fn(() => { if (options.failSetting) throw new Error('settings disk full'); }),
    cleanupOldVersions: vi.fn(() => {
      if (options.failOldVersionCleanup) throw new Error('versions directory is busy');
      return options.oldVersionCleanupWarnings ?? [];
    }),
    removePath: vi.fn(async (path) => {
      removed.push(path);
      if (path === options.failRemovePath) throw new Error('access denied');
    }),
    status: vi.fn((): MediaRuntimeStatus => ({
      mpv: {
        installed: true,
        path: activeManifest.relativeExecutable ? 'data/mpv/' + activeManifest.relativeExecutable : undefined,
        version: activeManifest.version,
        sha256: activeManifest.sha256,
        assetName: activeManifest.assetName,
      },
      ffmpeg: { installed: false },
    })),
    emit: vi.fn((event) => options.progress?.push(event)),
    info: vi.fn(),
    warn: vi.fn((message) => warnings.push(message)),
  };
  return { ports, removed, warnings, workspace, getActiveManifest: () => activeManifest };
}

describe('MediaRuntimeInstallWorkflow', () => {
  it('preserves the active runtime when official release metadata cannot be read', async () => {
    const { ports, removed, getActiveManifest } = createPorts();
    vi.mocked(ports.resolvePlan).mockRejectedValueOnce(new Error('release metadata timeout'));
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).rejects.toThrow('release metadata timeout');

    expect(getActiveManifest()).toBe(oldManifest);
    expect(ports.createWorkspace).not.toHaveBeenCalled();
    expect(ports.download).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
  });

  it('keeps the previous active manifest and removes new files when manifest commit fails', async () => {
    const { ports, removed, getActiveManifest, workspace } = createPorts({ failCommit: true });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).rejects.toThrow('manifest write failed');

    expect(getActiveManifest()).toBe(oldManifest);
    expect(removed).toEqual(['data/mpv/versions/new', workspace.root]);
    expect(ports.cleanupOldVersions).not.toHaveBeenCalled();
  });

  it('keeps the already active version after a repeated upgrade cannot commit its manifest', async () => {
    const { ports, removed, getActiveManifest, workspace } = createPorts();
    const workflow = new MediaRuntimeInstallWorkflow(ports);
    await workflow.install('mpv', new AbortController().signal);
    expect(getActiveManifest()).toBe(newManifest);

    const nextManifest: MediaRuntimeInstallManifest = {
      ...newManifest,
      version: 'newer',
      assetName: 'mpv-newer.7z',
      sha256: 'c'.repeat(64),
      relativeExecutable: 'versions/newer/mpv.exe',
    };
    vi.mocked(ports.resolvePlan).mockResolvedValueOnce({
      version: nextManifest.version,
      assetName: nextManifest.assetName,
      source: nextManifest.source,
      sha256: nextManifest.sha256,
      size: 4,
      downloadUrl: 'https://github.com/example/mpv-newer.7z',
    });
    vi.mocked(ports.prepareVersion).mockResolvedValueOnce({
      directory: 'data/mpv/versions/newer',
      executablePath: 'data/mpv/versions/newer/mpv.exe',
      manifest: nextManifest,
    });
    vi.mocked(ports.commitActive).mockRejectedValueOnce(new Error('manifest write failed'));

    await expect(workflow.install('mpv', new AbortController().signal)).rejects.toThrow('manifest write failed');

    expect(getActiveManifest()).toBe(newManifest);
    expect(ports.activeStatus).toHaveBeenLastCalledWith('mpv');
    expect(ports.cleanupOldVersions).toHaveBeenCalledOnce();
    expect(removed).toEqual([
      workspace.root,
      'data/mpv/versions/newer',
      workspace.root,
    ]);
  });

  it.each([
    ['a stalled download deadline', '下载超过总时限，已停止并清理临时文件'],
    ['an oversized response', '下载响应超过官方记录的文件大小'],
  ])('preserves the old active runtime after %s', async (_scenario, failure) => {
    const { ports, removed, getActiveManifest, workspace } = createPorts({ failDownload: failure });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).rejects.toThrow(failure);

    expect(getActiveManifest()).toBe(oldManifest);
    expect(ports.extract).not.toHaveBeenCalled();
    expect(ports.commitActive).not.toHaveBeenCalled();
    expect(removed).toEqual([workspace.root]);
  });

  it.each([
    ['a stalled real response body', '下载超过总时限'],
    ['an oversized real response body', '下载响应超过官方记录的文件大小'],
  ])('keeps the previous active runtime and cleans the workspace after %s', async (scenario, failure) => {
    const { ports, removed, getActiveManifest, workspace } = createPorts();
    const body = scenario === 'a stalled real response body'
      ? new ReadableStream<Uint8Array>({ start() {} })
      : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
          controller.close();
        },
      });
    const downloadPort: MediaRuntimeDownloadPort = {
      request: vi.fn(async () => new Response(body)),
      writeResponseBody: async (stream, _destination, signal, inspectChunk) => {
        const reader = stream.getReader();
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(signal.reason ?? new Error('download aborted'));
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          for (;;) {
            const next = await Promise.race([reader.read(), aborted]);
            if (next.done) return;
            inspectChunk(next.value);
          }
        } catch (error) {
          await reader.cancel(error).catch(() => undefined);
          throw error;
        } finally {
          if (onAbort) signal.removeEventListener('abort', onAbort);
          reader.releaseLock();
        }
      },
    };
    vi.mocked(ports.download).mockImplementation((plan, destination, signal) => downloadVerifiedMediaRuntime({
      url: plan.downloadUrl,
      destination,
      expectedBytes: plan.size,
      expectedSha256: plan.sha256,
      signal,
      timeoutMs: 5,
    }, downloadPort));
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).rejects.toThrow(failure);

    expect(getActiveManifest()).toBe(oldManifest);
    expect(ports.extract).not.toHaveBeenCalled();
    expect(ports.commitActive).not.toHaveBeenCalled();
    expect(removed).toEqual([workspace.root]);
  });

  it('cleans the temporary workspace and leaves the old version active when extraction fails', async () => {
    const { ports, removed, getActiveManifest, workspace } = createPorts({ failExtract: true });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).rejects.toThrow('archive failed');

    expect(getActiveManifest()).toBe(oldManifest);
    expect(removed).toEqual([workspace.root]);
    expect(ports.commitActive).not.toHaveBeenCalled();
  });

  it('cancels between extraction and commit, preserving the old active version', async () => {
    const controller = new AbortController();
    const { ports, removed, getActiveManifest, workspace } = createPorts({ cancelDuringExtract: controller });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', controller.signal)).rejects.toThrow('已取消下载');

    expect(getActiveManifest()).toBe(oldManifest);
    expect(removed).toEqual([workspace.root]);
    expect(ports.prepareVersion).not.toHaveBeenCalled();
    expect(ports.commitActive).not.toHaveBeenCalled();
  });

  it('cancels an in-flight download and cleans its workspace without replacing the old runtime', async () => {
    const controller = new AbortController();
    const { ports, removed, getActiveManifest, workspace } = createPorts({ cancelDuringDownload: controller });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', controller.signal)).rejects.toThrow('已取消下载');

    expect(getActiveManifest()).toBe(oldManifest);
    expect(ports.extract).not.toHaveBeenCalled();
    expect(ports.commitActive).not.toHaveBeenCalled();
    expect(removed).toEqual([workspace.root]);
  });

  it('rejects a second install while the first transaction is resolving its release plan', async () => {
    const { ports, getActiveManifest } = createPorts();
    let signalPlanStarted!: () => void;
    let resolvePlan!: (plan: MediaRuntimeInstallPlan) => void;
    const planStarted = new Promise<void>((resolve) => { signalPlanStarted = resolve; });
    vi.mocked(ports.resolvePlan).mockImplementation(() => new Promise((resolve) => {
      resolvePlan = resolve;
      signalPlanStarted();
    }));
    const workflow = new MediaRuntimeInstallWorkflow(ports);
    const first = workflow.install('mpv', new AbortController().signal);

    await planStarted;
    await expect(workflow.install('ffmpeg', new AbortController().signal)).rejects.toThrow('另一个媒体组件正在安装');
    expect(ports.resolvePlan).toHaveBeenCalledOnce();

    resolvePlan({
      version: 'new', assetName: 'mpv-new.7z', source: 'https://github.com/example/new',
      sha256: newManifest.sha256, size: 3, downloadUrl: 'https://github.com/example/mpv-new.7z',
    });
    await expect(first).resolves.toBeDefined();
    expect(getActiveManifest()).toBe(newManifest);
  });

  it('treats player preference persistence as a warning after runtime activation', async () => {
    const progress: MediaRuntimeProgress[] = [];
    const { ports, warnings, removed, getActiveManifest, workspace } = createPorts({ failSetting: true, progress });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).resolves.toBeDefined();

    expect(getActiveManifest()).toBe(newManifest);
    expect(warnings).toHaveLength(1);
    expect(progress.at(-1)?.message).toContain('播放器路径未自动保存');
    expect(removed).toEqual([workspace.root]);
    expect(ports.cleanupOldVersions).toHaveBeenCalledOnce();
  });

  it('surfaces workspace cleanup failure and the possible residual path on a failed install', async () => {
    const workspace = {
      root: 'temp/workspace',
      archivePath: 'temp/workspace/mpv.7z',
      extractedRoot: 'temp/workspace/extracted',
      runtimeRoot: 'data/mpv',
      versionsDirectory: 'data/mpv/versions',
    };
    const { ports, removed, getActiveManifest } = createPorts({ failCommit: true, failRemovePath: workspace.root });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal))
      .rejects.toThrow('安装临时目录清理失败，可能残留：temp/workspace');

    expect(getActiveManifest()).toBe(oldManifest);
    expect(removed).toEqual(['data/mpv/versions/new', workspace.root]);
    expect(ports.warn).toHaveBeenCalledWith(expect.stringContaining('temp/workspace'));
  });

  it('returns and emits old-version cleanup warnings instead of reporting a clean install', async () => {
    const progress: MediaRuntimeProgress[] = [];
    const { ports, warnings } = createPorts({
      oldVersionCleanupWarnings: ['旧媒体组件清理失败，残留路径：data/mpv/versions/old'],
      progress,
    });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    const result = await workflow.install('mpv', new AbortController().signal);

    expect(result.warnings).toEqual(['旧媒体组件清理失败，残留路径：data/mpv/versions/old']);
    expect(progress.at(-1)?.message).toContain('残留路径');
    expect(warnings).toContain('旧媒体组件清理失败，残留路径：data/mpv/versions/old');
  });

  it('surfaces a thrown old-version cleanup failure after activation', async () => {
    const progress: MediaRuntimeProgress[] = [];
    const { ports } = createPorts({ failOldVersionCleanup: true, progress });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    const result = await workflow.install('mpv', new AbortController().signal);

    expect(result.mpv.sha256).toBe(newManifest.sha256);
    expect(result.warnings?.[0]).toContain('versions directory is busy');
    expect(progress.at(-1)?.message).toContain('versions directory is busy');
  });

  it('skips staging and downloading when the verified runtime is already active', async () => {
    const { ports } = createPorts({ sameDigest: true });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    await expect(workflow.install('mpv', new AbortController().signal)).resolves.toBeDefined();

    expect(ports.createWorkspace).not.toHaveBeenCalled();
    expect(ports.download).not.toHaveBeenCalled();
    expect(ports.setPreferredPlayerPath).toHaveBeenCalledWith('data/mpv/versions/old/mpv.exe');
  });

  it('returns preference warnings when the verified runtime is already active', async () => {
    const { ports } = createPorts({ sameDigest: true, failSetting: true });
    const workflow = new MediaRuntimeInstallWorkflow(ports);

    const result = await workflow.install('mpv', new AbortController().signal);

    expect(result.warnings).toEqual(['MPV 已安装，但播放器路径未自动保存，请在设置中手动指定']);
  });
});
