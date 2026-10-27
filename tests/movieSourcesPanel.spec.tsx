// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovieSourcesPanel } from '../src/renderer/features/detail/MovieSourcesPanel';
import { openDetailRoute } from '../src/renderer/lib/detailWin';
import { client } from '../src/renderer/api/client';
import { mergeSearchResults } from '../src/engine/vod/aggSearch';
import { sourceIdentityKey } from '../src/shared/sourceIdentity';
import { profileConfig } from './fixtures/profileSwitchData';
import type { VodItem } from '../src/shared/types';

vi.mock('../src/renderer/api/client', () => ({ client: { cfgGet: vi.fn(), searchAll: vi.fn(), category: vi.fn(), onSearchAllProgress: vi.fn(() => vi.fn()) } }));
vi.mock('../src/renderer/lib/keepAlive', () => ({ usePageActive: () => true }));
vi.mock('../src/renderer/lib/detailWin', () => ({ openDetailRoute: vi.fn() }));
vi.mock('../src/renderer/lib/useCovers', () => ({ useCovers: (items: Array<{ pic: string }>) => ({ picOf: (item: { pic: string }) => item.pic, onError: vi.fn(), items }) }));
const vod = (name: string, id = name): VodItem => ({ id, name, pic: 'https://images.test/' + id + '.jpg', remarks: '高清', year: '2026', area: '', type: '剧集', sourceKey: 'fixture' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
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
    const user = userEvent.setup();
    show();
    await screen.findByRole('button', { name: /嫁金钗 高清，乙仓/ });
    await user.selectOptions(screen.getByRole('combobox', { name: '按子仓筛选' }), 'B');
    expect(screen.queryByRole('button', { name: /嫁金钗，甲仓/ })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: '按来源筛选' }), sourceIdentityKey('B', 'same'));
    expect(screen.getAllByRole('button', { name: /查看剧集与播放/ })).toHaveLength(1);
    expect(client.searchAll).toHaveBeenCalledTimes(1);
  });

  it('lets users inspect all returned results without showing the target movie poster on unrelated titles', async () => {
    const user = userEvent.setup();
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'A', key: 'one', name: '源', status: 'ok', items: [{ ...vod('嫁金钗'), pic: '' }, { ...vod('火影忍者'), pic: '' }] }]));
    show('嫁金钗', 'https://images.test/fallback.jpg');
    expect(await screen.findByRole('img', { name: /^嫁金钗$/ })).toHaveProperty('src', 'https://images.test/fallback.jpg');
    await user.selectOptions(screen.getByRole('combobox', { name: '搜索结果匹配方式' }), 'all');
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

  it('returns from a cloud folder to the filtered aggregate result list', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'B', key: 'same', name: '乙源', status: 'ok', items: [
      { ...vod('夸克（目录）'), tag: 'folder' },
      vod('嫁金钗 01'),
    ] }]));
    vi.mocked(client.category).mockResolvedValue({ sourceKey: 'same', sortClasses: [], items: [vod('第01集')], page: 1, pagecount: 1, total: 1 });
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: /浏览网盘目录/ }));
    await screen.findByRole('button', { name: /第01集/ });
    await user.click(screen.getByRole('button', { name: '返回全部片源' }));

    expect(await screen.findByRole('button', { name: /嫁金钗 01/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /第01集/ })).toBeNull();
  });

  it('ignores a pending folder response after the user changes the profile filter', async () => {
    const category = deferred<{ sourceKey: string; sortClasses: []; items: VodItem[]; page: number; pagecount: number; total: number }>();
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([
      { profileId: 'A', profileName: '甲仓', key: 'alpha', name: '甲源', status: 'ok', items: [vod('嫁金钗 第一集', 'alpha-item')] },
      { profileId: 'B', profileName: '乙仓', key: 'beta', name: '乙源', status: 'ok', items: [{ ...vod('嫁金钗网盘目录', 'beta-folder'), tag: 'folder' }] },
    ]));
    vi.mocked(client.category).mockReturnValue(category.promise);
    const user = userEvent.setup();
    show();

    await user.selectOptions(await screen.findByRole('combobox', { name: '按子仓筛选' }), 'B');
    await user.click(await screen.findByRole('button', { name: /浏览网盘目录/ }));
    await waitFor(() => expect(client.category).toHaveBeenCalledOnce());
    await user.selectOptions(screen.getByRole('combobox', { name: '按子仓筛选' }), 'A');

    await act(async () => { category.resolve({ sourceKey: 'beta', sortClasses: [], items: [vod('第01集', 'stale-episode')], page: 1, pagecount: 1, total: 1 }); });

    expect(await screen.findByRole('button', { name: /嫁金钗 第一集/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '返回全部片源' })).toBeNull();
    expect(screen.queryByRole('button', { name: /第01集/ })).toBeNull();
  });

  it('ignores a pending folder response after aggregate search is refreshed', async () => {
    const category = deferred<{ sourceKey: string; sortClasses: []; items: VodItem[]; page: number; pagecount: number; total: number }>();
    vi.mocked(client.searchAll)
      .mockResolvedValueOnce(mergeSearchResults([{ profileId: 'B', profileName: '乙仓', key: 'beta', name: '乙源', status: 'ok', items: [{ ...vod('嫁金钗网盘目录', 'beta-folder'), tag: 'folder' }] }]))
      .mockResolvedValueOnce(mergeSearchResults([{ profileId: 'B', profileName: '乙仓', key: 'beta', name: '乙源', status: 'ok', items: [vod('嫁金钗 新搜索结果', 'fresh-result')] }]));
    vi.mocked(client.category).mockReturnValue(category.promise);
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: /浏览网盘目录/ }));
    await waitFor(() => expect(client.category).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: '重新搜索' }));

    expect(await screen.findByRole('button', { name: /嫁金钗 新搜索结果/ })).toBeTruthy();
    await act(async () => { category.resolve({ sourceKey: 'beta', sortClasses: [], items: [vod('第01集', 'stale-episode')], page: 1, pagecount: 1, total: 1 }); });

    expect(screen.queryByRole('button', { name: '返回全部片源' })).toBeNull();
    expect(screen.queryByRole('button', { name: /第01集/ })).toBeNull();
  });

  it('shows detail navigation failures instead of dropping the user action silently', async () => {
    vi.mocked(openDetailRoute).mockRejectedValueOnce(new Error('detail window unavailable'));
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: /嫁金钗，甲仓/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('detail window unavailable');
  });

  it('shows a search failure with an explicit retry and recovers when the connection returns', async () => {
    vi.mocked(client.searchAll)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(mergeSearchResults([{ profileId: 'A', key: 'one', name: '源', status: 'ok', items: [vod('嫁金钗', 'recovered')] }]));
    const user = userEvent.setup();
    show();

    expect((await screen.findByRole('alert')).textContent).toContain('offline');
    await user.click(screen.getByRole('button', { name: '重试搜索' }));

    expect(await screen.findByRole('button', { name: /嫁金钗，源/ })).toBeTruthy();
    expect(client.searchAll).toHaveBeenCalledTimes(2);
  });

  it('lets users retry a failed cloud-folder read', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'B', key: 'same', name: '乙源', status: 'ok', items: [{ ...vod('夸克（目录）'), tag: 'folder' }] }]));
    vi.mocked(client.category)
      .mockRejectedValueOnce(new Error('folder offline'))
      .mockResolvedValueOnce({ sourceKey: 'same', sortClasses: [], items: [vod('第01集')], page: 1, pagecount: 1, total: 1 });
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: /浏览网盘目录/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('folder offline');
    await user.click(screen.getByRole('button', { name: '重试加载目录' }));

    expect(await screen.findByRole('button', { name: /第01集/ })).toBeTruthy();
    expect(client.category).toHaveBeenCalledTimes(2);
  });

  it('renders only a bounded first page of posters', async () => {
    vi.mocked(client.searchAll).mockResolvedValue(mergeSearchResults([{ profileId: 'A', key: 'one', name: '源', status: 'ok', items: Array.from({ length: 140 }, (_, i) => vod('嫁金钗 ' + i, String(i))) }]));
    const { container } = show();
    await waitFor(() => expect(container.querySelectorAll('.movie-source-option')).toHaveLength(60));
    fireEvent.click(screen.getByRole('button', { name: /显示更多片源/ }));
    expect(container.querySelectorAll('.movie-source-option')).toHaveLength(120);
  });
});
