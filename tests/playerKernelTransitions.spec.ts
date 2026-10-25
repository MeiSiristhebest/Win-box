import { describe, expect, it, vi } from 'vitest';
import { createPlayerKernelTransitions, type PlayerKernelSnapshot, type PlayerKernelTransitionPorts, type PlayerFullscreenMode } from '../src/renderer/features/playback/application/playerKernelTransitions';
import type { Kernel, KernelPref } from '../src/renderer/lib/kernel';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(overrides: Partial<PlayerKernelSnapshot> = {}) {
  const state: PlayerKernelSnapshot = {
    url: 'https://media.test/movie.mp4', progressKey: 'profile/source/movie', kernel: 'html5', preference: 'auto',
    allowMpv: true, mpvAvailable: true, live: false, nativeWindow: true, fullscreen: false,
    position: 95.4, paused: false, hasPlaybackError: false, htmlSettings: { volume: 0.65, rate: 1.25 },
    ...overrides,
  };
  const ports = {
    window: { documentFullscreen: vi.fn(() => false), exitFullscreen: vi.fn(async (_mode: PlayerFullscreenMode): Promise<unknown> => undefined) },
    snapshot: () => state,
    releaseTemporaryRate: vi.fn(),
    clearAutoNext: vi.fn(),
    retryPluginEngine: vi.fn(),
    stageHandoff: vi.fn(),
    activateKernel: vi.fn((kernel: Kernel) => { state.kernel = kernel; }),
    rememberPreference: vi.fn((preference: KernelPref) => { state.preference = preference; }),
  } satisfies PlayerKernelTransitionPorts;
  return { state, ports, transitions: createPlayerKernelTransitions(ports) };
}

