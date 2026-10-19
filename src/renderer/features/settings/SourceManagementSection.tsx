import { useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import type { SourceBean } from '../../../shared/types';
import { sourceAvailability } from '../../../engine/vod/sourceAvailability';
import { EXT_TEMPLATES, validateExtJson } from '../../../engine/config/extHelper';
import { sourceKindInfo } from '../../../engine/config/sourceKind';
import { useAppDialog } from '../../components/AppDialog';
import { SourceDiagnosticsSection } from './SourceDiagnosticsSection';

interface Draft {
  name: string;
  ext: string;
  jar: string;
  playUrl: string;
  timeout: string;
  searchable: string;
  quickSearch: string;
  changeable: string;
  filterable: string;
}

interface SourceManagementSectionProps {
  active: boolean;
  sources: SourceBean[];
  activeSourceKey: string;
  profileId: string;
  globallyBlockedKeys?: string[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

function draftOf(source: SourceBean): Draft {
  return {
    name: source.name,
    ext: source.ext,
    jar: source.jar,
    playUrl: source.playUrl,
    timeout: String(source.timeout ?? ''),
    searchable: String(source.searchable ?? 1),
    quickSearch: String(source.quickSearch ?? 1),
    changeable: String(source.changeable ?? 1),
    filterable: String(source.filterable ?? 1),
  };
}

function DraftInput({ label, value, onChange, wide }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, gap: 2, minWidth: wide ? 160 : 70 }}>
      <span className="muted">{label}</span>
      <input style={{ width: '100%' }} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FlagSelect({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, gap: 2, minWidth: 84 }} title={hint}>
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
  onError: setErr,
  onNotice: setLastOk,
}: SourceManagementSectionProps) {
  const dialog = useAppDialog();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sourcePick, setSourcePick] = useState<Set<string>>(() => new Set());
  const [sourceDeleteBusy, setSourceDeleteBusy] = useState(false);
  const [diagRequest, setDiagRequest] = useState<{ sourceKey: string; revision: number } | null>(null);
  const diagRequestRef = useRef(0);
  const sourceProfileRef = useRef(profileId);
  const selectAllSourcesRef = useRef<HTMLInputElement>(null);
  const extOk = validateExtJson(draft?.ext ?? '');
  const selectedSourceCount = sources.filter((source) => sourcePick.has(source.key)).length;
  const allSourcesSelected = sources.length > 0 && selectedSourceCount === sources.length;

  useEffect(() => {
    const profileChanged = sourceProfileRef.current !== profileId;
    sourceProfileRef.current = profileId;
    const sourceKeys = new Set(sources.map((source) => source.key));
    setSourcePick((previous) => profileChanged ? new Set() : new Set([...previous].filter((key) => sourceKeys.has(key))));
    if (profileChanged || (editingKey && !sourceKeys.has(editingKey))) {
      setEditingKey(null);
      setDraft(null);
    }
  }, [profileId, sources, editingKey]);

  useEffect(() => {
    if (selectAllSourcesRef.current) {
      selectAllSourcesRef.current.indeterminate = selectedSourceCount > 0 && !allSourcesSelected;
    }
  }, [selectedSourceCount, allSourcesSelected]);

  function statusCell(source: SourceBean) {
    const availability = sourceAvailability(source);
    if (availability.usable) return <span style={{ color: 'var(--accent-2)' }}>可用</span>;
    return <span style={{ color: 'var(--warn)' }} title={availability.hint}>{availability.hint ?? '不可用'}</span>;
  }

  async function chooseSource(key: string) {
    setErr('');
    try {
      await client.cfgSetActiveSource(key);
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  async function deleteSource(key: string) {
    if (sourceDeleteBusy) return;
    setSourceDeleteBusy(true);
    setErr('');
    try {
      await client.cfgDeleteSource(key);
      if (editingKey === key) { setEditingKey(null); setDraft(null); }
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setSourceDeleteBusy(false);
    }
  }

  async function deleteSelectedSources() {
    const selected = sources.filter((source) => sourcePick.has(source.key));
    if (!selected.length || sourceDeleteBusy) return;
    const names = selected.slice(0, 6).map((source) => source.name || source.key).join('、');
    const more = selected.length > 6 ? '…' : '';
    if (!(await dialog.confirm('确定删除选中的 ' + selected.length + ' 个源吗？\n' + names + more + '\n原始文件不会被修改；不再被其它档案引用的导入脚本副本将被清理。', { title: '删除所选源', confirmLabel: '删除', tone: 'danger' }))) return;
    setSourceDeleteBusy(true);
    setErr('');
    try {
      await client.cfgDeleteSources(selected.map((source) => source.key));
      if (editingKey && sourcePick.has(editingKey)) { setEditingKey(null); setDraft(null); }
      setSourcePick(new Set());
      setLastOk('已删除 ' + selected.length + ' 个源');
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setSourceDeleteBusy(false);
    }
  }

  async function setGlobalBlock(keys: string[], blocked: boolean) {
    if (!keys.length || sourceDeleteBusy || busy) return;
    if (blocked && !(await dialog.confirm('将在所有子仓中隐藏这些 key 的源，之后可在全局屏蔽列表中解除。' + '\n' + keys.slice(0, 6).join('、'), { title: '全局屏蔽所选源', confirmLabel: '全局屏蔽', tone: 'danger' }))) return;
    setSourceDeleteBusy(true);
    setErr('');
    try {
      await client.cfgSetGlobalSourceBlock(keys, blocked);
      setSourcePick(new Set());
      setLastOk(blocked ? '已全局屏蔽 ' + keys.length + ' 个源' : '已解除全局屏蔽');
      await refresh();
    } catch (error) { setErr((error as Error).message); }
    finally { setSourceDeleteBusy(false); }
  }

  function toggleSourcePick(key: string) {
    setSourcePick((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function moveSource(key: string, direction: 'up' | 'down' | 'top' | 'bottom') {
    setErr('');
    try {
      await client.cfgMoveSource(key, direction);
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  function startEdit(source: SourceBean) {
    setEditingKey(source.key);
    setDraft(draftOf(source));
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraft(null);
  }

  async function saveEdit(key: string) {
    if (!draft) return;
    setErr('');
    try {
      const to = (value: string, fallback: number) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : fallback;
      };
      await client.cfgUpdateSource(key, {
        name: draft.name,
        ext: draft.ext,
        jar: draft.jar,
        playUrl: draft.playUrl,
        timeout: to(draft.timeout, 15),
        searchable: to(draft.searchable, 1),
        quickSearch: to(draft.quickSearch, 1),
        changeable: to(draft.changeable, 1),
        filterable: to(draft.filterable, 1),
      });
      setEditingKey(null);
      setDraft(null);
      await refresh();
    } catch (error) {
      setErr((error as Error).message);
    }
  }

  function runDiagnose(sourceKey: string) {
    setDiagRequest({ sourceKey, revision: ++diagRequestRef.current });
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
        {globallyBlockedKeys.length > 0 && <details className="card" style={{ padding: 10, marginBottom: 10 }}><summary>全局屏蔽列表（{globallyBlockedKeys.length}）</summary><div className="row" style={{ marginTop: 8 }}>{globallyBlockedKeys.map(key => <span key={key}><code>{key}</code> <button disabled={busy || sourceDeleteBusy} onClick={() => void setGlobalBlock([key], false)} aria-label={'解除全局屏蔽 ' + key}>解除屏蔽</button></span>)}</div></details>}
        {sources.length > 0 && (
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted">已选 {selectedSourceCount} / {sources.length} 个源</span>
            <button disabled={busy || sourceDeleteBusy || !selectedSourceCount} onClick={() => void setGlobalBlock(sources.filter(source => sourcePick.has(source.key)).map(source => source.key), true)}>全局屏蔽所选</button>
            <button disabled={sourceDeleteBusy || !selectedSourceCount} onClick={() => setSourcePick(new Set())}>清空选择</button>
            <button disabled={busy || sourceDeleteBusy || !selectedSourceCount} onClick={() => void deleteSelectedSources()} style={{ color: 'var(--danger)' }}>
              {sourceDeleteBusy ? '删除中…' : `删除所选（${selectedSourceCount}）`}
            </button>
          </div>
        )}
        {sources.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>尚无源，请先导入订阅</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                <th style={{ padding: 6, borderBottom: '1px solid var(--border)', width: 36, textAlign: 'center' }}>
                  <input ref={selectAllSourcesRef} type="checkbox" className="sel-box" aria-label="全选源" title="全选 / 取消全选" checked={allSourcesSelected} disabled={sourceDeleteBusy}
                    onChange={e => setSourcePick(e.target.checked ? new Set(sources.map(s => s.key)) : new Set())} />
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
                    onClick={() => !isEditing && chooseSource(s.key)}
                    style={{
                      cursor: isEditing ? 'default' : 'pointer',
                      background: isActive && !isEditing ? 'var(--bg-elev2)' : undefined,
                      outline: isActive && !isEditing ? '1px solid var(--accent)' : undefined,
                    }}
                  >
                    <td style={{ padding: 6, borderBottom: '1px solid var(--border)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="sel-box" aria-label={`选择源 ${s.name || s.key}`} checked={sourcePick.has(s.key)} disabled={sourceDeleteBusy} onChange={() => toggleSourcePick(s.key)} />
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
                          <DraftInput label="名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} wide />
                          <DraftInput label="超时（秒）" value={draft.timeout} onChange={(v) => setDraft({ ...draft, timeout: v })} />
                        </div>

                        {/* —— 按形态显示的接入字段 —— */}
                        {(kindInfo.usesJar || kindInfo.usesPlayUrl) && (
                          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 8 }}>
                            {kindInfo.usesJar && (
                              <DraftInput
                                label="jar（蜘蛛包地址，留空用全局 spider）"
                                value={draft.jar}
                                onChange={(v) => setDraft({ ...draft, jar: v })}
                                wide
                              />
                            )}
                            {kindInfo.usesPlayUrl && (
                              <DraftInput
                                label="playUrl（站内解析地址，一般留空）"
                                value={draft.playUrl}
                                onChange={(v) => setDraft({ ...draft, playUrl: v })}
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
                                <span style={{ color: extOk.ok ? 'var(--accent-2)' : 'var(--danger)', marginLeft: 6 }}>
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
                                  style={{ fontFamily: 'monospace', fontSize: 11, width: '100%' }}
                                  placeholder={'{\n  "siteUrl": "https://你的站点.com"\n}'}
                                  value={draft.ext}
                                  onChange={(e) => setDraft({ ...draft, ext: e.target.value })}
                                />
                                <div style={{ fontSize: 11 }}>
                                  {draft.ext.trim() ? (
                                    extOk.ok ? (
                                      <span style={{ color: 'var(--accent-2)' }}>JSON ✓ 键：{(extOk.keys ?? []).join(', ') || '（无）'}</span>
                                    ) : (
                                      <span style={{ color: 'var(--danger)' }}>{extOk.error}</span>
                                    )
                                  ) : (
                                    <span className="muted">ext 为空（合法，但部分蜘蛛必须要有 siteUrl 等参数）</span>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px', minWidth: 240 }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 }}>
                                  <span className="muted">套用模板（选择即覆盖填入，可再手改）</span>
                                  <select
                                    onChange={(e) => {
                                      const t = EXT_TEMPLATES.find((x) => x.kind === e.target.value);
                                      if (t) setDraft({ ...draft, ext: t.json });
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
                          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
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
                            <FlagSelect label="searchable" hint="是否参与搜索（0=不搜，全源搜索会跳过）" value={draft.searchable} onChange={(v) => setDraft({ ...draft, searchable: v })} />
                            <FlagSelect label="quickSearch" hint="是否参与快速搜索（首字即搜）" value={draft.quickSearch} onChange={(v) => setDraft({ ...draft, quickSearch: v })} />
                            <FlagSelect label="changeable" hint="详情页是否允许切换播放线路" value={draft.changeable} onChange={(v) => setDraft({ ...draft, changeable: v })} />
                            <FlagSelect label="filterable" hint="首页是否显示该源（0=首页可选里隐藏）" value={draft.filterable} onChange={(v) => setDraft({ ...draft, filterable: v })} />
                          </div>
                        </details>

                        <div className="row" style={{ marginTop: 10 }}>
                          <button className="primary" onClick={(e) => { e.stopPropagation(); void saveEdit(s.key); }}>保存</button>
                          <button onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>取消</button>
                          <span className="muted" style={{ fontSize: 11 }}>key / type / api 不可修改（改这些等于换源，请删除后重新添加）</span>
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
                          <div className="muted" style={{ fontSize: 10 }}>type{s.type}</div>
                        </td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>{statusCell(s)}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.api}>{s.api}</td>
                        <td style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <button onClick={(e) => { e.stopPropagation(); startEdit(s); }}>编辑</button>
                            <button onClick={(e) => { e.stopPropagation(); void runDiagnose(s.key); }}>诊断</button>
                            <button disabled={sourceDeleteBusy} onClick={(e) => { e.stopPropagation(); deleteSource(s.key); }} style={{ color: 'var(--danger)' }}>删除</button>
                            <button onClick={(e) => { e.stopPropagation(); moveSource(s.key, 'up'); }} title="上移" aria-label="上移">↑</button>
                            <button onClick={(e) => { e.stopPropagation(); moveSource(s.key, 'down'); }} title="下移" aria-label="下移">↓</button>
                            <button onClick={(e) => { e.stopPropagation(); moveSource(s.key, 'top'); }} title="置顶" aria-label="置顶">⤒</button>
                            <button onClick={(e) => { e.stopPropagation(); moveSource(s.key, 'bottom'); }} title="置底" aria-label="置底">⤓</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        </div>
      </details>

      <SourceDiagnosticsSection request={diagRequest} onClose={() => setDiagRequest(null)} />
    </div>
  );
}
