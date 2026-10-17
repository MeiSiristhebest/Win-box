import type { Dispatch, Ref, SetStateAction } from 'react';
import { customEndpointsText, mergeEndpoints } from '../../../engine/danmaku/endpoints';
import { formatCandidateLabel } from '../../../engine/danmaku/normalizeQuery';
import type { DanmakuCandidate, DanmakuSettings } from '../../../shared/danmaku';

interface DanmakuPanelProps {
  enabled: boolean;
  open: boolean;
  activeEpisodeId: number | null;
  message: string;
  settings: DanmakuSettings;
  candidates: DanmakuCandidate[];
  searching: boolean;
  query: string;
  episode: string;
  sourcesOpen: boolean;
  customText: string;
  panelRef: Ref<HTMLDivElement>;
  onAnchorPointerEnter: () => void;
  onAnchorPointerLeave: () => void;
  onPanelPointerEnter: () => void;
  onPanelPointerLeave: () => void;
  onToggle: () => void;
  onSettingsChange: Dispatch<SetStateAction<DanmakuSettings>>;
  onQueryChange: (value: string) => void;
  onEpisodeChange: (value: string) => void;
  setSourcesOpen: Dispatch<SetStateAction<boolean>>;
  setCustomText: Dispatch<SetStateAction<string>>;
  onSearch: () => void;
  onCandidateSelect: (candidate: DanmakuCandidate) => void | Promise<void>;
}

