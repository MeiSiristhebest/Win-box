import { useCallback, useEffect, useRef, useState } from 'react';
import { reduceSkipSegmentsDraft, type SkipSegmentsDraft, type SkipSegmentsDraftCommand } from './application/skipSegmentsDraft';
import { clampSeconds, putSkipRecord, resolveSkip, type SkipSeg } from './application/skipSegments';
import type { SkipSegmentsControllerPorts, SkipSegmentsTimerHandle } from './application/skipSegmentsControllerPorts';

export interface SkipSegmentsMenu {
  x: number;
  y: number;
  t: number;
}

interface UseSkipSegmentsControllerOptions {
  resourceKey?: string;
  episodeKey?: string;
  episodeLabel?: string;
  resourceName?: string;
  isLive: boolean;
}

export function useSkipSegmentsController({
  resourceKey,
  episodeKey,
  episodeLabel,
  resourceName,
  isLive,
}: UseSkipSegmentsControllerOptions, ports: SkipSegmentsControllerPorts) {
  const skipResourceKey = (resourceKey || '').trim();
  const skipEpisodeKey = (episodeKey || '').trim();
  const skipEpisodeLabel = (episodeLabel || '').trim();
  const usable = !!skipResourceKey && !!skipEpisodeKey && !isLive;

  const [segments, setSegments] = useState<SkipSeg>({ intro: 0, outro: 0 });
  const [inheritedFrom, setInheritedFrom] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [menu, setMenu] = useState<SkipSegmentsMenu | null>(null);
  const [toast, setToast] = useState('');
  const [draft, setDraft] = useState<SkipSegmentsDraft>({ intro: '', outro: '' });
  const segmentsRef = useRef<SkipSeg>({ intro: 0, outro: 0 });
  const introFiredRef = useRef(false);
  const outroFiredRef = useRef(false);
  const toastTimerRef = useRef<SkipSegmentsTimerHandle | null>(null);
  const menuElementRef = useRef<HTMLDivElement>(null);

  const dispatchDraftCommand = useCallback((command: SkipSegmentsDraftCommand) => {
    setDraft((current) => reduceSkipSegmentsDraft(current, command));
  }, []);

  useEffect(() => {
    if (!skipResourceKey || !skipEpisodeKey) {
      segmentsRef.current = { intro: 0, outro: 0 };
      // oxlint-disable-next-line react/set-state-in-effect -- Reset settings when the source identity is absent.
      setSegments({ intro: 0, outro: 0 });
      setInheritedFrom(null);
      setDraft({ intro: '', outro: '' });
      return;
    }
    const resolved = resolveSkip(ports.memory.read(), skipResourceKey, skipEpisodeKey);
    const next = resolved ? resolved.seg : { intro: 0, outro: 0 };
    segmentsRef.current = next;
    // Reloads the external per-episode storage snapshot after the source identity changes.
    // oxlint-disable-next-line react/set-state-in-effect -- Reload persisted settings after the selected episode changes.
    setSegments(next);
    setInheritedFrom(resolved ? resolved.inheritedFrom : null);
    setDraft({ intro: next.intro ? String(next.intro) : '', outro: next.outro ? String(next.outro) : '' });
    introFiredRef.current = false;
    outroFiredRef.current = false;
  }, [skipResourceKey, skipEpisodeKey, ports.memory]);

  useEffect(() => {
    if (!menu) return;
    return ports.menuDismissal.subscribe(() => menuElementRef.current, () => setMenu(null));
  }, [menu, ports.menuDismissal]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current !== null) ports.scheduler.cancel(toastTimerRef.current);
    toastTimerRef.current = ports.scheduler.schedule(() => {
      toastTimerRef.current = null;
      setToast('');
    }, 2500);
  }, [ports.scheduler]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) ports.scheduler.cancel(toastTimerRef.current);
    },
    [ports.scheduler],
  );

  const commit = useCallback((intro: number, outro: number) => {
    if (!usable) return;
    const previous = segmentsRef.current;
    const next = { intro: clampSeconds(intro), outro: clampSeconds(outro) };
    ports.memory.save(
      putSkipRecord(ports.memory.read(), skipResourceKey, skipEpisodeKey, next, skipEpisodeLabel || resourceName || '', ports.clock.now()),
    );
    segmentsRef.current = next;
    setSegments(next);
    setInheritedFrom(null);
    if (next.intro !== previous.intro) introFiredRef.current = false;
    if (next.outro !== previous.outro) outroFiredRef.current = false;
    setDraft({ intro: next.intro ? String(next.intro) : '', outro: next.outro ? String(next.outro) : '' });
  }, [usable, skipResourceKey, skipEpisodeKey, skipEpisodeLabel, resourceName, ports.memory, ports.clock]);

  const saveDraft = useCallback(() => {
    commit(clampSeconds(draft.intro), clampSeconds(draft.outro));
    showToast('已保存本集跳过设置');
  }, [commit, showToast, draft]);

  const captureIntroFromMenu = useCallback((): number | undefined => {
    if (!menu) return undefined;
    const intro = menu.t;
    commit(intro, segmentsRef.current.outro);
    setMenu(null);
    return intro;
  }, [commit, menu]);

  const captureOutroFromMenu = useCallback((duration: number): number | undefined => {
    if (!menu || !Number.isFinite(duration)) return undefined;
    const outro = Math.max(0, Math.round(duration - menu.t));
    commit(segmentsRef.current.intro, outro);
    setMenu(null);
    return outro;
  }, [commit, menu]);

  const clearSegments = useCallback(() => commit(0, 0), [commit]);
  const clearFromMenu = useCallback(() => {
    clearSegments();
    setMenu(null);
  }, [clearSegments]);
  const dismissMenu = useCallback(() => setMenu(null), []);

  return {
    segments,
    inheritedFrom,
    panelOpen,
    setPanelOpen,
    menu,
    setMenu,
    toast,
    draft,
    dispatchDraftCommand,
    segmentsRef,
    introFiredRef,
    outroFiredRef,
    menuElementRef,
    usable,
    showToast,
    commit,
    saveDraft,
    captureIntroFromMenu,
    captureOutroFromMenu,
    clearSegments,
    clearFromMenu,
    dismissMenu,
  };
}
