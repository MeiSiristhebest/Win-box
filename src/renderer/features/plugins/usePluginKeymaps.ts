import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';
import { type KeymapScope, type KeymapView } from '../../../shared/plugin';
import { keymapEventMatches, keymapsFor } from './application/keymapMatching';
import { usePluginKeymapPort } from './PluginKeymapsContext';

/** Load shortcuts through the plugin port, then own only their window-key lifecycle here. */
export function usePluginKeymaps(scope: KeymapScope, run: (keymap: KeymapView) => void): KeymapView[] {
  const port = usePluginKeymapPort();
  const [list, setList] = useState<KeymapView[]>([]);
  const listRef = useRef<KeymapView[]>([]);
  const runRef = useRef(run);
  useLayoutEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    let cancelled = false;
    void port.loadKeymaps()
      .then((all) => {
        if (cancelled) return;
        const inScope = keymapsFor(all, scope);
        listRef.current = inScope;
        setList(inScope);
      })
      .catch(() => undefined);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isNativeModalOpen()) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const matched = listRef.current.find((keymap) => keymapEventMatches(keymap.key, event));
      if (!matched) return;
      event.preventDefault();
      runRef.current(matched);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { cancelled = true; window.removeEventListener('keydown', onKeyDown); };
  }, [port, scope]);
  return list;
}
