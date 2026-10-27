import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useAnchoredPanel } from './useAnchoredPanel';
import { isNativeModalOpen } from '../lib/modalScope';

interface SourcePickerOverlayOptions {
  variant: 'pill' | 'sidebar';
  disabled?: boolean;
}

/** Reusable DOM and overlay behavior for the subscriptions source picker. */
export function useSourcePickerOverlay({ variant, disabled = false }: SourcePickerOverlayOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const keyboardInteraction = useRef(false);
  const leaveTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const panelId = useId();
  const panelPosition = useAnchoredPanel(open, triggerRef, panelRef, 420, variant === 'sidebar' ? 'top' : 'bottom');

  const cancelLeave = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(previous => previous ? false : previous);
  }, []);

  const close = useCallback((restoreFocus = false) => {
    cancelLeave();
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, [cancelLeave]);

  const reopen = useCallback(() => {
    cancelLeave();
    setClosing(false);
    setOpen(true);
  }, [cancelLeave]);

  const toggle = useCallback((event: ReactMouseEvent<HTMLButtonElement>, onOpen: () => void) => {
    keyboardInteraction.current = event.detail === 0;
    if (disabled) return;
    cancelLeave();
    if (!open) {
      onOpen();
      setQuery('');
    }
    setOpen(!open);
  }, [cancelLeave, disabled, open]);

  const scheduleLeave = useCallback(() => {
    if (!open) return;
    if (keyboardInteraction.current && (wrapRef.current?.contains(document.activeElement) || panelRef.current?.contains(document.activeElement))) return;
    cancelLeave();
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false);
        setClosing(false);
      }, 280);
    }, 3000);
  }, [cancelLeave, open]);

  const onWrapperBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextTarget) && !panelRef.current?.contains(nextTarget)) close();
  }, [close]);

  const onSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>, onEnter: () => void) => {
    keyboardInteraction.current = true;
    cancelLeave();
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) onEnter();
  }, [cancelLeave]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isNativeModalOpen()) return;
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [close, open]);

  useEffect(() => () => {
    if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
  }, []);

  return {
    open,
    query,
    setQuery,
    closing,
    inputRef,
    triggerRef,
    panelRef,
    wrapRef,
    panelId,
    panelPosition,
    toggle,
    close,
    closeToTrigger: () => close(true),
    reopen,
    cancelLeave,
    scheduleLeave,
    onWrapperBlur,
    onSearchKeyDown,
  };
}
