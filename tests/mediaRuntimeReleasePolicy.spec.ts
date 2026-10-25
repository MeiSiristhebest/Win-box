import { describe, expect, it } from 'vitest';
import {
  isTrustedRuntimeDownloadRedirect,
  runtimeAssetSha256,
  runtimeReleaseApiUrl,
  selectRuntimeReleaseAsset,
} from '../src/main/player/mediaRuntimeReleasePolicy';

describe('mediaRuntimeReleasePolicy', () => {
  it('selects only the supported MPV Windows x64 upstream asset', () => {
    const selected = selectRuntimeReleaseAsset('mpv', {
      tag_name: 'latest',
      html_url: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases',
      assets: [
        { name: 'mpv-arm64.7z', size: 3, browser_download_url: 'https://github.com/project/mpv-arm64.7z' },
        { name: 'mpv-x86_64-20261023-git-a1b2c3d.7z', size: 5, browser_download_url: 'https://github.com/project/mpv.7z' },
      ],
    });
    expect(selected.name).toBe('mpv-x86_64-20261023-git-a1b2c3d.7z');
    expect(runtimeReleaseApiUrl('mpv')).toBe('https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest');
  });

  it('requires the FFmpeg GPL shared x64 build with a matching major.minor version', () => {
    const selected = selectRuntimeReleaseAsset('ffmpeg', {
      tag_name: 'latest',
      html_url: 'https://github.com/BtbN/FFmpeg-Builds/releases',
      assets: [
        { name: 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip', size: 1, browser_download_url: 'https://github.com/project/ffmpeg-lgpl.zip' },
        { name: 'ffmpeg-n8.1-latest-win64-gpl-shared-8.0.zip', size: 2, browser_download_url: 'https://github.com/project/ffmpeg-wrong.zip' },
        { name: 'ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip', size: 3, browser_download_url: 'https://github.com/project/ffmpeg-gpl.zip' },
      ],
    });
    expect(selected.name).toBe('ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip');
    expect(runtimeReleaseApiUrl('ffmpeg')).toBe('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest');
  });

  it('requires a valid GitHub SHA-256 and accepts only HTTPS upstream asset redirect hosts', () => {
    const digest = 'A'.repeat(64);
    expect(runtimeAssetSha256({ name: 'archive', size: 1, browser_download_url: '', digest: `sha256:${digest}` })).toBe(digest.toLowerCase());
    expect(() => runtimeAssetSha256({ name: 'archive', size: 1, browser_download_url: '' })).toThrow('未提供该文件的 SHA-256');
    expect(isTrustedRuntimeDownloadRedirect('https://release-assets.githubusercontent.com/file.zip')).toBe(true);
    expect(isTrustedRuntimeDownloadRedirect('https://objects.githubusercontent.com/file.zip')).toBe(true);
    expect(isTrustedRuntimeDownloadRedirect('http://release-assets.githubusercontent.com/file.zip')).toBe(false);
    expect(isTrustedRuntimeDownloadRedirect('https://evil.example/file.zip')).toBe(false);
    expect(isTrustedRuntimeDownloadRedirect('not a URL')).toBe(false);
  });

  it('rejects a release that points outside GitHub HTTPS', () => {
    expect(() => selectRuntimeReleaseAsset('mpv', {
      tag_name: 'latest',
      html_url: 'https://github.com/project/releases',
      assets: [{
        name: 'mpv-x86_64-20261023-git-a1b2c3d.7z',
        size: 3,
        browser_download_url: 'https://evil.example/mpv.7z',
      }],
    })).toThrow('GitHub HTTPS');
  });
});
