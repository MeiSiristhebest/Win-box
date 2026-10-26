import { POSTER_SIZE_OPTIONS, type PosterSize } from '../../shared/posterSize';
import './poster-size.css';

interface PosterSizeControlProps {
  size: PosterSize;
  onChange(size: PosterSize): void;
}

export default function PosterSizeControl({ size, onChange }: PosterSizeControlProps) {
  return <label className="poster-size-control"><span>海报</span>
    <select aria-label="海报大小" value={size} onChange={event => onChange(event.currentTarget.value as PosterSize)}>
      {POSTER_SIZE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
