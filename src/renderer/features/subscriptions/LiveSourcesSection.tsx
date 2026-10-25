import { useEffect, useRef } from 'react';
import type { LiveBean } from '../../../shared/types';
import type { LiveSourcesManagementPort } from './application/liveSourcesPort';
import { useLiveSourcesManagement } from './useLiveSourcesManagement';

interface LiveSourcesSectionProps {
  active: boolean;
  lives: LiveBean[];
  activeIndex: number;
  managementPort: LiveSourcesManagementPort;
  onRefresh: () => Promise<void>;
  confirmRemoval: (displayName: string, index: number) => Promise<boolean>;
}

export function LiveSourcesSection({ active, lives, activeIndex, managementPort, onRefresh, confirmRemoval }: LiveSourcesSectionProps) {
  const liveEditNameInputRef = useRef<HTMLInputElement>(null);
  const { model, actions } = useLiveSourcesManagement({ port: managementPort, onRefresh, confirmRemoval });

  useEffect(() => {
    if (model.editingIndex !== null) liveEditNameInputRef.current?.focus();
  }, [model.editingIndex]);

  return (
    <div hidden={!active} aria-hidden={!active}>
      {/* 2b) 直播线路（★ 2026-10-14 用户要求）：导入的 TXT / M3U 直播源在此可改名 / 删除 */}
      <details className="card" id="cfg-lives" open style={{ padding: 12, marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          直播线路（{lives.length}）
        </summary>
        <div style={{ marginTop: 10 }}>
          {model.error && <div className="err" role="alert">{model.error}</div>}
          {model.notice && <output className="ok">{model.notice}</output>}
          {lives.length === 0 ? (
            <div className="empty" style={{ padding: 12 }}>尚无直播线路，可点上方「导入直播源（TXT / M3U）」添加</div>
          ) : (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can scroll the live source table.
            <section className="table-scroll" aria-label="直播线路列表" tabIndex={0}>
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
                  const editing = model.editingIndex === i;
                  return (
                    <tr
                      key={i}
                      onClick={() => { if (!editing) void actions.select(i); }}
                      style={{ cursor: editing ? 'default' : 'pointer', background: isActive && !editing ? 'var(--bg-elev2)' : undefined }}
                    >
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)', textAlign: 'center', color: 'var(--accent)' }}>{isActive ? '●' : '○'}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                        {editing ? (
                          <input
                            ref={liveEditNameInputRef}
                            style={{ width: 180, fontSize: 12 }}
                            value={model.draftName}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => actions.changeDraftName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void actions.saveName(i);
                              if (e.key === 'Escape') actions.cancelRename();
                            }}
                          />
                        ) : (l.name || `线路${i + 1}`)}
                      </td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', maxWidth: 320, wordBreak: 'break-all' }}>{l.url || l.api}</td>
                      <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
                        {editing ? (
                          <>
                            <button className="linkbtn" onClick={() => void actions.saveName(i)}>确定</button>
                            <button className="linkbtn" onClick={actions.cancelRename}>取消</button>
                          </>
                        ) : (
                          <>
                            <button className="linkbtn" title="重命名该直播线路" onClick={() => actions.beginRename(i, l.name || `线路${i + 1}`)}>改名</button>
                            <button className="linkbtn danger" title="删除该直播线路" onClick={() => void actions.remove(i, l.name)}>删除</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </section>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            点某行可把它设为直播页当前线路；「删除」只从应用线路列表移除，不改动你导入的原始文件。
          </div>
        </div>
      </details>

    </div>
  );
}
