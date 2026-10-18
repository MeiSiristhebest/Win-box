import type { MpvAudioTrack, MpvSubtitleTrack } from '../../../shared/player';
import type { KeymapView } from '../../../shared/plugin';
import { spdifLabel } from '../../../shared/player';
import type { MpvTechnicalState } from './useMpvTechnicalState';

const KEY_SHORTCUTS: ReadonlyArray<{ keys: string; desc: string }> = [
  { keys: '空格', desc: '播放 / 暂停' },
  { keys: '← / →', desc: '后退 / 前进 5 秒' },
  { keys: '长按 ←', desc: '连续快退' },
  { keys: '长按 →', desc: '临时 1.5 倍速（松开恢复）' },
  { keys: '↑ / ↓', desc: '音量 +5% / −5%' },
  { keys: 'Esc', desc: '退出全屏（原生全屏时）' },
  { keys: '单击画面', desc: '播放 / 暂停' },
  { keys: '双击画面', desc: '全屏 / 退出全屏' },
  { keys: '长按画面', desc: '临时 1.5 倍速' },
  { keys: '右键画面', desc: '播放器菜单（详情信息 / 复制地址）' },
];

export function PlayerTechnicalPanels({ active, statsOpen, keysOpen, mini, mpvTech, audioTracks, subtitles, pluginKeys, fmtNet, onStatsClose, onKeysClose }: { audioTracks: MpvAudioTrack[]; subtitles: MpvSubtitleTrack[]; pluginKeys: KeymapView[]; active: boolean; statsOpen: boolean; keysOpen: boolean; mini: boolean; mpvTech: MpvTechnicalState | null; fmtNet(value: number): string; onStatsClose(): void; onKeysClose(): void }) {
  return <>
      {active && statsOpen && !mini && (
        <div className="vp-stats" onDoubleClick={(e) => e.stopPropagation()}>
          <div className="vp-inf-head">
            <span className="vp-inf-title">播放统计</span>
            <button className="vp-inf-x" type="button" title="关闭" onClick={() => onStatsClose()}>×</button>
          </div>
          <div className="vp-stats-body">
            {(() => {
              if (!mpvTech) return <div className="vp-inf-empty">等待内核上报…</div>;
              const rows: Array<[string, string, string?]> = [];
              rows.push(['解码方式', mpvTech.hwdec ? (mpvTech.hwdec === 'no' ? '软解' : `硬解（${mpvTech.hwdec}）`) : '—']);
              if (mpvTech.w > 0) rows.push(['画面尺寸', `${mpvTech.w} × ${mpvTech.h}`, `${mpvTech.w}×${mpvTech.h}`]);
              rows.push(['画面标准', mpvTech.standard]);
              if (mpvTech.pixelformat) rows.push(['像素格式', mpvTech.pixelformat]);
              if (mpvTech.primaries) rows.push(['原色', mpvTech.primaries]);
              if (mpvTech.gamma) rows.push(['传递函数', mpvTech.gamma]);
              if (mpvTech.light) rows.push(['亮度范围', mpvTech.light]);
              if (mpvTech.sigPeak > 0) rows.push(['信号峰值', mpvTech.sigPeak.toFixed(2).replace(/\.?0+$/, '')]);
              if (mpvTech.vCodec) rows.push(['视频编码', mpvTech.vCodec.toUpperCase()]);
              if (mpvTech.vKbps > 0) rows.push(['视频码率', `${(mpvTech.vKbps / 1000).toFixed(2)} Mbps`]);
              if (mpvTech.fps > 0) rows.push(['帧率', `${mpvTech.fps.toFixed(2).replace(/\.?0+$/, '')} fps`]);
              if (mpvTech.fps > 0) rows.push(['丢帧', String(mpvTech.dropped)]);
              if (mpvTech.aCodec) rows.push(['音频编码', mpvTech.aCodec.toUpperCase()]);
              if (mpvTech.channels || mpvTech.channelCount) {
                rows.push(['声道', [mpvTech.channels, mpvTech.channelCount ? `${mpvTech.channelCount} 声道` : ''].filter(Boolean).join(' · ')]);
              }
              if (mpvTech.samplerate > 0) rows.push(['采样率', `${(mpvTech.samplerate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`]);
              if (mpvTech.aKbps > 0) rows.push(['音频码率', `${(mpvTech.aKbps / 1000).toFixed(2)} Mbps`]);
              rows.push(['音频直通', spdifLabel(mpvTech.spdif), mpvTech.spdif || '关闭']);
              rows.push(['音轨数', String(audioTracks.length)]);
              if (subtitles.length) rows.push(['字幕数', String(subtitles.length)]);
              if (mpvTech.cacheSec != null && mpvTech.cacheSec >= 0) rows.push(['已缓冲', `${mpvTech.cacheSec.toFixed(1)} 秒`]);
              if (mpvTech.speedKbps > 0) rows.push(['下行速度', fmtNet(mpvTech.speedKbps)]);
              return rows.map(([k, v, t]) => (
                <div className="vp-stats-row" key={k}>
                  <span className="vp-stats-k">{k}</span>
                  <span className="vp-stats-v" title={t || v}>{v}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
      {/* ★ 2026-10-17（阶段3b，用户要求）：**MPV 内核专属**「快捷键」中文一览（只读；与实现的键位/手势一一对应） */}
      {active && keysOpen && !mini && (
        <div className="vp-keys" onDoubleClick={(e) => e.stopPropagation()}>
          <div className="vp-inf-head">
            <span className="vp-inf-title">快捷键</span>
            <button className="vp-inf-x" type="button" title="关闭" onClick={() => onKeysClose()}>×</button>
          </div>
          <div className="vp-keys-body">
            {KEY_SHORTCUTS.map((s) => (
              <div className="vp-keys-row" key={s.keys}>
                <kbd className="vp-keys-kbd">{s.keys}</kbd>
                <span className="vp-keys-desc">{s.desc}</span>
              </div>
            ))}
            {/* ★ 2026-10-18 插件快捷键（`contributes.keymap`，scope=player）—— 复用宿主键位行样式 */}
            {pluginKeys.map((k) => (
              <div className="vp-keys-row" key={k.id} title={`来自插件：${k.pluginName}`}>
                <kbd className="vp-keys-kbd">{k.key}</kbd>
                <span className="vp-keys-desc">{k.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

  </>;
}
