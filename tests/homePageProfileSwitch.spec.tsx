// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import HomePage from '../src/renderer/pages/HomePage';
import { PageActiveContext } from '../src/renderer/lib/keepAlive';
import { notifyProfileChanged } from '../src/renderer/lib/configEvents';
import { uiMem } from '../src/renderer/lib/uiMemory';
import { profileConfig } from './fixtures/profileSwitchData';

vi.mock('../src/renderer/components/PluginSlot', () => ({ default: () => null }));
vi.mock('../src/renderer/lib/useCovers', () => ({ useCovers: () => ({ picOf: () => '', onError: vi.fn() }) }));
vi.mock('../src/renderer/lib/uiPrefs', () => ({ useHomeFilters: () => false, setHomeFilters: vi.fn(), useWaterfall: () => false, setWaterfall: vi.fn(), usePosterSize: () => 'medium', setPosterSize: vi.fn() }));
vi.mock('../src/renderer/lib/uiMemory', () => ({ uiMem: { home: {} }, schedulePersist: vi.fn(), saveUiMemory: vi.fn() }));

beforeEach(() => { uiMem.home = { key: '', tid: '', pg: 1, scrollTop: 0 }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  let config = profileConfig('A');
  vi.spyOn(client, 'cfgGet').mockImplementation(async () => config);
  vi.spyOn(client, 'driveBindKeys').mockResolvedValue([]);
  vi.spyOn(client, 'cfgSetActiveSource').mockResolvedValue(undefined);
  const home = vi.spyOn(client, 'home').mockImplementation(async (key, profileId) => ({
    sourceKey: key, sortClasses: [{ id: 'movies', name: profileId + '分类' }],
    items: [{ id: profileId + '-vod', name: profileId + '影片', pic: '', remarks: '', year: '', area: '', type: '', sourceKey: key }],
    page: 1, pagecount: 1, total: 1,
  }));
  return { home, setConfig: (next: typeof config) => { config = next; } };
}

function page(active = true) {
  return <MemoryRouter initialEntries={['/home']}><PageActiveContext.Provider value={active}><HomePage onOpenDetail={vi.fn()} /></PageActiveContext.Provider></MemoryRouter>;
}

describe('HomePage child repository switching', () => {
  it('reloads a shared source key when the next child has no saved active source', async () => {
    const state = setup();
    render(page());
    await screen.findByText('A影片');
    const next = profileConfig('B');
    next.ui.activeSourceKey = '';
    state.setConfig(next);
    act(() => notifyProfileChanged());
    await screen.findByText('B影片');
    expect(screen.queryByText('A影片')).toBeNull();
    expect(state.home).toHaveBeenLastCalledWith('same-key', 'B');
  });

  it('clears old films and categories when switching to a live-only child', async () => {
    const state = setup();
    render(page());
    await screen.findByText('A影片');
    state.setConfig(profileConfig('live-only', false));
    act(() => notifyProfileChanged());
    await screen.findByText('尚未导入站源，请先到「配置」页导入');
    expect(screen.queryByText('A影片')).toBeNull();
    expect(screen.queryByText('A分类')).toBeNull();
  });

  it('loads the first source on return after a child switch while hidden', async () => {
    const state = setup();
    const view = render(page());
    await screen.findByText('A影片');
    view.rerender(page(false));
    const next = profileConfig('B');
    next.ui.activeSourceKey = '';
    state.setConfig(next);
    act(() => notifyProfileChanged());
    view.rerender(page(true));
    await screen.findByText('B影片');
    expect(screen.queryByText('A影片')).toBeNull();
  });

  it('ignores a configuration response from before the current child switch', async () => {
    const state = setup();
    render(page());
    await screen.findByText('A影片');
    let finishOld!: (value: ReturnType<typeof profileConfig>) => void;
    vi.mocked(client.cfgGet).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    act(() => window.dispatchEvent(new Event('winbox:sources-changed')));
    state.setConfig(profileConfig('B'));
    act(() => notifyProfileChanged());
    await screen.findByText('B影片');
    await act(async () => { finishOld(profileConfig('A')); });
    expect(screen.queryByText('A影片')).toBeNull();
    expect(screen.getByText('B影片')).toBeTruthy();
    expect(state.home).toHaveBeenLastCalledWith('same-key', 'B');
  });

  it('ignores an old home response after clearing a live-only child', async () => {
    const state = setup();
    render(page());
    await screen.findByText('A影片');
    const oldResult = state.home.mock.results[0].value;
    let finishOld!: (value: Awaited<ReturnType<typeof client.home>>) => void;
    state.home.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    act(() => notifyProfileChanged());
    await waitFor(() => expect(state.home).toHaveBeenCalledTimes(2));
    state.setConfig(profileConfig('live-only', false));
    act(() => notifyProfileChanged());
    await screen.findByText('尚未导入站源，请先到「配置」页导入');
    await act(async () => { finishOld(await oldResult); });
    expect(screen.queryByText('A影片')).toBeNull();
    expect(screen.queryByText('A分类')).toBeNull();
  });
});
