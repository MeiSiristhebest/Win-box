import { useEffect, useId } from 'react';

/** Owns DOM focus for favorite editing while the view remains a passive renderer. */
export function useFavoritesPageInteractions(editingKey: string | null) {
  const titleInputId = useId();

  useEffect(() => {
    if (editingKey) document.getElementById(titleInputId)?.focus();
  }, [editingKey, titleInputId]);

  return { titleInputId };
}
