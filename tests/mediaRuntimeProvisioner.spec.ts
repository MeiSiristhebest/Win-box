import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/shared/types';
import type { MediaRuntimeProgress, MediaRuntimeStatus } from '../src/shared/player';
import { MediaRuntimeProvisioner } from '../src/main/player/MediaRuntimeProvisioner';
import type { MediaRuntimeInstallPorts } from '../src/main/player/mediaRuntimeInstallWorkflow';

vi.mock('../src/main/player/playerSettings', () => ({ playerSettings: { update: vi.fn() } }));

describe('MediaRuntimeProvisioner', () => {
  it('routes user cancellation through the injected install ports and preserves the active version', async () => {
    const workspace = {
      root: 'temp/workspace',
      archivePath: 'temp/workspace/mpv.7z',
      extractedRoot: 'temp/workspace/extracted',
      runtimeRoot: 'data/mpv',
      versionsDirectory: 'data/mpv/versions',
    };
    const oldManifest = {
      version: 'old',
      assetName: 'mpv-old.7z',
      source: 'https://github.com/example/old',
      sha256: 'a'.repeat(64),
      relativeExecutable: 'versions/old/mpv.exe',
    };
    const activeStatus: MediaRuntimeStatus = {
      mpv: { installed: true, path: 'data/mpv/versions/old/mpv.exe', version: 'old', sha256: oldManifest.sha256, assetName: oldManifest.assetName },
      ffmpeg: { installed: false },
    };
    let notifyDownloadStarted!: () => void;
    const downloadStarted = new Promise<void>(resolve => { notifyDownloadStarted = resolve; });
    const ports: MediaRuntimeInstallPorts = {
      resolvePlan: vi.fn(async () => ({
        version: 'new',
        assetName: 'mpv-new.7z',
        source: 'https://github.com/example/new',
        sha256: 'b'.repeat(64),
        size: 4,
        downloadUrl: 'https://github.com/example/mpv-new.7z',
      })),
      activeStatus: vi.fn(() => activeStatus.mpv),
      createWorkspace: vi.fn(async () => workspace),
      download: vi.fn(async (_plan, _destination, signal) => {
        notifyDownloadStarted();
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }),
      extract: vi.fn(async () => undefined),
      findRuntimeFiles: vi.fn(async () => ({ executable: 'temp/workspace/extracted/mpv.exe', directory: 'temp/workspace/extracted' })),
      validateRuntimeFiles: vi.fn(async () => undefined),
      prepareVersion: vi.fn(async () => ({
        directory: 'data/mpv/versions/new',
        executablePath: 'data/mpv/versions/new/mpv.exe',
        manifest: { ...oldManifest, version: 'new', assetName: 'mpv-new.7z', sha256: 'b'.repeat(64), relativeExecutable: 'versions/new/mpv.exe' },
      })),
      commitActive: vi.fn(async () => undefined),
      setPreferredPlayerPath: vi.fn(),
      cleanupOldVersions: vi.fn(() => undefined),
      removePath: vi.fn(async () => undefined),
      status: vi.fn(() => activeStatus),
      emit: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const progress: MediaRuntimeProgress[] = [];
    const log: Logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
    const provisioner = new MediaRuntimeProvisioner(log, event => progress.push(event), undefined, {
      installPorts: ports,
      host: { platform: 'win32', arch: 'x64' },
    });

    const installation = provisioner.install('mpv');
    await downloadStarted;
    expect(provisioner.cancel()).toBe(true);
    await expect(installation).rejects.toThrow('已取消下载');

    expect(activeStatus.mpv.sha256).toBe(oldManifest.sha256);
    expect(ports.extract).not.toHaveBeenCalled();
    expect(ports.commitActive).not.toHaveBeenCalled();
    expect(ports.removePath).toHaveBeenCalledWith(workspace.root);
    expect(progress.some(event => event.phase === 'canceled')).toBe(true);
    expect(provisioner.cancel()).toBe(false);
  });
});
