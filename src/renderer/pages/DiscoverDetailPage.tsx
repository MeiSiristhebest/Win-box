import { useSearchParams } from 'react-router-dom';
import { discoverDetailMetadataAdapter } from '../features/discovery/adapters/discoverDetailMetadataAdapter';
import { useDiscoverDetailMetadata } from '../features/discovery/useDiscoverDetailMetadata';
import { DiscoverDetailPageView } from './DiscoverDetailPageView';
import '../features/discovery/movie.css';

/** Route composition for metadata lookup and source selection. */
export default function DiscoverDetailPage() {
  const [params] = useSearchParams();
  const title = params.get('name')?.trim() || '';
  const year = params.get('year') || '';
  const metadata = useDiscoverDetailMetadata(title, year, discoverDetailMetadataAdapter);

  return (
    <DiscoverDetailPageView
      title={title}
      year={year}
      type={params.get('type') || ''}
      rating={params.get('rating') || ''}
      fallbackPoster={params.get('pic') || ''}
      {...metadata}
    />
  );
}
