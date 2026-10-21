import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AggVodItem } from '../../../shared/types';
import { client } from '../../api/client';
import { openDetailRoute } from '../../lib/detailWin';
import { useMovieSources } from '../discovery/useMovieSources';
import '../discovery/movie.css';

export function MovieSourcesPanel({ title: name }: { title: string }) {
  const navigate = useNavigate();
  const { report, progress, loading, error, refresh } = useMovieSources(name);
  const [cap, setCap] = useState(60);
  const [folder, setFolder] = useState<{ name: string; items: AggVodItem[] } | null>(null);
  const [folderError, setFolderError] = useState('');
  const [folderLoading, setFolderLoading] = useState(false);
  const [showStates, setShowStates] = useState(false);
  const folderRequest = useRef(0);
  const sourceItems = folder?.items ?? report?.items ?? [];
  async function open(item: AggVodItem) {
    if (item.tag !== 'folder') {
      const query = new URLSearchParams({ name: item.name, pic: item.pic || '' });
      if (item.sourceRef?.profileId) query.set('profileId', item.sourceRef.profileId);
      try { await openDetailRoute(to => navigate(to), item.sourceKey, item.id, query.toString()); }
      catch (cause) { setFolderError(cause instanceof Error ? cause.message : String(cause)); }
      return;
    }
    const request = ++folderRequest.current;
    setFolderLoading(true); setFolderError('');
    try {
      const result = await client.category({ key: item.sourceKey, tid: item.id, pg: '1', extend: {}, profileId: item.sourceRef?.profileId });
      if (request === folderRequest.current) {
        setFolder({ name: item.name, items: result.items.map(entry => ({ ...entry, sourceKey: item.sourceKey, sourceRef: item.sourceRef, sourceName: item.sourceName, sourceProfileName: item.sourceProfileName, sameFromOtherSources: 0 })) });
        setCap(60);
      }
    } catch (cause) { if (request === folderRequest.current) setFolderError(String(cause)); }
    finally { if (request === folderRequest.current) setFolderLoading(false); }
  }
  return (
    <section aria-label="聚合播放来源" aria-busy={loading || folderLoading}>
      <header className="page-heading"><div><h2>播放来源</h2><p>搜索全部已导入子仓的可搜索源，选择结果后查看剧集并播放。</p></div><button type="button" onClick={refresh} disabled={loading}>重新搜索</button></header>
      {loading && <output>{progress ? `正在搜索 ${progress.done}/${progress.total} 个源…` : '正在查找全部片源…'}</output>}
      {error && <div role="alert" className="err">{error}</div>}
      {folderError && <div role="alert" className="err">{folderError}</div>}
      {folder && <div className="row"><button type="button" onClick={() => { folderRequest.current++; setFolder(null); setFolderLoading(false); setFolderError(''); }}>返回全部片源</button><span>{folder.name}</span></div>}
      {!folder && report && <p className="muted">已检查 {report.perSource.length} 个源 · 命中 {report.hitSources} 个 · {report.items.length} 条结果{report.pendingSources ? ` · ${report.pendingSources} 个源正在准备运行时，将自动重试` : ''}</p>}
      <div className="movie-source-grid">{sourceItems.slice(0, cap).map(item => <button type="button" className="card movie-source-option" key={JSON.stringify([item.sourceRef?.profileId, item.sourceKey, item.id])} onClick={() => void open(item)} disabled={folderLoading}>
        <strong>{item.name}</strong><span>{[item.year, item.remarks].filter(Boolean).join(' · ')}</span><span className="muted">{[item.sourceProfileName, item.sourceName || item.sourceKey].filter(Boolean).join(' / ')}</span><span>{item.tag === 'folder' ? '浏览网盘目录' : '查看剧集与播放'}</span>
      </button>)}</div>
      {sourceItems.length > cap && <button type="button" onClick={() => setCap(value => value + 60)}>显示更多片源</button>}
      {!loading && !folderLoading && !error && sourceItems.length === 0 && <p className="empty">本次未找到可播放结果，可重试搜索或检查下方源状态。</p>}
      {!!report?.perSource.length && <details onToggle={event => setShowStates(event.currentTarget.open)}><summary>查看各源搜索状态</summary>{showStates && report.perSource.map(source => <p key={JSON.stringify([source.profileId, source.key])}>{source.profileName} / {source.name}：{source.status === 'error' ? source.error : source.count ? `${source.count} 条` : '本次无匹配结果'}</p>)}</details>}
    </section>
  );
}
