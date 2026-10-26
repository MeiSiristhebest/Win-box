import type { SearchFilterOption } from './application/searchResultProjection';
import type { SearchMatchMode } from '../../../shared/searchTitleMatching';
import { SelectField } from '../../components/ui/Field';
import './search-results.css';

export function SearchResultFilters({ profiles, sources, profileId, sourceId, mode, hiddenCount, onProfile, onSource, onMode }: {
  profiles: SearchFilterOption[]; sources: SearchFilterOption[]; profileId: string; sourceId: string;
  mode: SearchMatchMode; hiddenCount: number;
  onProfile: (id: string) => void; onSource: (id: string) => void; onMode: (mode: SearchMatchMode) => void;
}) {
  return <div className="search-result-filters">
    <div className="search-result-filter-row">
      {profiles.length > 1 && <SelectField label="子仓" aria-label="按子仓筛选" value={profileId} onChange={onProfile} options={[{ value: '', label: '全部子仓' }, ...profiles.map(profile => ({ value: profile.id, label: `${profile.name}（${profile.count}）` }))]} />}
      <SelectField label="来源" aria-label="按来源筛选" value={sourceId} onChange={onSource} options={[{ value: '', label: '全部来源' }, ...sources.map(source => ({ value: source.id, label: `${source.name}（${source.count}）` }))]} />
      <SelectField label="匹配" aria-label="搜索结果匹配方式" value={mode} onChange={value => onMode(value as SearchMatchMode)} options={[{ value: 'related', label: '片名相关' }, { value: 'all', label: '全部返回' }]} />
    </div>
    {hiddenCount > 0 && <p className="muted search-result-filter-note">已隐藏 {hiddenCount} 条片名不符的返回。搜索演员、简介或别名时，可切换“全部返回”。</p>}
  </div>;
}
