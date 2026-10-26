import { useCallback, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PlaybackRateControlModel } from './presentation/PlayerControlModels';
import { nextPlayerRateMenuFocusIndex } from './application/playerRateMenuNavigation';
import { usePlaybackPopupKeyboard } from './usePlaybackPopupKeyboard';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Owns the rate-menu interaction lifecycle; the corresponding view only renders its model. */
export function usePlayerRateControlPresenter({ rate, onRateChange }: PlaybackRateControlModel) {
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);
  const popup = usePlaybackPopupKeyboard(open, onOpen, onClose);

  const onPointerEnter = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') onOpen();
  }, [onOpen]);

  const onMenuKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextPlayerRateMenuFocusIndex(event.key, current, options.length);
    if (next === null) return;
    event.preventDefault();
    options[next]?.focus();
  }, []);

  const onSelect = useCallback((value: number) => {
    onRateChange(value);
    onClose();
    popup.triggerRef.current?.focus();
  }, [onRateChange, onClose, popup.triggerRef]);

  return {
    rate,
    open,
    panelId: popup.panelId,
    triggerRef: popup.triggerRef,
    options: PLAYBACK_RATES.map((value) => ({ value, selected: rate === value })),
    onPointerEnter,
    onPointerLeave: popup.onPointerLeave,
    onBlur: popup.onBlur,
    onTriggerKeyDown: popup.onKeyDown,
    onMenuKeyDown,
    onOpen,
    onSelect,
  };
}
