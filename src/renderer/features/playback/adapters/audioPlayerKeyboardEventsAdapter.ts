import type { AudioPlayerKeyboardEventsPort, AudioPlayerKeyboardShortcut } from '../application/audioPlayerPorts';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
}

function toShortcut(event: KeyboardEvent): AudioPlayerKeyboardShortcut {
  return {
    code: event.code,
    key: event.key,
    targetIsEditable: isEditableTarget(event.target),
    preventDefault: () => event.preventDefault(),
  };
}

export const audioPlayerKeyboardEventsAdapter: AudioPlayerKeyboardEventsPort = {
  subscribeKeyboardShortcuts(listener) {
    const onKeyDown = (event: KeyboardEvent) => listener(toShortcut(event));
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  },
};
