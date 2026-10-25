import { useState } from 'react';
import PluginSlot from '../components/PluginSlot';
import VideoPlayer from '../components/VideoPlayer';
import { useLivePlayback } from '../features/live/useLivePlayback';
import { livePlaybackDependencies } from '../features/live/adapters/livePlaybackAdapters';
import { liveExportAdapter } from '../features/live/adapters/liveExportAdapter';
import { useLiveExportPresenter } from '../features/live/useLiveExportPresenter';
import { SelectionButton } from '../components/ui/SelectionButton';

export default function LivePage() {
  const {
    profileId, lives, liveIdx, groups, groupName, channelName, lineIdx, playUrl,
    loading, err, liveName, curGroup, curChannel, curEpg, lines, liveToast,
    isCatchupActive, catchupTitle, playCatchup, exitCatchup, failoverToNextLine,
    pickLive, pickChannel,
  } = useLivePlayback(livePlaybackDependencies);
  const [showSchedule, setShowSchedule] = useState(false);
  const exportKey = JSON.stringify([profileId, liveIdx, liveName]);
  const liveExport = useLiveExportPresenter(exportKey, liveExportAdapter);


  return (
    <>
      <div className="topbar">
        <select aria-label="直播线路" value={liveIdx} onChange={(e) => pickLive(Number(e.target.value))} disabled={loading}>
          {lives.map((l, i) => <option key={i} value={i}>{l.name}</option>)}
        </select>
        {/* ★ 2026-10-18 导出当前线路（输出格式由模板决定：内置 2 个 + 插件 `live.template`） */}
        <select aria-label="导出格式" value={liveExport.selectedTemplateId} onChange={(e) => liveExport.selectTemplate(e.target.value)} disabled={loading || !liveExport.templates.length} title="导出格式">
          {liveExport.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button className="linkbtn" disabled={loading || !groups.length} title="把当前线路的频道导出为文件" onClick={() => void liveExport.exportCurrent(groups, liveName)}>导出</button>
        <span className="status" style={{ marginLeft: 'auto' }}>{loading ? '加载中…' : `${groups.length} 组`}</span>
        {liveExport.exportMessage && <span className="muted" style={{ fontSize: 12 }}>{liveExport.exportMessage}</span>}
      </div>
      {/* ★ 2026-10-18 插件受限 UI 槽位（`contributes.ui.slot`；无插件声明时零影响） */}
      <PluginSlot slot="live" />
      <div className="layout-2 content live-page-layout">
        <div className="left">
          <fieldset className="live-choice-group live-group-list">
            <legend>分组</legend>
            {groups.map(group => (
              <SelectionButton
                key={group.group}
                className="live-choice"
                selected={group.group === groupName}
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => pickChannel(group, group.channels[0]?.name ?? '', 0)}
              >
                {group.group} <span className="muted">({group.channels.length})</span>
              </SelectionButton>
            ))}
          </fieldset>
        </div>
        <div className="right">
          {err && <div className="err" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
          {curGroup ? (
            <>
              <fieldset className="live-choice-group live-channel-list">
                <legend>频道</legend>
                {curGroup.channels.map(channel => (
                  <SelectionButton
                    key={channel.name}
                    className="live-choice"
                    selected={channel.name === channelName}
                    onClick={() => pickChannel(curGroup, channel.name, 0)}
                  >
                    {channel.name}
                  </SelectionButton>
                ))}
              </fieldset>
              {lines.length > 1 && (
                <fieldset className="live-choice-group live-line-list">
                  <legend>线路</legend>
                  {lines.map(line => (
                    <SelectionButton
                      key={line.index}
                      className="live-choice"
                      selected={line.index - 1 === lineIdx}
                      onClick={() => pickChannel(curGroup, channelName, line.index - 1)}
                    >
                      {line.name}
                    </SelectionButton>
                  ))}
                </fieldset>
              )}
              {/* ★ 2026-09-29 EPG：当前 / 下一档 / 完整回看节目单 */}
              {curEpg && (curEpg.current || curEpg.next || (curEpg.programs && curEpg.programs.length > 0)) && (
                <div className="live-epg-section">
                  <div className="live-epg">
                    {curEpg.current && (
                      <span className="live-epg-now">
                        <b>正在播</b> {curEpg.current.start}~{curEpg.current.end} {curEpg.current.title || '（无标题）'}
                      </span>
                    )}
                    {curEpg.next && (
                      <span className="muted">
                        <b>下一档</b> {curEpg.next.start} {curEpg.next.title || '（无标题）'}
                      </span>
                    )}
                    {curEpg.programs && curEpg.programs.length > 0 && (
                      <button
                        type="button"
                        className="linkbtn live-schedule-toggle"
                        onClick={() => setShowSchedule(!showSchedule)}
                      >
                        {showSchedule ? '收起节目单' : `全天节目 (${curEpg.programs.length})`}
                      </button>
                    )}
                  </div>
                  {showSchedule && curEpg.programs && (
                    <div className="live-schedule-drawer">
                      {curEpg.programs.map((prog, idx) => {
                        const now = Date.now();
                        const isCurrent = prog.startTime <= now && now <= prog.endTime;
                        const isPast = prog.endTime < now;
                        return (
                          <div key={idx} className={`live-schedule-row ${isCurrent ? 'active' : ''}`}>
                            <span className="live-prog-time">{prog.start}~{prog.end}</span>
                            <span className="live-prog-title" title={prog.title}>{prog.title}</span>
                            {isCurrent && <span className="live-status-tag">直播中</span>}
                            {isPast && curChannel?.catchup && (
                              <button
                                type="button"
                                className="linkbtn live-catchup-action"
                                onClick={() => playCatchup(prog)}
                              >
                                回看
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {isCatchupActive && (
                <div className="live-catchup-bar">
                  <span>⏪ <b>时移回看中</b>：{catchupTitle}</span>
                  <button type="button" className="linkbtn" onClick={exitCatchup}>返回实时直播</button>
                </div>
              )}
              {/* ★ 2026-09-27：播放器必须有「有高度」的 flex 宿主 —— `.vplayer` 的高度只来自 flex（flex:1），
                  直接放进 block 容器 `.right` 会折成 0 高度（用户报「直播界面播放器消失」）。 */}
              {playUrl ? (
                <div className="live-player">
                  {liveToast && <div className="live-hud-toast">{liveToast}</div>}
                  <VideoPlayer
                    url={playUrl}
                    playTitle={isCatchupActive ? `${channelName} - ${catchupTitle}` : channelName}
                    onPlaybackFailure={(_time, reason) => failoverToNextLine(reason)}
                  />
                </div>
              ) : (
                <div className="empty">无播放地址</div>
              )}
            </>
          ) : (
            <div className="empty">{groups.length ? '选择左侧分组' : '无直播（请先导入含 lives 的配置）'}</div>
          )}
        </div>
      </div>
    </>
  );
}
