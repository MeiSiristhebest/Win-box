import { useEffect, useState } from 'react';
import { client } from '../api/client';
import PluginSlot from '../components/PluginSlot';
import type { LiveTemplateView } from '../../shared/plugin';
import VideoPlayer from '../components/VideoPlayer';
import { useLivePlayback } from '../features/live/useLivePlayback';

export default function LivePage() {
  const { profileId, lives, liveIdx, groups, groupName, channelName, lineIdx, playUrl, loading, err, liveName, curGroup, curEpg, lines, pickLive, pickChannel } = useLivePlayback();
  const [exportTpls, setExportTpls] = useState<LiveTemplateView[]>([]);
  const [exportTplId, setExportTplId] = useState('');
  const exportKey = JSON.stringify([profileId, liveIdx, liveName]);
  const [exportState, setExportState] = useState({ key: '', text: '' });
  const exportMsg = exportState.key === exportKey ? exportState.text : '';
  const setExportMsg = (text: string) => setExportState({ key: exportKey, text });
  useEffect(() => {
    let alive = true;
    void client.liveTemplates().then(items => {
      if (!alive) return;
      setExportTpls(items);
      setExportTplId(items[0]?.id ?? '');
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /**
   * ★ 2026-10-18 导出当前线路：把**已加载**的分组按模板渲染 → 主进程保存对话框 → 写文件。
   * ★ 只做输出侧格式化（不重新拉源、不发请求、不解析）。
   */
  async function doExport(): Promise<void> {
    const tpl = exportTpls.find((t) => t.id === exportTplId) ?? exportTpls[0];
    if (!tpl || !groups.length) return;
    setExportMsg('导出中…');
    try {
      const r = await client.liveExport({
        templateId: tpl.id,
        groups,
        defaultName: `${liveName || 'live'}.${tpl.ext}`,
      });
      setExportMsg(r.saved ? `已导出到：${r.path}` : '已取消导出');
    } catch (e) {
      setExportMsg(`导出失败：${(e as Error).message}`);
    }
  }


  return (
    <>
      <div className="topbar">
        <select aria-label="直播线路" value={liveIdx} onChange={(e) => pickLive(Number(e.target.value))} disabled={loading}>
          {lives.map((l, i) => <option key={i} value={i}>{l.name}</option>)}
        </select>
        {/* ★ 2026-10-18 导出当前线路（输出格式由模板决定：内置 2 个 + 插件 `live.template`） */}
        <select value={exportTplId} onChange={(e) => setExportTplId(e.target.value)} disabled={loading || !exportTpls.length} title="导出格式">
          {exportTpls.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button className="linkbtn" disabled={loading || !groups.length} title="把当前线路的频道导出为文件" onClick={() => void doExport()}>导出</button>
        <span className="status" style={{ marginLeft: 'auto' }}>{loading ? '加载中…' : `${groups.length} 组`}</span>
        {exportMsg && <span className="muted" style={{ fontSize: 12 }}>{exportMsg}</span>}
      </div>
      {/* ★ 2026-10-18 插件受限 UI 槽位（`contributes.ui.slot`；无插件声明时零影响） */}
      <PluginSlot slot="live" />
      <div className="layout-2 content" style={{ padding: 12 }}>
        <div className="left">
          {groups.map((g) => (
            <button type="button" key={g.group} className={`nav-item ui-action ${g.group === groupName ? 'active' : ''}`} aria-pressed={g.group === groupName} onClick={() => pickChannel(g, g.channels[0]?.name ?? '', 0)}>
              {g.group} <span className="muted">({g.channels.length})</span>
            </button>
          ))}
        </div>
        <div className="right">
          {err && <div className="err" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
          {curGroup ? (
            <>
              <div className="row" style={{ marginBottom: 10, maxHeight: 180, overflow: 'auto' }}>
                {curGroup.channels.map((c) => (
                  <button type="button" key={c.name} className={`tag ui-action ${c.name === channelName ? 'active' : ''}`} aria-pressed={c.name === channelName} onClick={() => pickChannel(curGroup, c.name, 0)}>
                    {c.name}
                  </button>
                ))}
              </div>
              {lines.length > 1 && (
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="muted">线路：</span>
                  {lines.map((l) => (
                    <button type="button" key={l.index} className={`tag ui-action ${l.index - 1 === lineIdx ? 'active' : ''}`} aria-pressed={l.index - 1 === lineIdx} onClick={() => pickChannel(curGroup, channelName, l.index - 1)}>
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
              {/* ★ 2026-09-29 EPG：当前 / 下一档（仅有节目单时才显示，避免占位空格） */}
              {curEpg && (curEpg.current || curEpg.next) && (
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
                </div>
              )}
              {/* ★ 2026-09-27：播放器必须有「有高度」的 flex 宿主 —— `.vplayer` 的高度只来自 flex（flex:1），
                  直接放进 block 容器 `.right` 会折成 0 高度（用户报「直播界面播放器消失」）。 */}
              {playUrl ? (
                <div className="live-player">
                  <VideoPlayer url={playUrl} />
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
