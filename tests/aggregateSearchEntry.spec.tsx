// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import HomePage from '../src/renderer/pages/HomePage';
import DiscoverDetailPage from '../src/renderer/pages/DiscoverDetailPage';
import { discoverDetailRoute } from '../src/shared/discoverDetail';
import { mergeSearchResults } from '../src/engine/vod/aggSearch';
import { profileConfig } from './fixtures/profileSwitchData';
import { openDetailRoute } from '../src/renderer/lib/detailWin';
import { openSearchWindow } from '../src/renderer/lib/searchWin';
import type { VodItem } from '../src/shared/types';

vi.mock('../src/renderer/api/client', () => ({ client: {
  cfgGet: vi.fn(), searchAll: vi.fn(), home: vi.fn(), category: vi.fn(),
  metaSearch: vi.fn(), metaExtra: vi.fn(), driveBindKeys: vi.fn(async () => []), driveGet: vi.fn(async () => ({})),
  onSearchAllProgress: vi.fn(() => vi.fn()),
} }));
vi.mock('../src/renderer/lib/searchWin', () => ({ isSearchWindow: () => false, openSearchWindow: vi.fn() }));
vi.mock('../src/renderer/lib/detailWin', () => ({ isDetailWindow: () => false, openDetailRoute: vi.fn() }));
vi.mock('../src/renderer/components/PluginSlot', () => ({ default: () => null }));
vi.mock('../src/renderer/lib/useCovers', () => ({ useCovers: () => ({ picOf: () => '', onError: vi.fn() }) }));
vi.mock('../src/renderer/lib/uiPrefs', () => ({ useHomeFilters: () => false, setHomeFilters: vi.fn(), useWaterfall: () => false, setWaterfall: vi.fn(), usePosterSize: () => 'medium', setPosterSize: vi.fn() }));
vi.mock('../src/renderer/lib/uiMemory', () => ({ uiMem: { home: {} }, schedulePersist: vi.fn(), saveUiMemory: vi.fn() }));

const item = { id: 'film-b', name: '跨仓影片', pic: '', remarks: '高清', sourceKey: 'same-key', year: '2026', area: '', type: '' } satisfies VodItem;
beforeEach(() => {
  vi.clearAllMocks();
  const cfg = profileConfig('A');
  cfg.profiles = [cfg.profiles[0], { ...cfg.profiles[0], id: 'B', name: '子仓 B' }];
  vi.mocked(client.cfgGet).mockResolvedValue(cfg);
  vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'B', profileName: '子仓 B', key: 'same-key', name: 'B 片源', status: 'ok', items: [item] }]));
  vi.mocked(client.metaSearch).mockResolvedValue({ title: '跨仓影片', year: 2026, poster: '', overview: '这是影片简介', type: 'movie' });
  vi.mocked(client.metaExtra).mockResolvedValue({ cast: [], genres: [], directors: [], recommendations: [] });
});
afterEach(cleanup);

describe('real inline aggregate entry', () => {
  it('opens recommendation-only source cards as movie metadata with aggregate playback sources', async () => {
    const cfg = profileConfig('A');
    cfg.sources = cfg.sources.map(source => ({ ...source, name: '豆瓣推荐' }));
    vi.mocked(client.cfgGet).mockResolvedValue(cfg);
    vi.mocked(client.home).mockResolvedValue({ sourceKey: cfg.sources[0].key, sortClasses: [], items: [item], page: 1, pagecount: 1, total: 1 });
    const openDetail = vi.fn();
    render(<MemoryRouter initialEntries={['/home']}><Routes><Route path="/home" element={<HomePage onOpenDetail={openDetail} />} /><Route path="/movie" element={<DiscoverDetailPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByText('跨仓影片'));
    await screen.findByText('这是影片简介');
    expect(client.searchAll).toHaveBeenCalledWith('跨仓影片', { profileIds: ['A'], refresh: false });
    expect(openDetail).not.toHaveBeenCalled();
    expect(openSearchWindow).not.toHaveBeenCalled();
  });

  it('executes all-profile search on the inline search route instead of navigating again', async () => {
    render(<MemoryRouter initialEntries={['/search?agg=跨仓影片']}><HomePage onOpenDetail={vi.fn()} /></MemoryRouter>);
    await screen.findByText('跨仓影片');
    expect(client.searchAll).toHaveBeenCalledWith('跨仓影片', { refresh: false, profileIds: ['A', 'B'] });
    expect(openSearchWindow).not.toHaveBeenCalled();
    expect(client.home).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new CustomEvent('winbox:source-changed', { detail: 'same-key' })));
    await waitFor(() => expect(client.cfgGet).toHaveBeenCalledTimes(2));
    expect(client.home).not.toHaveBeenCalled();
    expect(screen.getByText('跨仓影片')).toBeTruthy();
  });

  it('opens movie metadata and preserves the producing profile when selecting a source', async () => {
    const route = discoverDetailRoute({ title: '跨仓影片', year: 2026, poster: '', mediaType: 'movie', doubanId: '123' });
    expect(route).toContain('/movie?');
    render(<MemoryRouter initialEntries={[route]}><DiscoverDetailPage /></MemoryRouter>);
    await screen.findByText('这是影片简介');
    const result = await screen.findByRole('button', { name: /跨仓影片.*B 片源/ });
    fireEvent.click(result);
    expect(client.searchAll).toHaveBeenCalledWith('跨仓影片', { profileIds: ['A', 'B'], refresh: false });
    expect(openDetailRoute).toHaveBeenCalledWith(expect.any(Function), 'same-key', 'film-b', expect.stringContaining('profileId=B'));
  });

  it('browses a cross-profile cloud folder and opens its file with the same source reference', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'B', profileName: '子仓 B', key: 'same-key', name: 'B 片源', status: 'ok', items: [{ ...item, tag: 'folder' }] }]));
    vi.mocked(client.category).mockResolvedValue({ sourceKey: 'same-key', sortClasses: [], items: [{ ...item, id: 'leaf', name: '网盘影片' }], page: 1, pagecount: 1, total: 1 });
    render(<MemoryRouter initialEntries={['/movie?name=跨仓影片']}><DiscoverDetailPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /浏览网盘目录/ }));
    fireEvent.click(await screen.findByRole('button', { name: /网盘影片/ }));
    expect(client.category).toHaveBeenCalledWith({ key: 'same-key', tid: 'film-b', pg: '1', extend: {}, profileId: 'B' });
    expect(openDetailRoute).toHaveBeenCalledWith(expect.any(Function), 'same-key', 'leaf', expect.stringContaining('profileId=B'));
  });
});
