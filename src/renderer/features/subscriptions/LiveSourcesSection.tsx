import { useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import type { LiveBean } from '../../../shared/types';
import { useAppDialog } from '../../components/AppDialog';

interface LiveSourcesSectionProps {
  active: boolean;
  lives: LiveBean[];
  activeIndex: number;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}

export function LiveSourcesSection({ active, lives, activeIndex, onRefresh, onError }: LiveSourcesSectionProps) {
  const dialog = useAppDialog();
  const [liveEditIdx, setLiveEditIdx] = useState<number | null>(null);
  const [liveEditName, setLiveEditName] = useState('');
  const liveEditNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (liveEditIdx !== null) liveEditNameInputRef.current?.focus();
  }, [liveEditIdx]);

  async function setActiveLive(index: number) {
    try {
      await client.cfgSetActiveLive(index);
      await onRefresh();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function deleteLive(index: number, name: string) {
    const displayName = name || '线路' + (index + 1);
    const confirmed = await dialog.confirm('确定删除直播线路「' + displayName + '」吗？\n删除后直播页顶部线路下拉将不再出现它（原始文件不会被改动）。', { title: '删除直播线路', confirmLabel: '删除', tone: 'danger' });
    if (!confirmed) return;
    onError('');
    try {
      await client.cfgDeleteLive(index);
      if (liveEditIdx === index) { setLiveEditIdx(null); setLiveEditName(''); }
      await onRefresh();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function saveLiveName(index: number) {
    const name = liveEditName.trim();
    setLiveEditIdx(null);
    setLiveEditName('');
    if (!name) return;
    onError('');
    try {
      await client.cfgUpdateLive({ index, name });
      await onRefresh();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <div hidden={!active} aria-hidden={!active}>
      {/* 2b) 直播线路（★ 2026-10-14 用户要求）：导入的 TXT / M3U 直播源在此可改名 / 删除 */}
      <details className="card" id="cfg-lives" open style={{ padding: 12, marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          直播线路（{lives.length}）
        </summary>
        <div style={{ marginTop: 10 }}>
          {lives.length === 0 ? (
            <div className="empty" style={{ padding: 12 }}>尚无直播线路，可点上方「导入直播源（TXT / M3U）」添加</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                  <th style={{ padding: 6, borderBottom: '1px solid var(--border)', width: 36, textAlign: 'center' }}>当前</th>
                  <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>名称</th>
                  <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>地址</th>
                  <th style={{ padding: 6, borderBottom: '1px solid var(--border)', width: 130 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {lives.map((l, i) => {
                  const isActive = i === activeIndex;
                  const editing = liveEditIdx === i;
                  return (
                    <tr
                      key={i}
                      onClick={() => { if (!editing) void setActiveLive(i); }}
                      style={{ cursor: editing ? 'default' : 'pointer', background: isActive && !editing ? 'var(--bg-elev2)' : undefined }}
                    >
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)', textAlign: 'center', color: 'var(--accent)' }}>{isActive ? '●' : '○'}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                        {editing ? (
                          <input
                            ref={liveEditNameInputRef}
                            style={{ width: 180, fontSize: 12 }}
                            value={liveEditName}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setLiveEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveLiveName(i);
                              if (e.key === 'Escape') { setLiveEditIdx(null); setLiveEditName(''); }
                            }}
                          />
                        ) : (l.name || `线路${i + 1}`)}
                      </td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', maxWidth: 320, wordBreak: 'break-all' }}>{l.url || l.api}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
                        {editing ? (
                          <>
                            <button className="linkbtn" onClick={() => void saveLiveName(i)}>确定</button>
                            <button className="linkbtn" onClick={() => { setLiveEditIdx(null); setLiveEditName(''); }}>取消</button>
                          </>
                        ) : (
                          <>
                            <button className="linkbtn" title="重命名该直播线路" onClick={() => { setLiveEditIdx(i); setLiveEditName(l.name || `线路${i + 1}`); }}>改名</button>
                            <button className="linkbtn danger" title="删除该直播线路" onClick={() => void deleteLive(i, l.name)}>删除</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            点某行可把它设为直播页当前线路；「删除」只从应用线路列表移除，不改动你导入的原始文件。
          </div>
        </div>
      </details>

    </div>
  );
}
