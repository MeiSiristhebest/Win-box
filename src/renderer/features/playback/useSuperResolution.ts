import { useCallback, useEffect, useState } from 'react';
import { client } from '../../api/client';
import type { SrState } from '../../../shared/plugin';
import type { SrMode } from '../../../shared/player';

export function useSuperResolution(active: boolean) {
  const [info, setInfo] = useState<SrState | null>(null);
  const [mode, setMode] = useState<SrMode>('off');
  const [panel, setPanel] = useState({ active, open: false });
  if (panel.active !== active) setPanel({ active, open: false });
  const open = panel.active === active && panel.open;
  const setOpen = useCallback((open: boolean) => setPanel({ active, open }), [active]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void client.pluginSr().then(value => {
      if (alive) { setInfo(value); setMode((value.mode as SrMode) || 'off'); }
    }).catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [active]);
  const apply = useCallback((value: SrMode) => {
    setMode(value);
    void client.playerPrefsSet({ srMode: value }).catch(() => undefined);
    void client.mpvCmd({ type: 'sr-mode', value }).catch(() => undefined);
  }, []);
  return { info, mode, open, setOpen, apply };
}
