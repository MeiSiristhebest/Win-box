import { useCallback, useEffect, type FocusEvent } from 'react';
import { isNativeModalOpen } from '../lib/modalScope';
import { useAnchoredPanel } from './useAnchoredPanel';

/** Owns imperative focus, dismissal and portal positioning for the passive search panel view. */
export function useSearchPanelInteractions(open: boolean, onClose: () => void, interactionId: string) {
  const wrapId = `${interactionId}-wrap`;
  const triggerId = `${interactionId}-trigger`;
  const inputId = `${interactionId}-input`;
  const panelId = `${interactionId}-panel`;
  const panelPosition = useAnchoredPanel(open, triggerId, panelId, 520);
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const panel = document.getElementById(panelId);
    if (!event.currentTarget.contains(event.relatedTarget) && !panel?.contains(event.relatedTarget)) onClose();
  }, [onClose, panelId]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(inputId)?.focus();
    const onDocumentMouseDown = (event: MouseEvent): void => {
      const wrap = document.getElementById(wrapId);
      const panel = document.getElementById(panelId);
      if (!wrap?.contains(event.target as Node) && !panel?.contains(event.target as Node)) onClose();
    };
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (isNativeModalOpen()) return;
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        onClose();
        document.getElementById(triggerId)?.focus();
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [open, onClose, inputId, panelId, triggerId, wrapId]);

  return { wrapId, triggerId, inputId, panelId, panelPosition, onBlur };
}
