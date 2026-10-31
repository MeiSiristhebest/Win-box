import { useEffect, useRef } from 'react';
import type { SourceBean } from '../../../shared/types';
import { sourceAvailability } from '../../../engine/vod/sourceAvailability';
import { EXT_TEMPLATES, validateExtJson } from '../../../engine/config/extHelper';
import { sourceKindInfo } from '../../../engine/config/sourceKind';
import { SourceDiagnosticsSection } from './SourceDiagnosticsSection';
import type { SourceDiagnosticsPort, SourceManagementPort } from './application/settingsSectionPorts';
import { useSourceManagementPresenter } from './useSourceManagementPresenter';

interface SourceManagementSectionProps {
  active: boolean;
  sources: SourceBean[];
  activeSourceKey: string;
  profileId: string;
  globallyBlockedKeys?: string[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  confirmDangerousAction: (message: string, title: string, confirmLabel: string) => Promise<boolean>;
  sourcesPort: SourceManagementPort;
  diagnosticsPort: SourceDiagnosticsPort;
}

function DraftInput({ label, value, onChange, wide }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 2, minWidth: wide ? 160 : 70 }}>
      <span className="muted">{label}</span>
      <input style={{ width: '100%' }} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FlagSelect({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 2, minWidth: 84 }} title={hint}>
      <span className="muted">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="1">1 · 是</option>
        <option value="0">0 · 否</option>
      </select>
    </label>
  );
}

