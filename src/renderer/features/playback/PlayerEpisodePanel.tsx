export function PlayerEpisodePanel({ episodes, current, open, title, onClose, onSelect }: {
  episodes: { name: string; url: string }[]; current: number; open: boolean; title: string; onClose(): void; onSelect(index: number): void;
}) {
  return (
    <aside className={'vp-eppanel' + (open ? ' open' : '')} aria-hidden={!open} inert={!open}>
      <div className="vp-ephead">
        <span className="vp-eptitle" title={title}>{title}</span>
        <span className="vp-epcount">{current >= 0 ? (current + 1) + ' / ' + episodes.length : episodes.length + ' 集'}</span>
        <button type="button" className="vp-epclose" title="收起选集" onClick={onClose}>×</button>
      </div>
      <div className="vp-eplist">{episodes.map((episode, index) => (
        <button key={index + ':' + episode.url} type="button" className={'vp-epitem' + (index === current ? ' cur' : '')} aria-pressed={index === current} title={episode.name || '第' + (index + 1) + '集'} onClick={() => { onSelect(index); onClose(); }}>
          <span className="vp-epno">{index + 1}</span><span className="vp-epname">{episode.name || '第' + (index + 1) + '集'}</span>
        </button>
      ))}</div>
    </aside>
  );
}
