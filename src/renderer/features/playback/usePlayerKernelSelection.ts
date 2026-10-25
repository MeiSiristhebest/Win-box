import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MpvStatus } from '../../../shared/player';
import type { Kernel, KernelPref } from '../../lib/kernel';
import { resolvePlayerKernelDecision } from './application/playerKernelDecision';
import type { PlaybackResourceIdentity } from './application/playbackHandoff';
import type { MpvStatusQueryPort } from './application/mpvPlaybackPorts';
import type { PluginPlaybackEnginesPort } from './application/pluginPlaybackEngines';
import { usePluginPlaybackEngines } from './usePluginPlaybackEngines';

interface PlayerKernelSelectionOptions {
  allowMpv: boolean;
  preference: KernelPref;
  url: string;
  progressKey: string;
}

/** Owns kernel availability, compatibility requirements, and automatic selection. */
export function usePlayerKernelSelection({
  allowMpv,
  preference,
  url,
  progressKey,
}: PlayerKernelSelectionOptions, mpvStatusQuery: MpvStatusQueryPort, pluginPlaybackEngines: PluginPlaybackEnginesPort) {
  const [mpvProbe, setMpvProbe] = useState<{ enabled: boolean; status: MpvStatus | null }>({ enabled: false, status: null });
  const mpvInfo = allowMpv && mpvProbe.enabled ? mpvProbe.status : null;
  const [compatibilitySource, setCompatibilitySource] = useState<PlaybackResourceIdentity | null>(null);

  const engines = usePluginPlaybackEngines(allowMpv, url, mpvInfo, pluginPlaybackEngines);
  const requiresCompatibility = !!url && compatibilitySource?.url === url && compatibilitySource.progressKey === progressKey;
  const decision = resolvePlayerKernelDecision({
    allowMpv,
    preference,
    url,
    mpvStatusResolved: mpvInfo !== null,
    mpvAvailable: !!mpvInfo?.available,
    engines: engines.usable,
    requiresCompatibility,
  });
  const selectionKey = `${url}\u0000${allowMpv ? 'mpv' : 'html5'}\u0000${decision.desiredKernel}`;
  const [selection, setSelection] = useState<{ key: string; kernel: Kernel } | null>(null);
  const kernel = selection?.key === selectionKey ? selection.kernel : decision.desiredKernel;
  const setKernel = useCallback((nextKernel: Kernel) => {
    setSelection({ key: selectionKey, kernel: nextKernel });
  }, [selectionKey]);
  const kernelRef = useRef(kernel);
  useLayoutEffect(() => {
    kernelRef.current = kernel;
  }, [kernel]);
  const resolvePreference = (nextPreference: KernelPref): Kernel => resolvePlayerKernelDecision({
    allowMpv,
    preference: nextPreference,
    url,
    mpvStatusResolved: mpvInfo !== null,
    mpvAvailable: !!mpvInfo?.available,
    engines: engines.usable,
    requiresCompatibility,
  }).desiredKernel;

  useEffect(() => {
    if (!allowMpv) return;
    let active = true;
    void mpvStatusQuery.getStatus()
      .then((status) => { if (active) setMpvProbe({ enabled: true, status }); })
      .catch(() => {
        if (active) setMpvProbe({ enabled: true, status: { available: false, path: '', source: 'none', note: '兼容播放组件检测失败' } });
      });
    return () => { active = false; };
  }, [allowMpv, mpvStatusQuery]);

  return {
    mpvInfo,
    kernel,
    setKernel,
    kernelRef,
    engines,
    requiresCompatibility,
    htmlPlaybackReady: decision.htmlPlaybackReady,
    resolvePreference,
    setCompatibilitySource,
  };
}
