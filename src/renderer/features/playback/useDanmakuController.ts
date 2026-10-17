import { useEffect, useRef, useState } from 'react';
import { animeTitleForQuery, extractEp, normalizeTitle } from '../../../engine/subtitle/normalizeQuery';
import { parseDanmakuResponse } from '../../../engine/danmaku/parseDanmakuXml';
import { episodeFieldFromName, formatCandidateLabel, parseEpisodeInput } from '../../../engine/danmaku/normalizeQuery';
import { seasonOf, sortCandidatesByEp } from '../../../engine/danmaku/endpoints';
import { client } from '../../api/client';
import {
  DEFAULT_DANMAKU_SETTINGS,
  type DanmakuCandidate,
  type DanmakuItem,
  type DanmakuSettings,
} from '../../../shared/danmaku';
import { orderCandidatesForEpisode, searchDanmakuCandidates } from './danmakuSearch';

const MAX_DM_TRY = 5;
const DM_TRY_BUDGET_MS = 60_000;
const DM_RICH_ENOUGH = 40;
const DM_THIN = 10;

function invalidateGeneration(generation: { current: number }): void {
  generation.current += 1;
}

interface UseDanmakuControllerArgs {
  url: string;
  resourceName?: string;
  danmakuTitle?: string;
  formatTime: (seconds: number) => string;
}

