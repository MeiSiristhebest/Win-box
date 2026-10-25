import { describe, expect, it } from 'vitest';
import { movieSearchTitle, searchResultView, searchTitleScore } from '../src/engine/vod/searchRelevance';
import { sourceIdentityKey } from '../src/engine/vod/aggSearch';
import type { AggVodItem } from '../src/shared/types';

const item = (name: string, profileId = 'A', key = 'same', id = name): AggVodItem => ({ id, name, pic: '', remarks: '', year: '', area: '', type: '', sourceKey: key, sourceRef: { profileId, key }, sourceName: key, sourceProfileName: profileId, sameFromOtherSources: 0 });

describe('movie search relevance', () => {
  it.each([
    ['《嫁金钗》 第一集 剧集更新1-14', '嫁金钗'],
    ['嫁金钗第十三集更新到1-14集daddads', '嫁金钗'],
    ['嫁金钗14-1', '嫁金钗'],
    ['嫁金钗 全集1-14无删减完整版在线观看', '嫁金钗'],
    ['庆余年 第二季【4K】【国语】', '庆余年 第二季'],
    ['流浪地球2', '流浪地球2'],
    ['2001太空漫游', '2001太空漫游'],
    ['Re：从零开始的异世界生活', 'Re:从零开始的异世界生活'],
    ['武动乾坤之冰心在玉壶', '武动乾坤之冰心在玉壶'],
  ])('cleans release captions without cutting the real title: %s', (input, expected) => expect(movieSearchTitle(input)).toBe(expected));

  it('rejects unrelated source recommendations, but retains decorated title matches', () => {
    expect(searchTitleScore('《嫁金钗》 第一集 剧集更新1-14', '火影忍者 合集')).toBe(0);
    expect(searchTitleScore('嫁金钗', '五等分的新娘')).toBe(0);
    expect(searchTitleScore('嫁金钗', '《嫁金钗》第13集')).toBeGreaterThan(0);
    expect(searchTitleScore('嫁金钗', '嫁金钗')).toBeGreaterThan(searchTitleScore('嫁金钗', '《嫁金钗》第13集'));
  });

  it('does not accept a short English term hidden inside another word', () => {
    expect(searchTitleScore('IT', 'City of Dreams')).toBe(0);
    expect(searchTitleScore('IT', 'It (2017)')).toBeGreaterThan(0);
    expect(searchTitleScore('Spider-Man', 'SPIDER MAN')).toBeGreaterThan(0);
  });

  it('keeps season/sequel specificity', () => {
    expect(searchTitleScore('庆余年 第二季', '庆余年 第一季')).toBe(0);
    expect(searchTitleScore('流浪地球2', '流浪地球')).toBe(0);
  });

  it('matches Chinese titles by Pinyin initials, full Pinyin and season abbreviations', () => {
    expect(searchTitleScore('kb', '狂飙')).toBeGreaterThan(0);
    expect(searchTitleScore('kuangbiao', '狂飙')).toBeGreaterThan(0);
    expect(searchTitleScore('hlm', '红楼梦')).toBeGreaterThan(0);
    expect(searchTitleScore('sgyy', '三国演义')).toBeGreaterThan(0);
    expect(searchTitleScore('frxxz', '凡人修仙传')).toBeGreaterThan(0);
    expect(searchTitleScore('qyn2', '庆余年 第二季')).toBeGreaterThan(0);
    expect(searchTitleScore('qyn2', '庆余年 第一季')).toBe(0);
    expect(searchTitleScore('qyn', '庆余年')).toBeGreaterThan(searchTitleScore('qyn', '庆余年 解说'));
  });

  it('filters by profile and source identity without merging same-key sources', () => {
    const items = [item('嫁金钗', 'A'), item('火影忍者', 'A'), item('嫁金钗', 'B')];
    const view = searchResultView(items, '嫁金钗', { mode: 'related', profileId: 'B', sourceId: sourceIdentityKey('B', 'same') });
    expect(view.items).toEqual([items[2]]);
    expect(view.hiddenCount).toBe(1);
    expect(view.profiles.map(p => [p.id, p.count, p.rawCount])).toEqual([['A', 1, 2], ['B', 1, 1]]);
    expect(view.sources.map(s => s.id)).toEqual([sourceIdentityKey('B', 'same')]);
  });

  it('keeps all returned items available for actor, description and alias searches', () => {
    const items = [item('嫁金钗'), item('火影忍者')];
    const before = JSON.stringify(items);
    expect(searchResultView(items, '嫁金钗', { mode: 'all' }).items).toHaveLength(2);
    expect(searchResultView(items, '嫁金钗', { mode: 'related' }).items).toHaveLength(1);
    expect(JSON.stringify(items)).toBe(before);
  });

  it('retains provider folders whose labels do not contain the movie title', () => {
    const folder = { ...item('夸克（92个）'), tag: 'folder' as const };
    expect(searchResultView([folder], '嫁金钗', { mode: 'related' }).items).toEqual([folder]);
  });

  it('shows full-title matches first and spreads equal matches across sources', () => {
    const items = [item('《嫁金钗》第1集', 'A', 'clips', 'clip'), item('嫁金钗', 'A', 'a', 'a1'), item('嫁金钗', 'A', 'a', 'a2'), item('嫁金钗', 'B', 'b', 'b1')];
    expect(searchResultView(items, '嫁金钗', { mode: 'related' }).items.map(i => i.id)).toEqual(['a1', 'b1', 'a2', 'clip']);
  });
});
