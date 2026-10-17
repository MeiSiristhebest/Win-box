import { useCallback, useEffect, useRef, useState } from 'react';

export function usePlayerVolumeController() {
  const [flashVisible, setFlashVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearFlash = useCallback(() => {
    if (flashTimerRef.current !== null) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setFlashVisible(false);
  }, []);

  const flash = useCallback(() => {
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    setFlashVisible(true);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlashVisible(false);
    }, 1000);
  }, []);

  const beginDrag = useCallback(() => setDragging(true), []);
  const endDrag = useCallback(() => {
    setDragging(false);
    const input = inputRef.current;
    if (input && document.activeElement === input) input.blur();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [dragging, endDrag]);

  useEffect(() => () => {
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
  }, []);

  const isOpen = useCallback(
    (hidden: boolean) => !hidden && (hovered || flashVisible || dragging || focused),
    [dragging, flashVisible, focused, hovered],
  );

  return {
    inputRef,
    isOpen,
    setHovered,
    setFocused,
    beginDrag,
    endDrag,
    flash,
    clearFlash,
  };
}
