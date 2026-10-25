// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPlayerInput } from '../src/renderer/features/playback/application/audioPlayer';
import type {
  AudioPlaybackMediaPort,
  AudioPlayerKeyboardEventsPort,
  AudioPlayerKeyboardShortcut,
  AudioPlayerShortcutGuardPort,
} from '../src/renderer/features/playback/application/audioPlayerPorts';
import type { PlaybackPositionMemoryPort } from '../src/renderer/features/playback/application/playbackSessionPorts';
import { useAudioPlaybackSession } from '../src/renderer/features/playback/useAudioPlaybackSession';

const resourceUrl = 'https://media.example/audio.mp3';
const sourceScope = { profileId: 'profile-a', key: 'source-a' };
let playMedia = vi.fn(() => Promise.resolve());
let pauseMedia = vi.fn();

function makeKeyboardEvents() {
  let keyboardListener: ((event: AudioPlayerKeyboardShortcut) => void) | undefined;
  const port: AudioPlayerKeyboardEventsPort = {
    subscribeKeyboardShortcuts(listener) {
      keyboardListener = listener;
      return () => { keyboardListener = undefined; };
    },
  };
  return {
    port,
    sendShortcut(event: AudioPlayerKeyboardShortcut) {
      keyboardListener?.(event);
    },
    hasKeyboardListener: () => keyboardListener !== undefined,
  };
}

function AudioHarness({
  input,
  memory,
  media,
  guard,
  keyboardEvents,
}: {
  input: AudioPlayerInput;
  memory: PlaybackPositionMemoryPort;
  media: AudioPlaybackMediaPort;
  guard: AudioPlayerShortcutGuardPort;
  keyboardEvents: AudioPlayerKeyboardEventsPort;
}) {
  const model = useAudioPlaybackSession(input, memory, media, guard, keyboardEvents);
  return (
    <audio
      ref={model.actions.attachAudioElement}
      data-testid="audio"
      loop={model.playback.loop}
      onLoadedMetadata={model.actions.onLoadedMetadata}
      onTimeUpdate={model.actions.onTimeUpdate}
      onPlay={model.actions.onPlay}
      onPause={model.actions.onPause}
    />
  );
}

function makeInput(overrides: Partial<AudioPlayerInput> = {}): AudioPlayerInput {
  return { url: resourceUrl, playbackSource: sourceScope, ...overrides };
}

function makeMemory(read = vi.fn(() => 42)) {
  return {
    read,
    save: vi.fn(),
  } satisfies PlaybackPositionMemoryPort;
}

function makeMediaPort() {
  const state = { currentTime: 0, duration: 0, paused: true, volume: 1 };
  const port: AudioPlaybackMediaPort = {
    load: vi.fn(),
    play: vi.fn(() => { state.paused = false; return playMedia(); }),
    pause: vi.fn(() => { state.paused = true; pauseMedia(); }),
    isPaused: () => state.paused,
    currentTime: () => state.currentTime,
    duration: () => state.duration,
    setCurrentTime: (_element, seconds) => { state.currentTime = seconds; },
    setVolume: (_element, volume) => { state.volume = volume; },
  };
  return { port, state };
}

beforeEach(() => {
  playMedia = vi.fn(() => Promise.resolve());
  pauseMedia = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAudioPlaybackSession', () => {
  it('restores scoped progress, saves playback updates, and pauses on cleanup', () => {
    const memory = makeMemory();
    const media = makeMediaPort();
    const keyboardEvents = makeKeyboardEvents();
    const guard = { shouldIgnoreAudioPlaybackShortcuts: () => false };
    const { unmount } = render(
      <AudioHarness input={makeInput()} memory={memory} media={media.port} guard={guard} keyboardEvents={keyboardEvents.port} />,
    );
    const audio = screen.getByTestId('audio') as HTMLAudioElement;
    media.state.duration = 180;

    fireEvent.loadedMetadata(audio);
    expect(media.state.currentTime).toBe(42);
    expect(memory.read).toHaveBeenCalledWith(resourceUrl, sourceScope);

    media.state.currentTime = 82;
    fireEvent.timeUpdate(audio);
    expect(memory.save).toHaveBeenCalledWith(resourceUrl, 82, sourceScope);

    unmount();
    expect(memory.save).toHaveBeenLastCalledWith(resourceUrl, 82, sourceScope);
    expect(pauseMedia).toHaveBeenCalledOnce();
  });

  it('delegates shortcuts through the keyboard-events and modal-guard ports', () => {
    const memory = makeMemory(vi.fn(() => 0));
    const media = makeMediaPort();
    const keyboardEvents = makeKeyboardEvents();
    const shouldIgnoreAudioPlaybackShortcuts = vi.fn(() => false);
    const guard = { shouldIgnoreAudioPlaybackShortcuts };
    const previous = vi.fn();
    const next = vi.fn();
    const { unmount } = render(
      <AudioHarness
        input={makeInput({ canPrev: true, canNext: true, onPrev: previous, onNext: next })}
        memory={memory}
        media={media.port}
        guard={guard}
        keyboardEvents={keyboardEvents.port}
      />,
    );
    const preventDefault = vi.fn();

    expect(keyboardEvents.hasKeyboardListener()).toBe(true);
    keyboardEvents.sendShortcut({ code: 'Space', key: ' ', targetIsEditable: true, preventDefault });
    keyboardEvents.sendShortcut({ code: 'Space', key: ' ', targetIsEditable: false, preventDefault });
    keyboardEvents.sendShortcut({ code: 'ArrowLeft', key: 'ArrowLeft', targetIsEditable: false, preventDefault });
    keyboardEvents.sendShortcut({ code: 'ArrowRight', key: 'ArrowRight', targetIsEditable: false, preventDefault });

    expect(shouldIgnoreAudioPlaybackShortcuts).toHaveBeenCalledTimes(4);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(playMedia).toHaveBeenCalledOnce(); // initial autoplay; Space pauses the now-playing track
    expect(pauseMedia).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();

    shouldIgnoreAudioPlaybackShortcuts.mockReturnValue(true);
    keyboardEvents.sendShortcut({ code: 'Space', key: ' ', targetIsEditable: false, preventDefault });
    expect(pauseMedia).toHaveBeenCalledOnce();

    unmount();
    expect(keyboardEvents.hasKeyboardListener()).toBe(false);
    expect(pauseMedia).toHaveBeenCalledTimes(2); // stop the current audio on session cleanup
  });
});
