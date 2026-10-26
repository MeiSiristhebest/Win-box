// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomePageViewModel } from '../src/renderer/features/home/homePageViewModel';
import { HomePageView } from '../src/renderer/features/home/HomePageView';

vi.mock('../src/renderer/components/PosterSizeControl', () => ({ default: () => null }));
vi.mock('../src/renderer/components/PluginSlot', () => ({ default: () => null }));
vi.mock('../src/renderer/components/ui/Button', () => ({ Button: () => null }));
vi.mock('../src/renderer/features/driveBinding/DriveBindingDialog', () => ({ DriveBindingDialog: () => null }));
vi.mock('../src/renderer/features/home/HomeBrowseResultsView', () => ({ HomeBrowseResultsView: () => null }));
vi.mock('../src/renderer/features/home/HomeSearchResultsView', () => ({
  HomeSearchResultsView: () => <div data-testid="home-search-results" />,
}));

afterEach(cleanup);

function model(overrides: {
  searchError?: string;
  sourceError?: string;
  webSourceError?: string;
  searchActive?: boolean;
  homePageUrl?: string;
} = {}): HomePageViewModel {
  return {
    route: { pathname: '/search', searchWindow: false },
    heading: { aggregate: true, browseSubtitle: '', title: '搜索结果', subtitle: '测试' },
    search: {
      active: overrides.searchActive ?? true,
      showToolbar: false,
      loading: false,
      error: overrides.searchError ?? '',
      folder: null,
      topbarStatus: '',
      emptyStatus: '搜索失败',
      onReturnFromFolder: () => undefined,
      onReturnToBrowse: () => undefined,
      results: {} as NonNullable<HomePageViewModel['search']['results']>,
    },
    source: {
      error: overrides.sourceError ?? '',
      homePageUrl: overrides.homePageUrl ?? '',
      webSourceError: overrides.webSourceError ?? '',
      openingWebSource: false,
      openWebHome: async () => undefined,
      driveBinding: {
        required: false,
        boundNames: [],
        openDialog: () => undefined,
        dialogOpen: false,
        closeDialog: () => undefined,
        onSaved: () => undefined,
      },
    },
    browse: {} as HomePageViewModel['browse'],
    profileScope: { visible: false, checked: false, disabled: false, count: 0, onChange: () => undefined },
    backToTop: { visible: false, onClick: () => undefined },
  };
}

describe('HomePageView error ownership', () => {
  it('keeps search results visible when only source-session loading failed', () => {
    render(<HomePageView model={model({ sourceError: '档案配置读取失败' })} posterSize="medium" onPosterSizeChange={() => undefined} />);

    expect(screen.getByText('档案配置读取失败')).toBeTruthy();
    expect(screen.getByTestId('home-search-results')).toBeTruthy();
  });

  it('hides stale search results when the search workflow itself failed', () => {
    render(<HomePageView model={model({ searchError: '聚合搜索失败' })} posterSize="medium" onPosterSizeChange={() => undefined} />);

    expect(screen.getByText('搜索失败')).toBeTruthy();
    expect(screen.queryByTestId('home-search-results')).toBeNull();
  });

  it('shows web-source launch errors without replacing source-session errors', () => {
    render(<HomePageView model={model({
      searchActive: false,
      sourceError: '档案配置读取失败',
      webSourceError: '网页窗口启动失败',
      homePageUrl: 'https://source.invalid/home',
    })} posterSize="medium" onPosterSizeChange={() => undefined} />);

    expect(screen.getByText('档案配置读取失败')).toBeTruthy();
    expect(screen.getByText('网页窗口启动失败')).toBeTruthy();
  });
});
