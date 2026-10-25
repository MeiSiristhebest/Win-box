import { isNativeModalOpen } from '../../../lib/modalScope';
import { decodeSkipStore, mergeSkipStores, type SkipStore } from '../application/skipSegments';
import type { SkipSegmentsControllerPorts } from '../application/skipSegmentsControllerPorts';

const storageKey = 'winbox-skip-segments';

function readStoredSkipSegments(): SkipStore {
  try {
    const serialized = localStorage.getItem(storageKey);
    return serialized ? decodeSkipStore(JSON.parse(serialized) as unknown) : {};
  } catch {
    return {};
  }
}

export const skipSegmentsControllerAdapter: SkipSegmentsControllerPorts = {
  memory: {
    read: readStoredSkipSegments,
    save(store) {
      try {
        // Merge against the latest snapshot so another app window cannot revive stale records.
        localStorage.setItem(storageKey, JSON.stringify(mergeSkipStores(readStoredSkipSegments(), store)));
      } catch {
        // Storage quota failures must not interrupt playback.
      }
    },
  },
  menuDismissal: {
    subscribe(menuElement, dismiss) {
      const onMouseDown = (event: MouseEvent) => {
        const element = menuElement();
        if (element instanceof Node && event.target instanceof Node && element.contains(event.target)) return;
        dismiss();
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !isNativeModalOpen()) dismiss();
      };

      window.addEventListener('mousedown', onMouseDown, true);
      window.addEventListener('keydown', onKeyDown, true);
      return () => {
        window.removeEventListener('mousedown', onMouseDown, true);
        window.removeEventListener('keydown', onKeyDown, true);
      };
    },
  },
  scheduler: {
    schedule(callback, delayMs) {
      return window.setTimeout(callback, delayMs);
    },
    cancel(timer) {
      window.clearTimeout(timer as number);
    },
  },
  clock: {
    now: () => Date.now(),
  },
};
