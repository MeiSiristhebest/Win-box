// tests/sourceComparison.spec.ts
import { describe, expect, it } from 'vitest';
import type { AggVodItem, SearchPerSource } from '../src/shared/types';
import {
  evaluateSourceQuality,
  extractClarityTag,
  extractCompletenessScore,
  rankSourcesWithComparison,
} from '../src/engine/vod/sourceComparison';

const makeItem = (name: string, remarks: string, key = 'src', profileId = 'p1', tag?: string): AggVodItem => ({
  id: name,
  name,
  pic: '',
  remarks,
  year: '2024',
  area: '大陆',
  type: '剧情',
  sourceKey: key,
  sourceRef: { profileId, key },
  sourceName: key,
  sourceProfileName: profileId,
  sameFromOtherSources: 0,
  tag,
});

describe('sourceComparison', () => {
  it('extracts clarity tags and scores accurately', () => {
    expect(extractClarityTag('庆余年 4K超高清')).toEqual({ tag: '4K', score: 40 });
    expect(extractClarityTag('狂飙 1080P国语')).toEqual({ tag: '1080P', score: 30 });
    expect(extractClarityTag('繁花 蓝光原盘')).toEqual({ tag: '1080P', score: 30 });
    expect(extractClarityTag('甄嬛传 720P高清')).toEqual({ tag: '720P', score: 20 });
    expect(extractClarityTag('未知清晰度')).toEqual({ score: 15 });
  });

  it('evaluates completeness score from remarks', () => {
    expect(extractCompletenessScore('全30集')).toEqual({ isComplete: true, score: 20 });
    expect(extractCompletenessScore('已完结')).toEqual({ isComplete: true, score: 20 });
    expect(extractCompletenessScore('更新至第24集')).toEqual({ isComplete: false, score: 12 });
  });

  it('penalizes cam and tc releases', () => {
    const cam = makeItem('流浪地球2', '抢先TC清晰版');
    const normal = makeItem('流浪地球2', '4K完整版');
    const camEval = evaluateSourceQuality(cam, 200);
    const normalEval = evaluateSourceQuality(normal, 200);
    expect(camEval.isCamOrTc).toBe(true);
    expect(camEval.totalScore).toBeLessThan(normalEval.totalScore);
  });

  it('identifies top recommended source among competing candidates', () => {
    const fast4k = makeItem('庆余年', '4K已完结', 'fast-source', 'p1');
    const slowHd = makeItem('庆余年', '720P更新至10集', 'slow-source', 'p1');
    const cam = makeItem('庆余年', 'TC抢先版', 'cam-source', 'p1');

    const perSource: SearchPerSource[] = [
      { profileId: 'p1', key: 'fast-source', name: '快源', status: 'ok', ms: 180 },
      { profileId: 'p1', key: 'slow-source', name: '慢源', status: 'ok', ms: 2200 },
      { profileId: 'p1', key: 'cam-source', name: 'TC源', status: 'ok', ms: 100 },
    ];

    const results = rankSourcesWithComparison([fast4k, slowHd, cam], perSource);
    expect(results).toHaveLength(3);
    const top = results.find((r) => r.comparison.isTopRecommended);
    expect(top).toBeDefined();
    expect(top?.item.sourceKey).toBe('fast-source');
    expect(top?.comparison.clarityTag).toBe('4K');
    expect(top?.comparison.latencyMs).toBe(180);
  });
});
