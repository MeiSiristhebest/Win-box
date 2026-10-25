import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlayerEngineView } from '../../../shared/plugin';
import type { KernelChoice } from './presentation/PlayerControlModels';
export type { KernelChoice } from './presentation/PlayerControlModels';
import type { MpvStatus } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';
import type { PluginPlaybackEnginesPort } from './application/pluginPlaybackEngines';

export function usePluginPlaybackEngines(active: boolean, url: string, mpv: MpvStatus | null, port: PluginPlaybackEnginesPort) {
  const [engines, setEngines] = useState<PlayerEngineView[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState({ url: '', id: '', reason: '' });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let requestSequence = 0;
    const load = () => {
      const request = ++requestSequence;
      void port.loadSnapshot().then(snapshot => {
        if (!alive || request !== requestSequence) return;
        setEngines(snapshot.engines.filter(item => isEngineKernel(item.id)));
        setEnabled({ ...snapshot.enabledEngineIds });
      }).catch(() => undefined);
    };
    load();
    const unsubscribe = port.subscribeToChanges(load);
    return () => { alive = false; requestSequence += 1; unsubscribe(); };
  }, [active, port]);

  const usable = useMemo(() => engines.filter(item => item.ready && enabled[item.id] === true && !(failure.url === url && failure.id === item.id)).map(item => item.id), [engines, enabled, failure, url]);
  const choices = useMemo<KernelChoice[]>(() => [
    { id: 'html5', label: '标准播放', note: '适合常见视频，直接在应用内播放' },
    ...(mpv?.available ? [{ id: 'mpv' as const, label: '兼容播放', note: '标准播放有声无画或格式不支持时尝试；使用 MPV' }] : []),
    ...engines.filter(item => usable.includes(item.id)).map(item => ({ id: item.id as Kernel, label: item.label, note: item.note })),
  ], [mpv, engines, usable]);
  const markFailure = useCallback((id: Kernel, reason: string) => setFailure({ url, id, reason }), [url]);
  const retry = useCallback(() => setFailure({ url: '', id: '', reason: '' }), []);
  return { usable, choices, markFailure, retry, notice: failure.url === url ? '插件内核启动失败：' + failure.reason + '；已回落内置内核' : '' };
}
