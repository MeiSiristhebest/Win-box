// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import LivePage from '../src/renderer/pages/LivePage';
import { liveResult, profileConfig } from './fixtures/profileSwitchData';

vi.mock('../src/renderer/components/VideoPlayer', () => ({ default: ({ url }: { url: string }) => <div data-testid="live-video">{url}</div> }));
vi.mock('../src/renderer/components/PluginSlot', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function setup() {
  let config = profileConfig('A');
  vi.spyOn(client, 'cfgGet').mockImplementation(async () => config);
  vi.spyOn(client, 'liveMeta').mockImplementation(async () => config.lives);
  vi.spyOn(client, 'liveTemplates').mockResolvedValue([]);
  vi.spyOn(client, 'liveEpg').mockResolvedValue({ byKey: {} });
  const load = vi.spyOn(client, 'loadLive').mockImplementation(async () => liveResult(config.activeProfileId));
  return { load, setConfig: (next: typeof config) => { config = next; } };
}

describe('LivePage profile switching', () => {
  it('reloads live lines and channels when another child repository becomes active', async () => {
    const state = setup();
    render(<LivePage />);
    await screen.findByText('A频道');
    state.setConfig(profileConfig('B'));
    act(() => window.dispatchEvent(new Event('winbox:sources-changed')));
    await screen.findByText('B频道');
    expect(screen.queryByText('A频道')).toBeNull();
    expect(screen.getByTestId('live-video').textContent).toContain('/B.m3u8');
  });

  it('clears the previous player when the next child has no live lines', async () => {
    const state = setup();
    render(<LivePage />);
    await screen.findByText('A频道');
    state.setConfig(profileConfig('empty', true, false));
    act(() => window.dispatchEvent(new Event('winbox:sources-changed')));
    await waitFor(() => expect(screen.queryByTestId('live-video')).toBeNull());
    expect(screen.queryByText('A频道')).toBeNull();
  });

  it('ignores an old load that finishes after a child switch', async () => {
    const state = setup();
    let finishOld!: (value: ReturnType<typeof liveResult>) => void;
    state.load.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    render(<LivePage />);
    await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1));
    state.setConfig(profileConfig('B'));
    act(() => window.dispatchEvent(new Event('winbox:sources-changed')));
    await screen.findByText('B频道');
    await act(async () => { finishOld(liveResult('A')); });
    expect(screen.queryByText('A频道')).toBeNull();
    expect(screen.getByText('B频道')).toBeTruthy();
  });
});
