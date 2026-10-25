import type { PlayerTechnicalBarModel } from './presentation/PlayerControlModels';

type PlayerTechnicalBarProps = PlayerTechnicalBarModel;

export function PlayerTechnicalBar({ active, error, mpvTech, fmtNet }: PlayerTechnicalBarProps) {
  return <>
        {active && !error && mpvTech && (
          <div className="vp-tech">
            {mpvTech.hwdec ? (
              <span className="vp-tech-chip">{mpvTech.hwdec === 'no' ? '软解' : `硬解·${mpvTech.hwdec}`}</span>
            ) : null}
            {mpvTech.w > 0 ? (
              <span className="vp-tech-chip">{mpvTech.w}×{mpvTech.h}{mpvTech.standard !== 'SDR' ? ` · ${mpvTech.standard}` : ''}</span>
            ) : null}
            {mpvTech.vCodec ? <span className="vp-tech-chip">{mpvTech.vCodec.toUpperCase()}</span> : null}
            {mpvTech.aCodec ? (
              <span className="vp-tech-chip">{mpvTech.aCodec.toUpperCase()}{mpvTech.channels ? ` · ${mpvTech.channels}` : ''}</span>
            ) : null}
            {mpvTech.vKbps > 0 ? (
              <span className="vp-tech-chip">{(mpvTech.vKbps / 1000).toFixed(2)} Mbps</span>
            ) : mpvTech.aKbps > 0 ? (
              <span className="vp-tech-chip">{(mpvTech.aKbps / 1000).toFixed(2)} Mbps</span>
            ) : null}
            {mpvTech.fps > 0 ? (
              <span className="vp-tech-chip">
                {mpvTech.fps.toFixed(2).replace(/\.?0+$/, '')} fps{mpvTech.dropped > 0 ? ` · 丢帧 ${mpvTech.dropped}` : ''}
              </span>
            ) : null}
            {mpvTech.speedKbps > 0 ? <span className="vp-tech-chip">{fmtNet(mpvTech.speedKbps)}</span> : null}
          </div>
        )}

  </>;
}
