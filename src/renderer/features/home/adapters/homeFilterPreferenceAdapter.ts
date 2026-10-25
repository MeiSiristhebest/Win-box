import { useCallback } from 'react';
import { setHomeFilters, useHomeFilters } from '../../../lib/uiPrefs';

/** Bridges the persisted home-filter preference into the HomePage composition root. */
export function useHomeFilterPanelPreference(): { isOpen: boolean; toggle: () => void } {
  const isOpen = useHomeFilters();
  const toggle = useCallback(() => setHomeFilters(!isOpen), [isOpen]);
  return { isOpen, toggle };
}