describe('player kernel transitions', () => {
  it('updates the preference without restarting a kernel that is already selected', () => {
    const { ports, transitions } = harness({ kernel: 'mpv' });
    expect(transitions.switchKernel('mpv', true, 'auto')).toBe(true);
    expect(ports.rememberPreference).toHaveBeenCalledWith('auto');
    expect(ports.releaseTemporaryRate).not.toHaveBeenCalled();
    expect(ports.stageHandoff).not.toHaveBeenCalled();
    expect(ports.window.exitFullscreen).not.toHaveBeenCalled();
  });

  it('captures the base playback rate and hands off only after document fullscreen exits', async () => {
    const exit = deferred();
    const { state, ports, transitions } = harness({ nativeWindow: false, paused: true, htmlSettings: { volume: 0.65, rate: 1.5 } });
    ports.window.documentFullscreen.mockReturnValue(true);
    ports.window.exitFullscreen.mockReturnValue(exit.promise);
    ports.releaseTemporaryRate.mockImplementation(() => { state.htmlSettings!.rate = 1.25; });

    transitions.switchKernel('mpv');
    expect(ports.window.exitFullscreen).toHaveBeenCalledWith('document');
    expect(ports.stageHandoff).not.toHaveBeenCalled();
    expect(ports.activateKernel).not.toHaveBeenCalled();
    expect(ports.rememberPreference).not.toHaveBeenCalled();
    state.htmlSettings!.rate = 2;
    exit.resolve();
    await exit.promise;

    expect(ports.stageHandoff).toHaveBeenCalledWith({
      url: state.url, progressKey: state.progressKey, kernel: 'mpv', position: 95.4, paused: true,
    }, { volume: 0.65, rate: 1.25 });
    expect(ports.activateKernel).toHaveBeenCalledWith('mpv');
    expect(ports.rememberPreference).toHaveBeenCalledWith('mpv');
  });

  it('restores native bounds when leaving a managed kernel even if the fullscreen indicator is false', async () => {
    const { ports, transitions } = harness({ kernel: 'mpv', htmlSettings: null });
    transitions.switchKernel('html5');
    await Promise.resolve();

    expect(ports.window.exitFullscreen).toHaveBeenCalledWith('native');
    expect(ports.stageHandoff).toHaveBeenCalledWith(expect.objectContaining({ kernel: 'html5', position: 95.4 }), null);
  });

  it('coalesces duplicate requests and refuses an opposing request while bounds restoration is pending', async () => {
    const exit = deferred();
    const { ports, transitions } = harness({ fullscreen: true });
    ports.window.exitFullscreen.mockReturnValue(exit.promise);
    expect(transitions.switchKernel('mpv')).toBe(true);
    expect(transitions.switchKernel('mpv')).toBe(true);
    expect(transitions.switchKernel('html5')).toBe(false);
    expect(ports.window.exitFullscreen).toHaveBeenCalledOnce();
    exit.resolve();
    await exit.promise;
    expect(ports.stageHandoff).toHaveBeenCalledOnce();
    expect(ports.activateKernel).toHaveBeenCalledOnce();
  });

  it('rejects an old completion after the profile-scoped resource changes, without blocking the new request', async () => {
    const first = deferred();
    const second = deferred();
    const { state, ports, transitions } = harness({ fullscreen: true });
    ports.window.exitFullscreen.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    transitions.switchKernel('mpv');
    state.progressKey = 'another-profile/same-source/movie';
    state.position = 12;
    transitions.switchKernel('mpv', false);
    first.resolve();
    await first.promise;
    expect(ports.stageHandoff).not.toHaveBeenCalled();
    expect(ports.rememberPreference).not.toHaveBeenCalled();
    second.resolve();
    await second.promise;
    expect(ports.stageHandoff).toHaveBeenCalledWith(expect.objectContaining({ progressKey: state.progressKey, position: 12 }), expect.anything());
    expect(ports.activateKernel).toHaveBeenCalledOnce();
  });

  it('discards a transition on cancellation or a new URL before its fullscreen operation completes', async () => {
    const exit = deferred();
    const { state, ports, transitions } = harness({ fullscreen: true });
    ports.window.exitFullscreen.mockReturnValue(exit.promise);
    transitions.switchKernel('mpv');
    transitions.cancel();
    state.url = 'https://media.test/next.mp4';
    exit.resolve();
    await exit.promise;
    expect(ports.stageHandoff).not.toHaveBeenCalled();
    expect(ports.activateKernel).not.toHaveBeenCalled();
    expect(ports.rememberPreference).not.toHaveBeenCalled();
  });

  it('unlocks and completes a best-effort switch if fullscreen exit rejects', async () => {
    const { state, ports, transitions } = harness({ fullscreen: true });
    ports.window.exitFullscreen.mockRejectedValueOnce(new Error('Window is already closed'));
    transitions.switchKernel('mpv');
    await Promise.resolve();
    expect(ports.activateKernel).toHaveBeenCalledWith('mpv');
    state.fullscreen = false;
    expect(transitions.switchKernel('html5')).toBe(true);
    await Promise.resolve();
    expect(ports.activateKernel).toHaveBeenLastCalledWith('html5');
  });

  it('automatically recovers from a stopped HTML decoder as playing, while keeping the auto preference', () => {
    const { ports, transitions } = harness({ paused: true });
    expect(transitions.recoverHtmlPlayback()).toBe(true);
    expect(ports.stageHandoff).toHaveBeenCalledWith(expect.objectContaining({ kernel: 'mpv', paused: false }), expect.anything());
    expect(ports.rememberPreference).not.toHaveBeenCalled();
  });

  it.each<Partial<PlayerKernelSnapshot>>([
    { preference: 'html5' }, { preference: 'mpv' }, { allowMpv: false }, { mpvAvailable: false }, { live: true }, { kernel: 'engine:plugin' },
  ])('does not intercept the HTML error when automatic fallback is disallowed: %j', (overrides) => {
    const { ports, transitions } = harness(overrides);
    expect(transitions.recoverHtmlPlayback()).toBe(false);
    expect(ports.stageHandoff).not.toHaveBeenCalled();
  });

  it('lets an explicit engine already being selected own recovery instead of starting another fallback', () => {
    const exit = deferred();
    const { ports, transitions } = harness({ fullscreen: true });
    ports.window.exitFullscreen.mockReturnValue(exit.promise);
    transitions.switchKernel('engine:plugin');
    expect(transitions.recoverHtmlPlayback()).toBe(true);
    expect(ports.window.exitFullscreen).toHaveBeenCalledOnce();
    transitions.cancel();
  });

  it('retries an explicitly selected plugin at handoff and recovers without overwriting its saved preference', async () => {
    const { ports, transitions } = harness();
    transitions.switchKernel('engine:plugin');
    expect(ports.retryPluginEngine).toHaveBeenCalledOnce();
    expect(ports.rememberPreference).toHaveBeenCalledWith('engine:plugin');
    ports.stageHandoff.mockClear();
    ports.rememberPreference.mockClear();
    transitions.recoverWithKernel('html5');
    await Promise.resolve();
    expect(ports.stageHandoff).toHaveBeenCalledWith(expect.objectContaining({ kernel: 'html5', paused: false }), expect.anything());
    expect(ports.rememberPreference).not.toHaveBeenCalled();
  });
});
