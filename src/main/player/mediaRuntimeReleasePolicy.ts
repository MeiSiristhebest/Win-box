import type { MediaRuntimeId } from '../../shared/player';

export interface MediaRuntimeReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}

export interface MediaRuntimeRelease {
  tag_name: string;
  html_url: string;
  assets: MediaRuntimeReleaseAsset[];
}

interface RuntimeReleasePolicy {
  apiUrl: string;
  assetName: RegExp;
  missingAssetMessage: string;
}

const RELEASE_POLICIES: Record<MediaRuntimeId, RuntimeReleasePolicy> = {
  mpv: {
    apiUrl: 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest',
    assetName: /^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$/i,
    missingAssetMessage: '官方发行页没有找到通用 x64 MPV 包',
  },
  ffmpeg: {
    apiUrl: 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest',
    // The built-in compatibility transcoder uses libx264, so LGPL builds are incomplete.
    assetName: /^ffmpeg-n(\d+\.\d+)(?:\.\d+)?-(?:latest|\d+-g[0-9a-f]+)-win64-gpl-shared-\1\.zip$/i,
    missingAssetMessage: '官方发行页没有找到 FFmpeg 稳定版 GPL shared x64 包',
  },
};

export function runtimeReleaseApiUrl(runtime: MediaRuntimeId): string {
  return RELEASE_POLICIES[runtime].apiUrl;
}

/** Picks only a supported Windows x64 upstream asset and rejects non-GitHub source URLs. */
export function selectRuntimeReleaseAsset(
  runtime: MediaRuntimeId,
  release: MediaRuntimeRelease,
): MediaRuntimeReleaseAsset {
  const policy = RELEASE_POLICIES[runtime];
  const asset = release.assets
    .filter((candidate) => policy.assetName.test(candidate.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .at(-1);
  if (!asset) throw new Error(policy.missingAssetMessage);
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('官方发行包下载地址不在 GitHub HTTPS 域名');
  }
  return asset;
}

export function runtimeAssetSha256(asset: MediaRuntimeReleaseAsset): string {
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ''));
  if (!digest) throw new Error('GitHub 未提供该文件的 SHA-256，已停止安装');
  return digest[1].toLowerCase();
}

export function isTrustedRuntimeDownloadRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    const hostAllowed = url.hostname === 'github.com'
      || url.hostname === 'release-assets.githubusercontent.com'
      || url.hostname.endsWith('.githubusercontent.com');
    return url.protocol === 'https:' && hostAllowed;
  } catch {
    return false;
  }
}
