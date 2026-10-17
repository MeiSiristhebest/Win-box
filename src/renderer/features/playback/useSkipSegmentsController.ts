import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';
import {
  clampSeconds,
  loadSkipStore,
  persistSkipStore,
  putSkipRecord,
  resolveSkip,
  type SkipSeg,
} from '../../lib/skipSegments';
import type { SkipSegmentsDraft } from './SkipSegmentsControl';

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
}: UseSkipSegmentsControllerOptions) {
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
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!skipResourceKey || !skipEpisodeKey) {
      segmentsRef.current = { intro: 0, outro: 0 };
      // oxlint-disable-next-line react/set-state-in-effect -- Reset settings when the source identity is absent.
      setSegments({ intro: 0, outro: 0 });
      setInheritedFrom(null);
      setDraft({ intro: '', outro: '' });
      return;
    }
    const resolved = resolveSkip(loadSkipStore(), skipResourceKey, skipEpisodeKey);
    const next = resolved ? resolved.seg : { intro: 0, outro: 0 };
    segmentsRef.current = next;
    // Reloads the external per-episode storage snapshot after the source identity changes.
    // oxlint-disable-next-line react/set-state-in-effect -- Reload persisted settings after the selected episode changes.
    setSegments(next);
    setInheritedFrom(resolved ? resolved.inheritedFrom : null);
    setDraft({ intro: next.intro ? String(next.intro) : '', outro: next.outro ? String(next.outro) : '' });
    introFiredRef.current = false;
    outroFiredRef.current = false;
  }, [skipResourceKey, skipEpisodeKey]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      const element = menuElementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (isNativeModalOpen()) return;
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2500);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const commit = useCallback((intro: number, outro: number) => {
    if (!usable) return;
    const previous = segmentsRef.current;
    const next = { intro: clampSeconds(intro), outro: clampSeconds(outro) };
    persistSkipStore(
      putSkipRecord(loadSkipStore(), skipResourceKey, skipEpisodeKey, next, skipEpisodeLabel || resourceName || ''),
    );
    segmentsRef.current = next;
    setSegments(next);
    setInheritedFrom(null);
    if (next.intro !== previous.intro) introFiredRef.current = false;
    if (next.outro !== previous.outro) outroFiredRef.current = false;
    setDraft({ intro: next.intro ? String(next.intro) : '', outro: next.outro ? String(next.outro) : '' });
    console.info(`[skip] 本集记录已更新：片头 ${next.intro}s · 片尾 ${next.outro}s（${skipEpisodeLabel || skipEpisodeKey}）`);
  }, [usable, skipResourceKey, skipEpisodeKey, skipEpisodeLabel, resourceName]);

  const saveDraft = useCallback(() => {
    commit(clampSeconds(draft.intro), clampSeconds(draft.outro));
    showToast('已保存本集跳过设置');
  }, [commit, showToast, draft]);

  return {
    segments,
    inheritedFrom,
    panelOpen,
    setPanelOpen,
    menu,
    setMenu,
    toast,
    draft,
    setDraft,
    segmentsRef,
    introFiredRef,
    outroFiredRef,
    menuElementRef,
    usable,
    showToast,
    commit,
    saveDraft,
  };
}
