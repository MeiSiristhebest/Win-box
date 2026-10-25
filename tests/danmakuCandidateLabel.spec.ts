import { describe, expect, it } from 'vitest';
import { formatDanmakuCandidateLabel } from '../src/renderer/features/playback/presentation/formatDanmakuCandidateLabel';

describe('formatDanmakuCandidateLabel', () => {
  it('normalizes the episode suffix while keeping the work title', () => {
    expect(formatDanmakuCandidateLabel({ title: '我独自升级', episodeTitle: '第12话' })).toBe('我独自升级 · 第12集');
  });

  it('presents year, season, and episode in a stable order', () => {
    expect(formatDanmakuCandidateLabel({ title: '斗破苍穹（2022）第2季', episodeTitle: '第5集' })).toBe('斗破苍穹（2022） · 第2季 · 第5集');
  });

  it('normalizes latin season and episode notation', () => {
    expect(formatDanmakuCandidateLabel({ title: 'Breaking Bad S02E07' })).toBe('Breaking Bad · 第2季 · 第7集');
  });

  it('recognizes Chinese season numbers', () => {
    expect(formatDanmakuCandidateLabel({ title: '庆余年 第二季', episodeTitle: '3' })).toBe('庆余年 · 第2季 · 第3集');
  });

  it('extracts an updated episode number and removes the suffix from the work title', () => {
    expect(formatDanmakuCandidateLabel({ title: '凡人修仙传 更新至120集' })).toBe('凡人修仙传 · 第120集');
  });

  it('keeps a plain work title when no year, season, or episode is available', () => {
    expect(formatDanmakuCandidateLabel({ title: '鬼灭之刃 柱训练篇' })).toBe('鬼灭之刃 柱训练篇');
  });

  it('normalizes a year in half-width parentheses', () => {
    expect(formatDanmakuCandidateLabel({ title: 'Solo Leveling (2024)' })).toBe('Solo Leveling（2024）');
  });

  it('handles missing title and falls back to the episode title', () => {
    expect(formatDanmakuCandidateLabel()).toBe('');
    expect(formatDanmakuCandidateLabel({ episodeTitle: '第3集' })).toBe('第3集');
  });

  it('removes platform and type noise while extracting episode metadata', () => {
    expect(formatDanmakuCandidateLabel({ title: '斗罗大陆系列小剧场(2026)【动漫】from tencent', episodeTitle: '【qq】 第1集 菜头萧萧双向守护' })).toBe(
      '斗罗大陆系列小剧场（2026） · 第1集',
    );
  });

  it('uses the API episode number when the title has none', () => {
    expect(formatDanmakuCandidateLabel({ title: '斗罗大陆之燃魂战(2024)【电视剧】from tencent', episodeTitle: '【qq】 正片', episodeNumber: '39' })).toBe(
      '斗罗大陆之燃魂战（2024） · 第39集',
    );
  });
});
