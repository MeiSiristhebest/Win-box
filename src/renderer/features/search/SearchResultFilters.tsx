import type { SearchFilterOption, SearchMatchMode } from '../../../engine/vod/searchRelevance';
import './search-results.css';

export function SearchResultFilters({ profiles, sources, profileId, sourceId, mode, hiddenCount, onProfile, onSource, onMode }: {
  profiles: SearchFilterOption[]; sources: SearchFilterOption[]; profileId: string; sourceId: string;
  mode: SearchMatchMode; hiddenCount: number;
  onProfile: (id: string) => void; onSource: (id: string) => void; onMode: (mode: SearchMatchMode) => void;
}) {
  return <div className="search-result-filters">
    <div className="search-result-filter-row">
      {profiles.length > 1 && <label>子仓<select aria-label="按子仓筛选" value={profileId} onChange={event => onProfile(event.target.value)}><option value="">全部子仓</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}（{profile.count}）</option>)}</select></label>}
      <label>来源<select aria-label="按来源筛选" value={sourceId} onChange={event => onSource(event.target.value)}><option value="">全部来源</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}（{source.count}）</option>)}</select></label>
      <label>匹配<select aria-label="搜索结果匹配方式" value={mode} onChange={event => onMode(event.target.value as SearchMatchMode)}><option value="related">片名相关</option><option value="all">全部返回</option></select></label>
    </div>
    {hiddenCount > 0 && <p className="muted search-result-filter-note">已隐藏 {hiddenCount} 条片名不符的返回。搜索演员、简介或别名时，可切换“全部返回”。</p>}
  </div>;
}
