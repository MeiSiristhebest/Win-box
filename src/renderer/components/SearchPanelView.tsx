import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MetaSuggestion } from '../../shared/meta';
import type { MovieHotList } from '../../shared/types';
import { isNativeModalOpen } from '../lib/modalScope';
import { useAnchoredPanel } from './useAnchoredPanel';

const HOT_RANK_MAX = 10;

interface SearchPanelViewProps {
  bar: boolean;
  open: boolean;
  query: string;
  hotList: MovieHotList | null;
  hotLoading: boolean;
  suggestions: MetaSuggestion[];
  suggestionsLoading: boolean;
  history: string[];
  onShow(): void;
  onClose(): void;
  onSearch(term: string): void;
  onQueryChange(value: string): void;
  onRemoveHistory(term: string): void;
  onClearHistory(): void;
  onRetryHotList(): void;
}

/** Passive search menu view; only DOM focus, dismissal and event delegation live here. */
export function SearchPanelView(props: SearchPanelViewProps) {
  const { open, onClose } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const panelPosition = useAnchoredPanel(open, triggerRef, panelRef, 520);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDocumentMouseDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (isNativeModalOpen()) return;
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        onClose();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [open, onClose]);

  return (
    <div className={`srcpick${props.bar ? ' sp-bar-wrap' : ''}`} ref={wrapRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !panelRef.current?.contains(event.relatedTarget)) props.onClose();
      }}>
      <button
        ref={triggerRef}
        type="button"
        className={`srcpick-name sp-btn ui-action${props.bar ? ' sp-bar' : ''}`}
        aria-expanded={props.open}
        aria-controls={panelId}
        title="搜索（全源搜索，结果边搜边出）"
        onClick={() => props.open ? props.onClose() : props.onShow()}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        {props.bar ? <span className="sp-bar-hint">搜索影片、剧集、演员</span> : '搜索'}
      </button>
      {props.open && createPortal(
        <section ref={panelRef} id={panelId} className="sp-panel" style={panelPosition} aria-label="搜索建议">
          <div className="sp-row">
            <input
              ref={inputRef}
              className="sp-input"
              aria-label="搜索影片"
              placeholder="输入片名，按回车搜索全部来源"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) props.onSearch(props.query);
              }}
            />
          </div>
          {props.query.trim() ? (
            <div className="sp-list">
              {props.suggestionsLoading && <div className="sp-item muted">联想中…</div>}
              {!props.suggestionsLoading && props.suggestions.length === 0 && <div className="sp-item muted">无联想结果，回车直接全源搜索「{props.query.trim()}」</div>}
              {props.suggestions.map((suggestion) => (
                <button type="button" key={`${suggestion.mediaType}:${suggestion.title}:${suggestion.year}`} className="sp-item ui-action" onClick={() => props.onSearch(suggestion.title)}>
                  <span>{suggestion.title}</span>
                  <span className="muted sp-meta">
                    {suggestion.mediaType === 'tv' ? '剧集' : '电影'}
                    {suggestion.year ? ` · ${suggestion.year}` : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sp-cols">
              <div className="sp-hist">
                <div className="sp-hot-tip muted">搜索历史{props.history.length ? `（${props.history.length}/10）` : ''}</div>
                {props.history.length === 0 ? (
                  <div className="sp-item muted">暂无搜索记录</div>
                ) : (
                  <div className="sp-hist-list">
                    {props.history.map((term) => (
                      <div key={term} className="sp-item sp-hist-item">
                        <button type="button" className="sp-hist-txt ui-action" title={term} onClick={() => props.onSearch(term)}>{term}</button>
                        <button
                          className="sp-hist-del"
                          aria-label={`删除搜索记录 ${term}`}
                          onClick={(event) => { event.stopPropagation(); props.onRemoveHistory(term); }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {props.history.length > 0 && (
                  <button type="button" className="sp-clear" onClick={props.onClearHistory}>清空搜索记录</button>
                )}
              </div>
              <div className="sp-rank">
                <div className="sp-hot-tip muted">百度电影热搜榜{props.hotList?.stale && props.hotList.items.length ? ' · 上次缓存' : ''}</div>
                {props.hotList?.fetchedAt ? <div className="muted">获取于 {new Date(props.hotList.fetchedAt).toLocaleString('zh-CN')}</div> : null}
                {!props.hotList?.items.length ? (
                  <div className="sp-item muted">
                    {props.hotLoading ? '正在加载热搜…' : <>热搜暂时获取失败，仍可直接搜索 <button onClick={props.onRetryHotList}>重试</button></>}
                  </div>
                ) : (
                  <div className="sp-rank-list">
                    {props.hotList.items.slice(0, HOT_RANK_MAX).map((item) => (
                      <button type="button" key={item.title} className="sp-rank-item ui-action" onClick={() => props.onSearch(item.title)} title={`${item.title} · 热搜指数 ${item.score}`}>
                        <span className={`sp-rank-no${item.rank <= 3 ? ' top' : ''}`}>{item.rank}</span>
                        <span className="sp-rank-txt">{item.title}</span>
                        <span className="muted sp-hot-score">{item.score}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>, document.body,
      )}
    </div>
  );
}
