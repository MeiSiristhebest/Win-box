import { useCallback, useEffect, useMemo, useState } from 'react';
import { client } from '../../api/client';
import type { PlayerEngineView } from '../../../shared/plugin';
import type { MpvStatus } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';

export interface KernelChoice { id: Kernel; label: string; note?: string }

export function usePluginPlaybackEngines(active: boolean, url: string, mpv: MpvStatus | null) {
  const [engines, setEngines] = useState<PlayerEngineView[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState({ url: '', id: '', reason: '' });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => {
      void Promise.resolve().then(() => client.engineList()).then(items => { if (alive) setEngines(items.filter(item => isEngineKernel(item.id))); }).catch(() => undefined);
      void Promise.resolve().then(() => client.playerPrefsGet()).then(settings => { if (alive) setEnabled(settings.engineEnabled ?? {}); }).catch(() => undefined);
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('winbox:engines-changed', load);
    return () => { alive = false; window.removeEventListener('focus', load); window.removeEventListener('winbox:engines-changed', load); };
  }, [active]);

  const usable = useMemo(() => engines.filter(item => item.ready && enabled[item.id] === true && !(failure.url === url && failure.id === item.id)).map(item => item.id), [engines, enabled, failure, url]);
  const choices = useMemo<KernelChoice[]>(() => [
    { id: 'html5', label: '内置（HTML5）' },
    ...(mpv?.available ? [{ id: 'mpv' as const, label: mpv.source === 'bundled' ? 'MPV（随包）' : mpv.source === 'override' ? 'MPV（自定义）' : 'MPV（本机）', note: mpv.note }] : []),
    ...engines.filter(item => usable.includes(item.id)).map(item => ({ id: item.id as Kernel, label: item.label, note: item.note })),
  ], [mpv, engines, usable]);
  const markFailure = useCallback((id: Kernel, reason: string) => setFailure({ url, id, reason }), [url]);
  const retry = useCallback(() => setFailure({ url: '', id: '', reason: '' }), []);
  return { usable, choices, markFailure, retry, notice: failure.url === url ? '插件内核启动失败：' + failure.reason + '；已回落内置内核' : '' };
}
