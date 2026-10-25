import { IPC } from '../../shared/ipc-channels';
import type { Logger } from '../../shared/types';
import type { DanmakuAnime, DanmakuCandidate, DanmakuSettings } from '../../shared/danmaku';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned danmaku capability required by the IPC adapter. */
export interface DanmakuIpcPort {
  getSettings(): DanmakuSettings;
  updateSettings(patch: Partial<DanmakuSettings>): DanmakuSettings;
  search(keyword: string, season?: number): Promise<DanmakuAnime[]>;
  episodes(bangumiId: number, animeTitle: string | undefined, source: string): Promise<DanmakuCandidate[]>;
  fetch(episodeId: number, source: string): Promise<string>;
}

export function registerDanmakuIpc(danmaku: DanmakuIpcPort, logger: Logger): void {
  registerHandler(IPC.DANMAKU_GET, () => danmaku.getSettings(), logger);
  registerHandler(IPC.DANMAKU_SET, (_e: unknown, patch: unknown) => danmaku.updateSettings((patch || {}) as Parameters<DanmakuIpcPort['updateSettings']>[0]), logger);
  registerHandler(IPC.DANMAKU_SEARCH, (_e: unknown, name: string, season?: number) =>
    danmaku.search(String(name), Number.isFinite(Number(season)) && Number(season) > 0 ? Number(season) : undefined), logger);
  registerHandler(IPC.DANMAKU_EPISODES, (_e: unknown, bangumiId: number, animeTitle?: string, source?: string) =>
    danmaku.episodes(Number(bangumiId), animeTitle ? String(animeTitle) : undefined, source ? String(source) : ''), logger);
  registerHandler(IPC.DANMAKU_FETCH, (_e: unknown, episodeId: number, source?: string) =>
    danmaku.fetch(Number(episodeId), source ? String(source) : ''), logger);
}