export function useDanmakuController({
  url,
  resourceName,
  danmakuTitle,
  formatTime,
}: UseDanmakuControllerArgs) {
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<DanmakuSettings>({ ...DEFAULT_DANMAKU_SETTINGS });
  const [items, setItems] = useState<DanmakuItem[]>([]);
  const [candidates, setCandidates] = useState<DanmakuCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [activeEpisodeId, setActiveEpisodeId] = useState<number | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [episode, setEpisode] = useState('');
  const queryEditedRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!queryEditedRef.current) {
      const clean = danmakuTitle?.trim() || normalizeTitle(resourceName || '') || (resourceName || '').trim();
      setQuery(clean);
    }
    setEpisode(episodeFieldFromName(resourceName || ''));
  }, [resourceName, danmakuTitle]);

  useEffect(() => {
    client.danmakuGet().then((value: DanmakuSettings) => {
      setSettings(value);
      setEnabled(value.enabled);
      setSettingsLoaded(true);
    }).catch(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    void client.danmakuSet({ ...settings, enabled }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, enabled, settingsLoaded]);

  useEffect(() => {
    generationRef.current++;
    setItems([]);
    setActiveEpisodeId(null);
    setMessage('');
    setCandidates([]);
    setSearching(false);
    return () => {
      invalidateGeneration(generationRef);
    };
  }, [url]);

  const fetchItems = async (candidate: DanmakuCandidate): Promise<DanmakuItem[]> => {
    const xml = await client.danmakuFetch(candidate.episodeId, candidate.source);
    return parseDanmakuResponse(xml || '');
  };

  const showDanmaku = (candidate: DanmakuCandidate, nextItems: DanmakuItem[], hint?: string) => {
    setItems(nextItems);
    setActiveEpisodeId(candidate.episodeId);
    setEnabled(true);
    const times = nextItems.map((item) => item.time);
    const minTime = times.length ? Math.min(...times) : 0;
    const maxTime = times.length ? Math.max(...times) : 0;
    const base = nextItems.length
      ? `已加载 ${nextItems.length} 条弹幕（${candidate.sourceName} · ${formatCandidateLabel(candidate.title, candidate.episodeTitle, candidate.episodeNumber)}）${maxTime > 0 ? ` · 时段 ${formatTime(minTime)}~${formatTime(maxTime)}` : ''}`
      : `「${candidate.sourceName}」该剧集暂无弹幕`;
    setMessage(
      hint
        ? `${base}；${hint}`
        : nextItems.length
          ? `${base}；不同步可用「时间」±30s 校准`
          : base,
    );
  };

  const applyCandidate = async (candidate: DanmakuCandidate) => {
    const generation = ++generationRef.current;
    setSearching(true);
    setMessage('');
    try {
      const nextItems = await fetchItems(candidate);
      if (generation !== generationRef.current) return;
      showDanmaku(candidate, nextItems);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setMessage((error as Error).message || '弹幕加载失败');
    } finally {
      if (generation === generationRef.current) setSearching(false);
    }
  };

  const matchDanmaku = async (searchText: string, episodeInput?: string, options?: { fresh?: boolean }) => {
    const name = searchText.trim();
    if (!name) {
      setMessage('请填写要搜索的剧名');
      return;
    }
    const generation = ++generationRef.current;
    setSearching(true);
    setMessage('');
    setCandidates([]);
    const parsedEpisode = parseEpisodeInput(episodeInput || '');
    const season = parsedEpisode.season
      ?? seasonOf(episodeInput || '')
      ?? seasonOf(resourceName || '')
      ?? seasonOf(danmakuTitle || '')
      ?? seasonOf(name);
    const targetEpisode = parsedEpisode.ep || extractEp(resourceName || '');
    try {
      const list = await searchDanmakuCandidates(name, season, targetEpisode, !!options?.fresh);
      if (generation !== generationRef.current) return;
      setCandidates(sortCandidatesByEp(list || []));
      if (!list || !list.length) {
        setMessage('未找到匹配剧集——试试更常见的剧名写法（去掉特殊符号/集号/括号）；也可在「弹幕源」里开启更多接口');
        return;
      }
      const attempts = orderCandidatesForEpisode(list, targetEpisode).slice(0, MAX_DM_TRY);
      const deadline = Date.now() + DM_TRY_BUDGET_MS;
      let best: { candidate: DanmakuCandidate; items: DanmakuItem[] } | null = null;
      for (let index = 0; index < attempts.length; index++) {
        const candidate = attempts[index];
        if (generation !== generationRef.current) return;
        if (index > 0) {
          if (Date.now() >= deadline || (best && best.items.length >= DM_RICH_ENOUGH)) break;
          setMessage(
            `「${candidate.sourceName}」弹幕偏少（${best ? best.items.length : 0} 条），继续尝试其它来源（${index + 1}/${attempts.length}）…`,
          );
        }
        let nextItems: DanmakuItem[] = [];
        try {
          nextItems = await fetchItems(candidate);
        } catch {
          nextItems = [];
        }
        if (generation !== generationRef.current) return;
        if (!best || nextItems.length > best.items.length) best = { candidate, items: nextItems };
        if (best.items.length >= DM_RICH_ENOUGH) break;
      }
      if (best && best.items.length) {
        showDanmaku(
          best.candidate,
          best.items,
          best.items.length < DM_THIN
            ? '数量偏少，可能匹配到了花絮/预告，可在下方候选列表换个来源'
            : undefined,
        );
      } else {
        setMessage(`已尝试 ${attempts.length} 个来源均无弹幕——可在候选列表手动点选其它剧集，或换个剧名`);
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      setMessage((error as Error).message || '弹幕匹配失败');
    } finally {
      if (generation === generationRef.current) setSearching(false);
    }
  };

  const toggle = () => {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    if (!nextEnabled) return;
    const title = query.trim() || animeTitleForQuery(resourceName || danmakuTitle || '', danmakuTitle || '');
    if (title) void matchDanmaku(title, episode);
    else setMessage('弹幕已开启：请到弹幕面板输入剧名后点「匹配弹幕」');
  };

  const updateQuery = (value: string) => {
    queryEditedRef.current = true;
    setQuery(value);
  };

  return {
    enabled,
    setEnabled,
    settings,
    setSettings,
    items,
    candidates,
    searching,
    message,
    activeEpisodeId,
    sourcesOpen,
    setSourcesOpen,
    customText,
    setCustomText,
    query,
    updateQuery,
    episode,
    setEpisode,
    matchDanmaku,
    applyCandidate,
    toggle,
  };
}
