import { POSTER_SIZE_OPTIONS, type PosterSize } from '../../shared/posterSize';
import { setPosterSize, usePosterSize } from '../lib/uiPrefs';
import './poster-size.css';

export default function PosterSizeControl() {
  const size = usePosterSize();
  return <label className="poster-size-control"><span>海报</span>
    <select aria-label="海报大小" value={size} onChange={event => setPosterSize(event.currentTarget.value as PosterSize)}>
      {POSTER_SIZE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