export function DanmakuPanel({
  enabled,
  open,
  activeEpisodeId,
  message,
  settings,
  candidates,
  searching,
  query,
  episode,
  sourcesOpen,
  customText,
  panelRef,
  onAnchorPointerEnter,
  onAnchorPointerLeave,
  onPanelPointerEnter,
  onPanelPointerLeave,
  onToggle,
  onSettingsChange,
  onQueryChange,
  onEpisodeChange,
  setSourcesOpen,
  setCustomText,
  onSearch,
  onCandidateSelect,
}: DanmakuPanelProps) {
  const enabledSourceCount = settings.endpoints.filter((endpoint) => endpoint.enabled !== false).length;

  return (
    <div className="vp-popup-anchor" onPointerEnter={onAnchorPointerEnter} onPointerLeave={onAnchorPointerLeave}>
      <button
        className="vp-ctl"
        title={`弹幕：${enabled ? '开' : '关'}（点击开关 · 悬停调整）`}
        onClick={onToggle}
      >
        <svg width="15" height="15" viewBox="0 0 24 24">
          <path d="M3.5 8a2 2 0 012-2h13a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 11h4M8 14.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {enabled && <span className="vp-subdot" />}
      </button>
      {open && (
        <div ref={panelRef} className="vp-panelhost" onPointerEnter={onPanelPointerEnter} onPointerLeave={onPanelPointerLeave}>
          <div className="vp-subpanel vp-dmpanel">
            <div className="vsp-row">
              <button className={`tag ${enabled ? 'active' : ''}`} onClick={onToggle}>弹幕：{enabled ? '开' : '关'}</button>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{message || (activeEpisodeId != null ? '已加载' : '')}</span>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">区域</span>
              {(['full', 'half', 'quarter'] as const).map((region) => (
                <button
                  key={region}
                  className={`vsp-btn${settings.region === region ? ' active' : ''}`}
                  onClick={() => onSettingsChange((current) => ({ ...current, region }))}
                >
                  {region === 'full' ? '全屏' : region === 'half' ? '半屏' : '1/4 屏'}
                </button>
              ))}
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">字号</span>
              <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, fontSize: Math.max(16, current.fontSize - 2) }))}>A−</button>
              <input
                type="range" min={16} max={40} value={settings.fontSize}
                onChange={(event) => onSettingsChange((current) => ({ ...current, fontSize: Number(event.target.value) }))}
              />
              <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, fontSize: Math.min(40, current.fontSize + 2) }))}>A＋</button>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">透明度</span>
              <input
                type="range" min={20} max={100} value={Math.round(settings.opacity * 100)}
                onChange={(event) => onSettingsChange((current) => ({ ...current, opacity: Number(event.target.value) / 100 }))}
              />
              <span className="muted" style={{ fontSize: 11 }}>{Math.round(settings.opacity * 100)}%</span>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">密度</span>
              <input
                type="range" min={25} max={100} value={Math.round(settings.density * 100)}
                onChange={(event) => onSettingsChange((current) => ({ ...current, density: Number(event.target.value) / 100 }))}
              />
              <span className="muted" style={{ fontSize: 11 }}>{settings.density.toFixed(2)}</span>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">速度</span>
              <input
                type="range" min={50} max={300} value={settings.speed}
                onChange={(event) => onSettingsChange((current) => ({ ...current, speed: Number(event.target.value) }))}
              />
              <span className="muted" style={{ fontSize: 11 }}>{settings.speed}</span>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">时间</span>
              <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, offset: current.offset - 0.5 }))}>−0.5s</button>
              <span className="muted" style={{ fontSize: 11 }}>{settings.offset >= 0 ? '+' : ''}{settings.offset}s</span>
              <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, offset: current.offset + 0.5 }))}>+0.5s</button>
              <button className="vsp-btn" title="重置" onClick={() => onSettingsChange((current) => ({ ...current, offset: 0 }))}>重置</button>
            </div>
            <div className="vsp-row">
              <input
                type="text"
                value={query}
                placeholder="剧名（自动清洗；可改输常见名）…"
                style={{ flex: 1, minWidth: 120 }}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
              />
              <input
                type="text"
                value={episode}
                placeholder="集（如 S1E01 / 第1集 / 1）"
                title="集号：支持 S1E01、E01、第01集、1、更新至1 等写法；填 S2 可只指定季"
                style={{ width: 128, flex: '0 0 128px' }}
                onChange={(event) => onEpisodeChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
              />
            </div>
            <div className="vsp-row" style={{ marginBottom: 6 }}>
              <button className="vsp-btn primary" disabled={searching || !query.trim()} onClick={onSearch}>
                {searching ? '匹配中…' : '匹配弹幕'}
              </button>
              {!query.trim() && <span className="vsp-hint" style={{ marginTop: 0 }}>请输入剧名</span>}
              {query.trim() && enabledSourceCount === 0 && <span className="vsp-hint" style={{ marginTop: 0 }}>弹幕源已全部关闭</span>}
            </div>
            <div className="vsp-row" style={{ marginBottom: 4 }}>
              <button
                className="vsp-btn"
                onClick={() => {
                  setCustomText(customEndpointsText(settings.endpoints));
                  setSourcesOpen((value) => !value);
                }}
              >
                弹幕源 {enabledSourceCount}/{settings.endpoints.length} 启用 {sourcesOpen ? '▲' : '▼'}
              </button>
              <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, endpoints: current.endpoints.map((endpoint) => ({ ...endpoint, enabled: true })) }))}>全开</button>
              <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, endpoints: current.endpoints.map((endpoint) => ({ ...endpoint, enabled: false })) }))}>全关</button>
            </div>
            {sourcesOpen && (
              <div className="vsp-dmsrc">
                <div className="vsp-dmsrc-list">
                  {settings.endpoints.map((endpoint, index) => (
                    <label key={endpoint.url} className="vsp-dmsrc-item" title={endpoint.url}>
                      <input
                        type="checkbox"
                        checked={endpoint.enabled}
                        onChange={() => onSettingsChange((current) => ({
                          ...current,
                          endpoints: current.endpoints.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, enabled: !item.enabled } : item
                          )),
                        }))}
                      />
                      <span className="vsp-dmsrc-name">{endpoint.name}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  className="vsp-dmsrc-text"
                  rows={2}
                  value={customText}
                  placeholder="自定义接口：一行一个，支持「名字@https://host/token」"
                  onChange={(event) => setCustomText(event.target.value)}
                />
                <div className="vsp-row" style={{ marginBottom: 4 }}>
                  <button className="vsp-btn" onClick={() => onSettingsChange((current) => ({ ...current, endpoints: mergeEndpoints(current.endpoints, customText) }))}>
                    保存自定义接口
                  </button>
                </div>
              </div>
            )}
            {candidates.length > 0 && (
              <div className="vsp-list">
                {candidates.map((candidate, index) => {
                  const label = formatCandidateLabel(candidate.title, candidate.episodeTitle, candidate.episodeNumber) || '未知番剧';
                  return (
                    <button
                      key={index}
                      className="vsp-item"
                      title={`${candidate.sourceName}${candidate.title ? ' · ' + candidate.title : ''}${candidate.episodeTitle ? ' ' + candidate.episodeTitle : ''}`}
                      onClick={() => { void onCandidateSelect(candidate); }}
                    >
                      <span className="vsp-item-name">
                        <span className="vsp-dmsrc-tag">{candidate.sourceName}</span>
                        {label}
                      </span>
                      <span className="muted">{candidate.episodeId === activeEpisodeId ? '当前' : '点击加载'}{candidates.length > 1 ? ' · 共 ' + candidates.length + ' 集' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
