import { useCallback, useEffect, useState } from 'react';
import type { UiSlotId, UiSlotView } from '../../../shared/plugin';
import type { UiSlotItemView } from '../../../shared/plugin';
import type { PluginSlotPort } from './application/pluginSlots';

export function usePluginSlotPresenter(slot: UiSlotId, port: PluginSlotPort) {
  const [views, setViews] = useState<UiSlotView[]>([]);

  useEffect(() => {
    let active = true;
    void port.load(slot).then((result) => {
      if (active) setViews(result);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [port, slot]);

  const runAction = useCallback((item: UiSlotItemView): void => {
    void port.runAction(item).catch(() => undefined);
  }, [port]);

  return { views, runAction };
}
