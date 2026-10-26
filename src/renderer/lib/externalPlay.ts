// src/renderer/lib/externalPlay.ts
// ★ 2026-09-30（用户要求）：**显式绑定第三方播放器时，点播直接由外部播放器播放**（不启动内置播放器窗口）。
//
// 语义（用户原话「不要在内置播放器中跳转第三方播放器，如果在设置中选定了第三方播放器，
//   应直接由第三方播放器播放，不启动内置播放器」）：
//   · ★ 2026-10-08（用户要求「换成勾选项，不要根据路径选择是否启用；就算填了路径，不勾选依旧不使用」）：
//     **总开关为准** = `vodExternalPlayerEnabled` 勾选 **且** `vodExternalPlayer` 路径非空；未勾选 = 一律内置播放器；
//   · 改道前必须先解析出可播地址（`client.play`）—— 解析不出（需网页解析 / 需网盘绑定）时**回退内置播放器**，
//     由内置播放器窗口上屏原因（否则用户只看到「点了没反应」）；
//   · 图集（image）与桌面无载体协议（unsupported）不改道 —— 内置播放器有对应的专用界面与提示。
//
// 历史（用户要求「第三方播放器应也能正常保存历史记录 + 从历史启动要能识别历史播放的位置」）：
//   · 拉起成功后照常 `recordWatch`（**不带 time**：外部播放器无法回传进度，保留上次已知位置而不是归零）；
//   · `seek`（起播秒数）由调用方给出：历史页 = 该条记录的 time；详情页 = 同集已有进度（`uiMemory.sameEpProgress`）。
import { playVodExternal as executeVodExternalPlayback, openConfiguredExternalFallback as executeConfiguredExternalFallback } from '../features/playback/externalPlayback';
import { rendererExternalPlaybackPorts } from '../features/playback/adapters/externalPlaybackAdapter';

export type { VodExternalPlayInput, VodExternalOutcome } from '../features/playback/externalPlayback';

/** Renderer adapter kept at the old import path for callers in the UI layer. */
export function playVodExternal(input: import('../features/playback/externalPlayback').VodExternalPlayInput) {
  return executeVodExternalPlayback(input, rendererExternalPlaybackPorts);
}

/** HTML5 playback failure fallback using the same preference/launch adapter. */
export function openConfiguredExternalFallback(sourceUrl: string, position: number) {
  return executeConfiguredExternalFallback(sourceUrl, position, rendererExternalPlaybackPorts);
}
