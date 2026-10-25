import { isNativeModalOpen } from '../../../lib/modalScope';
import type { PlayerKeyboardShortcutEvent, PlayerKeyboardShortcutsPorts } from '../application/playerKeyboardShortcuts';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

function toShortcutEvent(event: KeyboardEvent): PlayerKeyboardShortcutEvent {
  return {
    key: event.key,
    repeat: event.repeat,
    targetIsEditable: isEditableTarget(event.target),
    preventDefault: () => event.preventDefault(),
  };
}

export const playerKeyboardShortcutsAdapter: PlayerKeyboardShortcutsPorts = {
  events: {
    subscribe(listeners) {
      const onKeyDown = (event: KeyboardEvent) => listeners.onKeyDown(toShortcutEvent(event));
      const onKeyUp = (event: KeyboardEvent) => listeners.onKeyUp(toShortcutEvent(event));
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', listeners.onWindowBlur);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', listeners.onWindowBlur);
      };
    },
  },
  scheduler: {
    scheduleInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
    cancelInterval: (timer) => window.clearInterval(timer as number),
    scheduleTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    cancelTimeout: (timer) => window.clearTimeout(timer as number),
  },
  modalGuard: { hasBlockingModal: isNativeModalOpen },
};
