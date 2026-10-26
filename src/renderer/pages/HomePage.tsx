import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HomePageView } from '../features/home/HomePageView';
import { usePosterSizePreference } from '../features/display/adapters/posterSizePreferenceAdapter';
import { useHomePagePresenter } from '../features/home/useHomePagePresenter';
import { useSkinLayout } from '../features/theme/adapters/useThemeStore';
import { createHomeSearchNavigationAdapter } from '../features/home/adapters/homeSearchNavigationAdapter';
import {
  homeBrowseAdapter,
  homeDriveAdapter,
  homeSearchAdapter,
  homeSourceSelectionAdapter,
  homeWebSourceAdapter,
} from '../features/home/adapters/homePageAdapters';
import { homeWaterfallObserverAdapter } from '../features/home/adapters/homeWaterfallObserverAdapter';
import { homePageMemoryAdapter } from '../features/home/adapters/homePageMemoryAdapter';
import { homeSourceSessionEventsAdapter } from '../features/home/adapters/homeSourceSessionEventsAdapter';
import { useHomeFilterPanelPreference } from '../features/home/adapters/homeFilterPreferenceAdapter';
import { homeCategoryStateMemoryAdapter } from '../features/home/adapters/homeCategoryStateMemoryAdapter';
import { useHomeWaterfallPreference } from '../features/home/adapters/homeWaterfallPreferenceAdapter';
import {
  rendererSearchClock,
  rendererSearchFrames,
  rendererSearchWallClock,
} from '../features/home/adapters/rendererSearchClock';

type HomePageProps = {
  onOpenDetail: (key: string, id: string, pic?: string, name?: string, profileId?: string) => void;
};

export default function HomePage({ onOpenDetail }: HomePageProps) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const [searchParams, setSearchParams] = useSearchParams();
  const searchNavigation = useMemo(
    () => createHomeSearchNavigationAdapter((parameters) => setSearchParams(parameters, { replace: true })),
    [setSearchParams],
  );
  const filterPanel = useHomeFilterPanelPreference();
  const waterfall = useHomeWaterfallPreference();
  const posterSize = usePosterSizePreference();
  const cardStyle = useSkinLayout().filterStyle === 'card';
  const model = useHomePagePresenter({
    onOpenDetail,
    route: { pathname, searchParams, navigate },
    filterPanel,
    waterfallMode: waterfall,
    cardStyle,
    ports: {
      browse: homeBrowseAdapter,
      drive: homeDriveAdapter,
      search: homeSearchAdapter,
      searchNavigation,
      searchRuntime: {
        aggregateClock: rendererSearchClock,
        wallClock: rendererSearchWallClock,
        frames: rendererSearchFrames,
      },
      sourceSelection: homeSourceSelectionAdapter,
      sourceSessionEvents: homeSourceSessionEventsAdapter,
      webSource: homeWebSourceAdapter,
      categoryState: homeCategoryStateMemoryAdapter,
      memory: homePageMemoryAdapter,
      waterfallObserver: homeWaterfallObserverAdapter,
    },
  });
  return <HomePageView model={model} posterSize={posterSize.size} onPosterSizeChange={posterSize.changeSize} />;
}
