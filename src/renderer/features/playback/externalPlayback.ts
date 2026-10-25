import type { MediaKind } from '../../lib/mediaKind';
import type { RecordWatchInput } from '../../lib/uiMemoryTypes';

export interface ExternalPlaybackPreferences {
  vodExternalPlayerEnabled?: boolean;
  vodExternalPlayer?: string;
}

export interface ExternalPlaybackResolution {
  url?: string;
  parse?: number;
  needDriveCookieBind?: string;
}

export interface ExternalPlaybackLaunchResult {
  ok: boolean;
  player?: string;
  error?: string;
}

/** Narrow boundary for external playback. The use case never reaches IPC or browser storage directly. */
export interface ExternalPlaybackPorts {
  getPreferences(): Promise<ExternalPlaybackPreferences | null>;
  getActiveProfileId(): Promise<string>;
  resolvePlayback(input: { key: string; flag: string; id: string; profileId?: string }): Promise<ExternalPlaybackResolution>;
  openExternal(url: string, seek?: number): Promise<ExternalPlaybackLaunchResult>;
  classifyMedia(url: string): MediaKind;
  recordWatch(input: RecordWatchInput): void;
  persistHistory(): void;
}

export type ExternalPlaybackFallbackPort = Pick<ExternalPlaybackPorts, 'getPreferences' | 'openExternal'>;

export interface VodExternalPlayInput {
  key: string;
  profileId?: string;
  flag: string;
  rawUrl: string;
  display: string;
  pic?: string;
  remarks?: string;
  sourceName?: string;
  vodId?: string;
  seek?: number;
}

export interface VodExternalOutcome {
  played: boolean;
  player?: string;
  error?: string;
  fallbackReason?: string;
}

/** Decide whether Win-Box can hand a VOD stream to an external player. */
export async function playVodExternal(
  input: VodExternalPlayInput,
  ports: ExternalPlaybackPorts,
): Promise<VodExternalOutcome> {
  let preferences: ExternalPlaybackPreferences | null;
  try {
    preferences = await ports.getPreferences();
  } catch {
    return { played: false };
  }
  if (!preferences?.vodExternalPlayerEnabled) return { played: false };
  if (!(preferences.vodExternalPlayer || '').trim()) {
    return { played: false, error: '点播外部播放器已启用，但没有配置播放器路径。请在播放设置中重新检测或填写 PotPlayer 路径。' };
  }

  const rawUrl = (input.rawUrl || '').trim();
  if (!rawUrl) return { played: false, fallbackReason: '当前剧集没有可用的播放地址。' };

  let profileId = input.profileId;
  let resolved: ExternalPlaybackResolution;
  try {
    if (profileId === undefined) profileId = await ports.getActiveProfileId().catch(() => '');
    resolved = await ports.resolvePlayback({ key: input.key, flag: input.flag, id: rawUrl, profileId });
  } catch (error) {
    return { played: false, fallbackReason: `Win-Box 无法解析此播放地址：${error instanceof Error ? error.message : String(error)}` };
  }

  const url = (resolved?.url || '').trim();
  if (resolved.needDriveCookieBind) {
    return { played: false, fallbackReason: '此资源需要先在 Win-Box 完成网盘授权，PotPlayer 无法代替应用完成登录。' };
  }
  if (resolved.parse === 1) {
    return { played: false, fallbackReason: '此源需要 Win-Box 的网页解析器处理，当前无法直接交给 PotPlayer。' };
  }
  if (!url) return { played: false, fallbackReason: '此源没有返回可直接播放的地址。' };
  const kind = ports.classifyMedia(url);
  if (kind === 'image' || kind === 'unsupported') {
    return { played: false, fallbackReason: '此源返回的内容不是 PotPlayer 可直接打开的视频地址。' };
  }

  let launch: ExternalPlaybackLaunchResult;
  try {
    launch = await ports.openExternal(url, input.seek);
  } catch (error) {
    return { played: false, error: `启动外部播放器失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (!launch?.ok) return { played: false, error: launch?.error || 'Win-Box 未能启动所选外部播放器。' };

  ports.recordWatch({
    url: rawUrl,
    rawUrl,
    flag: input.flag,
    name: input.display,
    pic: input.pic,
    remarks: input.remarks,
    sourceName: input.sourceName,
    sourceKey: input.key,
    profileId,
    vodId: input.vodId,
  });
  ports.persistHistory();
  return { played: true, player: launch.player };
}

/** Try handing an already-resolved stream to the configured external player after HTML5 fails. */
export async function openConfiguredExternalFallback(
  sourceUrl: string,
  position: number,
  ports: ExternalPlaybackFallbackPort,
): Promise<{ opened: true; player?: string } | { opened: false; error: string } | null> {
  let preferences: ExternalPlaybackPreferences | null;
  try {
    preferences = await ports.getPreferences();
  } catch {
    return null;
  }
  if (!preferences?.vodExternalPlayerEnabled) return null;

  try {
    const result = await ports.openExternal(sourceUrl, position);
    return result?.ok
      ? { opened: true, player: result.player }
      : { opened: false, error: result?.error || '无法启动已配置的外部播放器' };
  } catch (error) {
    return { opened: false, error: error instanceof Error ? error.message : String(error) };
  }
}
