// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovieSourcesPanel } from '../src/renderer/features/detail/MovieSourcesPanel';
import { client } from '../src/renderer/api/client';
import { mergeSearchResults, sourceIdentityKey } from '../src/engine/vod/aggSearch';
import { profileConfig } from './fixtures/profileSwitchData';
import type { VodItem } from '../src/shared/types';

vi.mock('../src/renderer/api/client', () => ({ client: { cfgGet: vi.fn(), searchAll: vi.fn(), category: vi.fn(), onSearchAllProgress: vi.fn(() => vi.fn()) } }));
vi.mock('../src/renderer/lib/keepAlive', () => ({ usePageActive: () => true }));
vi.mock('../src/renderer/lib/detailWin', () => ({ openDetailRoute: vi.fn() }));
vi.mock('../src/renderer/lib/useCovers', () => ({ useCovers: (items: Array<{ pic: string }>) => ({ picOf: (item: { pic: string }) => item.pic, onError: vi.fn(), items }) }));
const vod = (name: string, id = name): VodItem => ({ id, name, pic: 'https://images.test/' + id + '.jpg', remarks: '高清', year: '2026', area: '', type: '剧集', sourceKey: 'fixture' });
beforeEach(() => {
  vi.clearAllMocks();
  const config = profileConfig('A');
  config.profiles = [config.profiles[0], { ...config.profiles[0], id: 'B', name: '乙仓' }];
  vi.mocked(client.cfgGet).mockResolvedValue(config);
  vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([
    { profileId: 'A', profileName: '甲仓', key: 'same', name: '甲源', status: 'ok', items: [vod('嫁金钗', 'a'), vod('火影忍者', 'wrong')] },
    { profileId: 'B', profileName: '乙仓', key: 'same', name: '乙源', status: 'ok', items: [vod('嫁金钗 高清', 'b')] },
  ]));
});
afterEach(cleanup);
const show = (title = '嫁金钗', poster?: string) => render(<MemoryRouter><MovieSourcesPanel title={title} poster={poster} /></MemoryRouter>);

describe('movie source posters and filters', () => {
  it('cleans a clip caption before searching, and hides unrelated recommendations', async () => {
    show('《嫁金钗》 第一集 剧集更新1-14');
    expect(await screen.findByRole('img', { name: /^嫁金钗$/ })).toHaveProperty('src', 'https://images.test/a.jpg');
    expect(screen.queryByRole('button', { name: /火影忍者/ })).toBeNull();
    expect(screen.getByText(/已隐藏 1 条片名不符/)).toBeTruthy();
    expect(client.searchAll).toHaveBeenCalledWith('嫁金钗', { profileIds: ['A', 'B'], refresh: false });
  });

  it('filters by child and by the producing source without starting another network search', async () => {
    show();
    await screen.findByRole('button', { name: /嫁金钗 高清，乙仓/ });
    fireEvent.change(screen.getByLabelText('按子仓筛选'), { target: { value: 'B' } });
    expect(screen.queryByRole('button', { name: /嫁金钗，甲仓/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('按来源筛选'), { target: { value: sourceIdentityKey('B', 'same') } });
    expect(screen.getAllByRole('button', { name: /查看剧集与播放/ })).toHaveLength(1);
    expect(client.searchAll).toHaveBeenCalledTimes(1);
  });

  it('lets users inspect all returned results without showing the target movie poster on unrelated titles', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'A', key: 'one', name: '源', status: 'ok', items: [{ ...vod('嫁金钗'), pic: '' }, { ...vod('火影忍者'), pic: '' }] }]));
    show('嫁金钗', 'https://images.test/fallback.jpg');
    expect(await screen.findByRole('img', { name: /^嫁金钗$/ })).toHaveProperty('src', 'https://images.test/fallback.jpg');
    fireEvent.change(screen.getByLabelText('搜索结果匹配方式'), { target: { value: 'all' } });
    expect(screen.getByRole('button', { name: /火影忍者/ })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '火影忍者' })).toBeNull();
    expect(client.searchAll).toHaveBeenCalledTimes(1);
  });

  it('does not filter generic episode filenames inside a cloud folder', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'B', key: 'same', name: '乙源', status: 'ok', items: [{ ...vod('夸克（92个）'), tag: 'folder' }] }]));
    vi.mocked(client.category).mockResolvedValue({ sourceKey: 'same', sortClasses: [], items: [vod('第01集')], page: 1, pagecount: 1, total: 1 });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /浏览网盘目录/ }));
    await screen.findByRole('button', { name: /第01集/ });
    expect(client.category).toHaveBeenCalledWith({ key: 'same', tid: '夸克（92个）', pg: '1', extend: {}, profileId: 'B' });
  });

  it('renders only a bounded first page of posters', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'A', key: 'one', name: '源', status: 'ok', items: Array.from({ length: 140 }, (_, i) => vod('嫁金钗 ' + i, String(i))) }]));
    const { container } = show();
    await waitFor(() => expect(container.querySelectorAll('.movie-source-option')).toHaveLength(60));
    fireEvent.click(screen.getByRole('button', { name: /显示更多片源/ }));
    expect(container.querySelectorAll('.movie-source-option')).toHaveLength(120);
  });
});
