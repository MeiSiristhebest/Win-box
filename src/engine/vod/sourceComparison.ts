// src/engine/vod/sourceComparison.ts
// ★ 2026-10-25 冲刺 3（用户要求）：同名源比价决策 —— 测速、清晰度、集数完整度加权评分与「最佳推荐源」标定。
import type { AggVodItem, SearchPerSource } from '../../shared/types';
import { sourceIdentityKey } from './aggSearch';

export interface SourceComparisonScore {
  clarityTag?: string;
  clarityScore: number;
  latencyMs?: number;
  latencyScore: number;
  isComplete: boolean;
  completenessScore: number;
  isCamOrTc: boolean;
  totalScore: number;
  isTopRecommended: boolean;
}

export function extractClarityTag(text: string): { tag?: string; score: number } {
  if (!text) return { score: 10 };
  const s = text.toLowerCase();
  if (/(?:2160p|4k|uhd|原画)/i.test(s)) return { tag: '4K', score: 40 };
  if (/(?:1080p|蓝光|bd|超清|hd中字)/i.test(s)) return { tag: '1080P', score: 30 };
  if (/(?:720p|高清)/i.test(s)) return { tag: '720P', score: 20 };
  if (/(?:标清|普清|sd)/i.test(s)) return { tag: '标清', score: 10 };
  return { score: 15 };
}

export function extractCompletenessScore(text: string): { isComplete: boolean; score: number } {
  if (!text) return { isComplete: false, score: 5 };
  if (/(?:完结|全集|全\s*\d+\s*集|共\s*\d+\s*集)/i.test(text)) {
    return { isComplete: true, score: 20 };
  }
  if (/更新至/i.test(text)) {
    return { isComplete: false, score: 12 };
  }
  return { isComplete: false, score: 8 };
}

export function evaluateSourceQuality(
  item: AggVodItem,
  latencyMs?: number,
): SourceComparisonScore {
  const combinedText = `${item.name} ${item.remarks || ''}`;
  const isCamOrTc = /(?:枪版|tc|抢先|预告|样片)/i.test(combinedText);
  const { tag: clarityTag, score: clarityScore } = extractClarityTag(combinedText);
  const { isComplete, score: completenessScore } = extractCompletenessScore(item.remarks || '');

  let latencyScore = 0;
  if (typeof latencyMs === 'number' && latencyMs > 0) {
    if (latencyMs <= 300) latencyScore = 30;
    else if (latencyMs <= 800) latencyScore = 20;
    else if (latencyMs <= 1800) latencyScore = 10;
    else latencyScore = 5;
  } else {
    latencyScore = 15; // 中立兜底
  }

  const penalty = isCamOrTc ? 40 : 0;
  const totalScore = Math.max(0, clarityScore + latencyScore + completenessScore - penalty);

  return {
    clarityTag,
    clarityScore,
    latencyMs,
    latencyScore,
    isComplete,
    completenessScore,
    isCamOrTc,
    totalScore,
    isTopRecommended: false,
  };
}

export function rankSourcesWithComparison(
  items: readonly AggVodItem[],
  perSource: readonly SearchPerSource[] = [],
): Array<{ item: AggVodItem; comparison: SourceComparisonScore }> {
  const latencyMap = new Map<string, number>();
  for (const s of perSource) {
    if (typeof s.ms === 'number' && s.ms > 0) {
      latencyMap.set(sourceIdentityKey(s.profileId, s.key), s.ms);
    }
  }

  const evaluated = items.map((item) => {
    const latency = latencyMap.get(sourceIdentityKey(item.sourceRef?.profileId, item.sourceKey));
    return {
      item,
      comparison: evaluateSourceQuality(item, latency),
    };
  });

  if (evaluated.length === 0) return [];

  let maxScore = -1;
  for (const entry of evaluated) {
    if (entry.item.tag !== 'folder' && !entry.comparison.isCamOrTc && entry.comparison.totalScore > maxScore) {
      maxScore = entry.comparison.totalScore;
    }
  }

  if (maxScore >= 50) {
    for (const entry of evaluated) {
      if (entry.item.tag !== 'folder' && !entry.comparison.isCamOrTc && entry.comparison.totalScore === maxScore) {
        entry.comparison.isTopRecommended = true;
      }
    }
  }

  return evaluated;
}
