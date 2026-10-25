import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { Kernel, KernelPref } from '../../lib/kernel';
import { createPlayerKernelTransitions, type PlayerKernelTransitionPorts } from './application/playerKernelTransitions';

/** React lifecycle adapter for the framework-independent kernel transition use case. */
export function usePlayerKernelTransitions(url: string, progressKey: string, ports: PlayerKernelTransitionPorts) {
  const latest = useRef(ports);
  useLayoutEffect(() => { latest.current = ports; });
  const controller = useRef<ReturnType<typeof createPlayerKernelTransitions> | null>(null);
  useLayoutEffect(() => {
    const transitions = createPlayerKernelTransitions({
      window: {
        documentFullscreen: () => latest.current.window.documentFullscreen(),
        exitFullscreen: (mode) => latest.current.window.exitFullscreen(mode),
      },
      snapshot: () => latest.current.snapshot(),
      releaseTemporaryRate: () => latest.current.releaseTemporaryRate(),
      clearAutoNext: () => latest.current.clearAutoNext(),
      retryPluginEngine: () => latest.current.retryPluginEngine(),
      stageHandoff: (handoff, settings) => latest.current.stageHandoff(handoff, settings),
      activateKernel: (kernel) => latest.current.activateKernel(kernel),
      rememberPreference: (preference) => latest.current.rememberPreference(preference),
    });
    controller.current = transitions;
    return () => { transitions.cancel(); controller.current = null; };
  }, []);
  useLayoutEffect(() => () => controller.current?.cancel(), [url, progressKey]);
  const switchKernel = useCallback((target: Kernel, persist = true, preference: KernelPref = target) =>
    controller.current?.switchKernel(target, persist, preference) ?? false, []);
  const recoverWithKernel = useCallback((target: Kernel) => controller.current?.recoverWithKernel(target) ?? false, []);
  const recoverHtmlPlayback = useCallback(() => controller.current?.recoverHtmlPlayback() ?? false, []);
  const cancel = useCallback(() => controller.current?.cancel(), []);
  return useMemo(() => ({ switchKernel, recoverWithKernel, recoverHtmlPlayback, cancel }), [switchKernel, recoverWithKernel, recoverHtmlPlayback, cancel]);
}
