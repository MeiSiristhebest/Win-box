import type { DanmakuSettings } from '../../../../shared/danmaku';
import type { DanmakuCandidateSearch } from './danmakuSearchWorkflow';

/** Data and search capabilities required by the danmaku controller. */
export interface DanmakuControllerPorts {
  loadSettings(): Promise<DanmakuSettings>;
  saveSettings(settings: DanmakuSettings): Promise<unknown>;
  fetchEpisode(episodeId: number, source: string): Promise<string | null | undefined>;
  searchCandidates: DanmakuCandidateSearch;
  /** ★ 2026-10-25：接收来自 9978 局域网/手机端推送的实时弹幕 */
  onRealtimeDanmaku?: (handler: (text: string) => void) => () => void;
}
