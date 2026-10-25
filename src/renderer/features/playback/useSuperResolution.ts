import { useCallback, useEffect, useState } from 'react';
import type { SrState } from '../../../shared/plugin';
import type { SrMode } from '../../../shared/player';
import type { SuperResolutionFeedback, SuperResolutionPort } from './application/superResolutionPort';
import { changeSuperResolutionMode } from './application/superResolutionUseCases';
import { formatSuperResolutionFeedback } from './presentation/superResolutionFeedback';
export type { SuperResolutionFeedback } from './application/superResolutionPort';

export function useSuperResolution(active: boolean, port: SuperResolutionPort) {
  const [info, setInfo] = useState<SrState | null>(null);
  const [mode, setMode] = useState<SrMode>('off');
  const [feedback, setFeedback] = useState<SuperResolutionFeedback | null>(null);
  const [panel, setPanel] = useState({ active, open: false });
  // Reset this transient panel in the same render that changes player session.
  // React retries this component before rendering children, so controls never
  // briefly expose a panel from the previous MPV session.
  if (panel.active !== active) setPanel({ active, open: false });
  const open = panel.active === active && panel.open;
  const setOpen = useCallback((open: boolean) => {
    if (open) setFeedback(null);
    setPanel({ active, open });
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void port.readCapability().then(value => {
      if (alive) { setInfo(value); setMode((value.mode as SrMode) || 'off'); }
    }).catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [active, port]);
  const apply = useCallback(async (value: SrMode) => {
    setFeedback(null);
    const change = await changeSuperResolutionMode(port, value);
    if (change.type !== 'persistence-failed') setMode(change.mode);
    setFeedback(formatSuperResolutionFeedback(change));
  }, [port]);
  return { info, mode, open, setOpen, apply, feedback };
}
