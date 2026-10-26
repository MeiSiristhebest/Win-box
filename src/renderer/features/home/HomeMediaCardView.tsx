import type { SyntheticEvent } from 'react';

/** Shared visual atom for browse and aggregate-search media cards. */
export function HomeMediaCardView({
  title,
  pic,
  remarks,
  folder = false,
  sourceLabel,
  onOpen,
  onImageError,
}: {
  title: string;
  pic: string;
  remarks?: string;
  folder?: boolean;
  sourceLabel?: string;
  onOpen: () => void;
  onImageError: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  return (
    <button type="button" className="card-media ui-action card-media-button" aria-label={`打开 ${title}`} onClick={onOpen}>
      <div className="card">
        <div className="media-poster">
          {pic
            ? <img src={pic} alt={title} onError={onImageError} loading="lazy" decoding="async" />
            : <div className="no-cover">暂无封面</div>}
          {remarks && <span className="badge">{remarks}</span>}
        </div>
        <div className="meta">
          <div className="name" title={title}>
            {folder && <span title="文件夹：点开列出里面的资源">📁 </span>}
            {title}
          </div>
          {sourceLabel && (
            <div className="search-result-origin" title={sourceLabel}>
              <span className="search-result-origin-label">来源</span><span>{sourceLabel}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
