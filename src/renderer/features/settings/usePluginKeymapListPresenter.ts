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
  const sessionRef = useRef<{ active: boolean } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    const request = ++requestId.current;
    setModel(previous => ({ ...previous, status: 'loading', error: undefined }));
    try {
      const items = await port.listKeymaps();
      if (session?.active && session === sessionRef.current && request === requestId.current) setModel({ status: 'ready', items });
    } catch (error) {
      if (session?.active && session === sessionRef.current && request === requestId.current) {
        setModel(previous => ({ ...previous, status: 'failed', error: errorMessage(error) }));
      }
    }
  }, [port]);

  useEffect(() => {
    if (!active) return;
    const session = { active: true };
    sessionRef.current = session;
    const request = ++requestId.current;
    void port.listKeymaps().then(items => {
      if (session.active && session === sessionRef.current && request === requestId.current) setModel({ status: 'ready', items });
    }).catch(error => {
      if (session.active && session === sessionRef.current && request === requestId.current) {
        setModel(previous => ({ ...previous, status: 'failed', error: errorMessage(error) }));
      }
    });
    return () => { session.active = false; };
  }, [active, port]);

  const visibleModel = active && model.status === 'idle' ? { ...model, status: 'loading' as const } : model;
  return { model: visibleModel, reload };
}