export function SourceManagementSection({
  active,
  sources,
  activeSourceKey: activeKey,
  profileId,
  globallyBlockedKeys = [],
  busy,
  onRefresh: refresh,
  confirmDangerousAction,
  sourcesPort,
  diagnosticsPort,
}: SourceManagementSectionProps) {
  const selectAllSourcesRef = useRef<HTMLInputElement>(null);
  const presenter = useSourceManagementPresenter({
    sources,
    profileId,
    busy,
    refresh,
    confirmDangerousAction,
    sourcesPort,
  });
  const {
    editingKey,
    draft,
    selectedSourceKeys,
    sourceDeleteBusy,
    diagRequest,
    error,
    notice,
    selectedSourceCount,
    allSourcesSelected,
    actions,
  } = presenter;
  const extOk = validateExtJson(draft?.ext ?? '');

  useEffect(() => {
    if (selectAllSourcesRef.current) {
      selectAllSourcesRef.current.indeterminate = selectedSourceCount > 0 && !allSourcesSelected;
    }
  }, [selectedSourceCount, allSourcesSelected]);

  function statusCell(source: SourceBean) {
    const availability = sourceAvailability(source);
    if (availability.usable) return <span style={{ color: 'var(--text-success)' }}>可用</span>;
    return <span style={{ color: 'var(--text-warn)' }} title={availability.hint}>{availability.hint ?? '不可用'}</span>;
  }

  return (
    <div hidden={!active} aria-hidden={!active}>
      {/* 2) 我的源列表（可折叠） */}
      <details className="card" id="cfg-sources" open style={{ padding: 12, marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          我的源列表（{sources.length}）
        </summary>
        <div style={{ marginTop: 10 }}>
        <p className="muted">删除仅作用于当前子仓。全局屏蔽会隐藏所有子仓中相同 key 的源，可随时解除。</p>
        {error && <div className="err" role="alert">{error}</div>}
        {notice && <output className="ok">{notice}</output>}
        {globallyBlockedKeys.length > 0 && <details className="card" style={{ padding: 10, marginBottom: 10 }}><summary>全局屏蔽列表（{globallyBlockedKeys.length}）</summary><div className="row" style={{ marginTop: 8 }}>{globallyBlockedKeys.map(key => <span key={key}><code>{key}</code> <button disabled={busy || sourceDeleteBusy} onClick={() => void actions.setGlobalBlock([key], false)} aria-label={'解除全局屏蔽 ' + key}>解除屏蔽</button></span>)}</div></details>}
        {sources.length > 0 && (
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted">已选 {selectedSourceCount} / {sources.length} 个源</span>
            <button disabled={busy || sourceDeleteBusy || !selectedSourceCount} onClick={() => void actions.setGlobalBlock(sources.filter(source => selectedSourceKeys.has(source.key)).map(source => source.key), true)}>全局屏蔽所选</button>
            <button disabled={sourceDeleteBusy || !selectedSourceCount} onClick={actions.clearSelection}>清空选择</button>
            <button disabled={busy || sourceDeleteBusy || !selectedSourceCount} onClick={() => void actions.deleteSelectedSources()} style={{ color: 'var(--text-danger)' }}>
              {sourceDeleteBusy ? '删除中…' : `删除所选（${selectedSourceCount}）`}
            </button>
          </div>
        )}
        {sources.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>尚无源，请先导入订阅</div>
        ) : (
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can scroll the source table.
          <section className="table-scroll" aria-label="点播源列表" tabIndex={0}>
          <table className="cfg-source-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)', width: 36, textAlign: 'center' }}>
                  <input ref={selectAllSourcesRef} type="checkbox" className="sel-box" aria-label="全选源" title="全选 / 取消全选" checked={allSourcesSelected} disabled={sourceDeleteBusy}
                    onChange={e => actions.setAllSourcePicks(e.target.checked)} />
                </th>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)', width: 36 }}>当前</th>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>key / name</th>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>形态</th>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>状态</th>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>api</th>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)', width: 210 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const isActive = s.key === activeKey;
                const isEditing = s.key === editingKey;
                const kindInfo = sourceKindInfo(s);
                return (
                  <tr
                    key={s.key}
                    onClick={() => !isEditing && void actions.chooseSource(s.key)}
                    style={{
                      cursor: isEditing ? 'default' : 'pointer',
                      background: isActive && !isEditing ? 'var(--bg-elev2)' : undefined,
                      outline: isActive && !isEditing ? '1px solid var(--accent)' : undefined,
                    }}
                  >
                    <td style={{ padding: 6, borderBottom: '1px solid var(--border)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="sel-box" aria-label={`选择源 ${s.name || s.key}`} checked={selectedSourceKeys.has(s.key)} disabled={sourceDeleteBusy} onChange={() => actions.toggleSourcePick(s.key)} />
                    </td>
                    <td style={{ padding: 6, borderBottom: '1px solid var(--border)', textAlign: 'center', color: 'var(--accent)' }}>
                      {isActive ? '●' : '○'}
                    </td>
                    {isEditing && draft ? (
                      <td colSpan={5} style={{ padding: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg-elev2)' }}>
                        {/* 形态说明：告诉用户这个源到底怎么跑 */}
                        <div className="banner" style={{ borderLeftColor: 'var(--accent)', marginBottom: 10, fontSize: 12 }}>
                          <b>{kindInfo.label}</b>
                          <span className="muted"> —— {kindInfo.how}</span>
                        </div>

                        {/* —— 基本信息 —— */}
                        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <DraftInput label="名称" value={draft.name} onChange={(v) => actions.changeDraft('name', v)} wide />
                          <DraftInput label="超时（秒）" value={draft.timeout} onChange={(v) => actions.changeDraft('timeout', v)} />
                        </div>

                        {/* —— 按形态显示的接入字段 —— */}
                        {(kindInfo.usesJar || kindInfo.usesPlayUrl) && (
                          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 8 }}>
                            {kindInfo.usesJar && (
                              <DraftInput
                                label="jar（蜘蛛包地址，留空用全局 spider）"
                                value={draft.jar}
                                onChange={(v) => actions.changeDraft('jar', v)}
                                wide
                              />
                            )}
                            {kindInfo.usesPlayUrl && (
                              <DraftInput
                                label="playUrl（站内解析地址，一般留空）"
                                value={draft.playUrl}
                                onChange={(v) => actions.changeDraft('playUrl', v)}
                                wide
                              />
                            )}
                          </div>
                        )}

                        {/* —— ext 配置（仅蜘蛛类需要）—— */}
                        {kindInfo.usesExt ? (
                          <details open={!!draft.ext.trim()} style={{ marginTop: 10 }}>
                            <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                              ext 配置（蜘蛛自定义参数）
                              {draft.ext.trim() ? (
                                <span style={{ color: extOk.ok ? 'var(--text-success)' : 'var(--text-danger)', marginLeft: 6 }}>
                                  {extOk.ok ? `已填 ✓ ${(extOk.keys ?? []).slice(0, 6).join(', ')}` : `⚠ ${extOk.error}`}
                                </span>
                              ) : (
                                <span className="muted" style={{ marginLeft: 6 }}>空 —— 多数 jar 蜘蛛需要目标站址，没有它多半加载不出来</span>
                              )}
                            </summary>

                            <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 340px', minWidth: 280 }}>
                                <textarea
                                  rows={6}
                                  style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
                                  placeholder={'{\n  "siteUrl": "https://你的站点.com"\n}'}
                                  value={draft.ext}
                                  onChange={(e) => actions.changeDraft('ext', e.target.value)}
                                />
                                <div style={{ fontSize: 12 }}>
                                  {draft.ext.trim() ? (
                                    extOk.ok ? (
                                      <span style={{ color: 'var(--text-success)' }}>JSON ✓ 键：{(extOk.keys ?? []).join(', ') || '（无）'}</span>
                                    ) : (
                                      <span style={{ color: 'var(--text-danger)' }}>{extOk.error}</span>
                                    )
                                  ) : (
                                    <span className="muted">ext 为空（合法，但部分蜘蛛必须要有 siteUrl 等参数）</span>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px', minWidth: 240 }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                                  <span className="muted">套用模板（选择即覆盖填入，可再手改）</span>
                                  <select
                                    onChange={(e) => {
                                       const template = EXT_TEMPLATES.find((item) => item.kind === e.target.value);
                                       if (template) actions.applyExtTemplate(template.json);
                                    }}
                                    value=""
                                  >
                                    <option value="">— 选择模板 —</option>
                                    {EXT_TEMPLATES.map((t) => (
                                      <option key={t.kind} value={t.kind} title={t.note}>
                                        {t.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </div>
                          </details>
                        ) : (
                          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                            该形态不使用 ext（接入参数直接写在 api 里）。
                          </div>
                        )}

                        {/* —— 搜索与筛选开关 —— */}
                        <details style={{ marginTop: 10 }}>
                          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                            搜索与筛选（可选）
                            <span className="muted" style={{ marginLeft: 6 }}>
                              searchable={draft.searchable} · filterable={draft.filterable}
                            </span>
                          </summary>
                          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                            <FlagSelect label="searchable" hint="是否参与搜索（0=不搜，全源搜索会跳过）" value={draft.searchable} onChange={(v) => actions.changeDraft('searchable', v)} />
                            <FlagSelect label="quickSearch" hint="是否参与快速搜索（首字即搜）" value={draft.quickSearch} onChange={(v) => actions.changeDraft('quickSearch', v)} />
                            <FlagSelect label="changeable" hint="详情页是否允许切换播放线路" value={draft.changeable} onChange={(v) => actions.changeDraft('changeable', v)} />
                            <FlagSelect label="filterable" hint="首页是否显示该源（0=首页可选里隐藏）" value={draft.filterable} onChange={(v) => actions.changeDraft('filterable', v)} />
                          </div>
                        </details>

                        <div className="row" style={{ marginTop: 10 }}>
                          <button className="primary" onClick={(e) => { e.stopPropagation(); void actions.saveEdit(s.key); }}>保存</button>
                          <button onClick={(e) => { e.stopPropagation(); actions.cancelEdit(); }}>取消</button>
                          <span className="muted" style={{ fontSize: 12 }}>key / type / api 不可修改（改这些等于换源，请删除后重新添加）</span>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                          <div>{s.key}</div>
                          <div className="muted">{s.name}</div>
                        </td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                          <div title={`type=${s.type}`}>{kindInfo.label}</div>
                          <div className="muted" style={{ fontSize: 12 }}>type{s.type}</div>
                        </td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>{statusCell(s)}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.api}>{s.api}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                          <div className="row cfg-source-actions" style={{ flexWrap: 'nowrap' }}>
                            <button onClick={(e) => { e.stopPropagation(); actions.startEdit(s); }}>编辑</button>
                            <button onClick={(e) => { e.stopPropagation(); actions.runDiagnose(s.key); }}>诊断</button>
                            <button disabled={sourceDeleteBusy} onClick={(e) => { e.stopPropagation(); void actions.deleteSource(s.key); }} style={{ color: 'var(--text-danger)' }}>删除</button>
                            <button onClick={(e) => { e.stopPropagation(); void actions.moveSource(s.key, 'up'); }} title="上移" aria-label="上移">↑</button>
                            <button onClick={(e) => { e.stopPropagation(); void actions.moveSource(s.key, 'down'); }} title="下移" aria-label="下移">↓</button>
                            <button onClick={(e) => { e.stopPropagation(); void actions.moveSource(s.key, 'top'); }} title="置顶" aria-label="置顶">⤒</button>
                            <button onClick={(e) => { e.stopPropagation(); void actions.moveSource(s.key, 'bottom'); }} title="置底" aria-label="置底">⤓</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </section>
        )}
        </div>
      </details>

      <SourceDiagnosticsSection request={diagRequest} port={diagnosticsPort} onClose={actions.closeDiagnostics} />
    </div>
  );
}
