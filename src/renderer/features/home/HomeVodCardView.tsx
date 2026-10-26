import { memo } from 'react';
import type { VodItem } from '../../../shared/types';
import { HomeMediaCardView } from './HomeMediaCardView';

export const HomeVodCardView = memo(function HomeVodCardView({
  item,
  pic,
  onOpen,
  onImageError,
}: {
  item: VodItem;
  pic: string;
  onOpen: (item: VodItem) => void;
  onImageError: (item: VodItem, failedSource: string) => void;
}) {
  return (
    <HomeMediaCardView
      title={item.name}
      pic={pic}
      remarks={item.remarks}
      onOpen={() => onOpen(item)}
      onImageError={(event) => onImageError(item, event.currentTarget.getAttribute('src') || '')}
    />
  );
});
