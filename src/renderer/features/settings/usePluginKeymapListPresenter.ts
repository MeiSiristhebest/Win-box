import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeymapView } from '../../../shared/plugin';
import type { PluginKeymapListPort } from './application/settingsSectionPorts';

export type PluginKeymapLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface PluginKeymapListModel {
  status: PluginKeymapLoadStatus;
  items: KeymapView[];
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads the read-only plugin shortcut snapshot and ignores responses from inactive views. */
export function usePluginKeymapListPresenter(active: boolean, port: PluginKeymapListPort) {
  const [model, setModel] = useState<PluginKeymapListModel>({ status: 'idle', items: [] });
  const requestId = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const request = ++requestId.current;
    setModel(previous => ({ ...previous, status: 'loading', error: undefined }));
    try {
      const items = await port.listKeymaps();
      if (request === requestId.current) setModel({ status: 'ready', items });
    } catch (error) {
      if (request === requestId.current) {
        setModel(previous => ({ ...previous, status: 'failed', error: errorMessage(error) }));
      }
    }
  }, [port]);

  useEffect(() => {
    if (!active) return;
    void reload();
    return () => { requestId.current++; };
  }, [active, reload]);

  return { model, reload };
}
