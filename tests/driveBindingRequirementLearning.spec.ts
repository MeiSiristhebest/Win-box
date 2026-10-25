import { describe, expect, it } from 'vitest';
import type { VodDetail } from '../src/shared/types';
import { DriveBindingRequirementLearning, type LearnedDriveBindingStore } from '../src/main/spider/DriveBindingRequirementLearning';

class MemoryStore implements LearnedDriveBindingStore {
  readonly data = new Map<string, unknown>();
  flushCount = 0;
  flushError: Error | null = null;

  getObject<T>(key: string, fallback: T): T {
    return (this.data.get(key) as T | undefined) ?? fallback;
  }
  setObject<T>(key: string, value: T): void { this.data.set(key, value); }
  flush(): void {
    this.flushCount += 1;
    if (this.flushError) throw this.flushError;
  }
}

const detail: VodDetail = {
  id: 'movie-1', name: 'Movie', pic: '', type: '', year: '', area: '', director: '', actor: '',
  des: '', remarks: '', flags: ['夸克原画'], episodes: {},
};

describe('DriveBindingRequirementLearning', () => {
  it('loads stored source keys, trims new keys, and persists only the first observation', () => {
    const store = new MemoryStore();
    store.data.set('list', ['saved-source', '', 1, 'saved-source']);
    const warnings: string[] = [];
    const learning = new DriveBindingRequirementLearning(store, { i: () => undefined, w: (message) => warnings.push(message) });

    expect(learning.learnedSourceKeys()).toEqual(['saved-source']);
    learning.markRequired('  source-a  ');
    learning.markRequired('source-a');

    expect(learning.learnedSourceKeys()).toEqual(['saved-source', 'source-a']);
    expect(store.data.get('list')).toEqual(['saved-source', 'source-a']);
    expect(store.flushCount).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('learns a provider from detail and only uses it for authorization messages', () => {
    const store = new MemoryStore();
    const learning = new DriveBindingRequirementLearning(store, { i: () => undefined, w: () => undefined });
    learning.learnFromDetail('source-a', detail);

    expect(learning.learnedSourceKeys()).toContain('source-a');
    expect(learning.providerForGenericAuth('请先完成网盘授权', 'source-a')).toBe('quark');
    expect(learning.providerForGenericAuth('暂时没有播放地址', 'source-a')).toBeNull();
    expect(learning.providerForGenericAuth('请先完成网盘授权', 'unknown-source')).toBeNull();
  });

  it('records generic drive requirements without inventing a provider', () => {
    const learning = new DriveBindingRequirementLearning(new MemoryStore(), { i: () => undefined, w: () => undefined });
    learning.learnFromDetail('source-a', { ...detail, flags: ['网盘'] });

    expect(learning.learnedSourceKeys()).toEqual(['source-a']);
    expect(learning.providerForGenericAuth('请先完成网盘授权', 'source-a')).toBeNull();
  });

  it('contains persistence failures at the learning boundary', () => {
    const store = new MemoryStore();
    store.flushError = new Error('disk full');
    const warnings: string[] = [];
    const learning = new DriveBindingRequirementLearning(store, { i: () => undefined, w: (message) => warnings.push(message) });

    expect(() => learning.markRequired('source-a')).not.toThrow();
    expect(warnings).toEqual(['drive-bind 学习结果落盘失败: disk full']);
    expect(learning.learnedSourceKeys()).toEqual(['source-a']);
  });
});
