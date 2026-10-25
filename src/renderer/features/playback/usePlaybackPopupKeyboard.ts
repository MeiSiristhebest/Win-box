import { useEffect, useId, useRef, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';

/** Shared keyboard, focus, and pointer-leave behavior for playback popups. */
export function usePlaybackPopupKeyboard(
  open: boolean,
  onOpen: () => void,
  onClose: () => void,
  onLeave = onClose,
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || isNativeModalOpen()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen();
    window.requestAnimationFrame(() => {
      document.getElementById(panelId)?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')?.focus();
    });
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && event.currentTarget.contains(focused) && focused.matches(':focus-visible')) return;
    onLeave();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget) && !document.getElementById(panelId)?.contains(event.relatedTarget)) onClose();
  };
  return { triggerRef, panelId, onKeyDown, onPointerLeave, onBlur };
}
