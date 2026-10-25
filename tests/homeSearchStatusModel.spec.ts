import { describe, expect, it } from 'vitest';
import { buildHomeSearchStatusModel } from '../src/renderer/features/home/homePageModel';

const base = {
  loading: false,
  hasReport: false,
  isWideSearch: true,
  progress: null,
  folder: null,
  folderItemCount: 0,
  resultCount: 0,
  scope: 'all' as const,
  error: '',
  query: '示例影片',
  profileReady: true,
};

describe('buildHomeSearchStatusModel', () => {
  it('does not describe an idle search route as still searching', () => {
    expect(buildHomeSearchStatusModel(base)).toEqual({
      topbarStatus: '等待搜索',
      emptyStatus: '搜索尚未开始，请使用顶部搜索框重新搜索。',
    });
  });

  it('reports search progress and outstanding sources while loading', () => {
    expect(buildHomeSearchStatusModel({
      ...base,
      loading: true,
      progress: { done: 3, total: 8, pending: 5 },
    })).toEqual({
      topbarStatus: '搜索中 · 3/8 个源',
      emptyStatus: '正在逐源检索（已出 3/8 个源的结果，其余 5 个仍在补搜），请稍候…',
    });
  });

  it('keeps failure and source-preparation states distinct from an empty result', () => {
    expect(buildHomeSearchStatusModel({ ...base, error: '接口超时' }).emptyStatus).toBe('搜索/展开失败：接口超时');
    expect(buildHomeSearchStatusModel({ ...base, profileReady: false }).emptyStatus).toBe('正在准备搜索来源…');
    expect(buildHomeSearchStatusModel({ ...base, query: '' }).emptyStatus).toBe('输入影片、剧集或演员名开始搜索。');
  });
});
