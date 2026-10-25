import { describe, expect, it } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import { SourceSearchHealth } from '../src/engine/vod/SourceSearchHealth';

function source(key: string, runtimeScope = key, timeout = 15): SourceBean {
  return { key, runtimeScope, timeout } as SourceBean;
}

describe('SourceSearchHealth', () => {
  it('orders healthy, unknown and recently failed sources in that order', () => {
    let now = 1_000;
    const health = new SourceSearchHealth(() => now);
    const sources = [source('fast', 'profile-a:fast'), source('failed', 'profile-a:failed'), source('unknown')];

    health.succeeded('profile-a:fast', 250, false);
    now += 100;
    health.failed('profile-a:failed');

    expect(health.scheduleOrder(sources)).toEqual([0, 2, 1]);
  });

  it('keeps source health separate across profile runtime scopes', () => {
    const health = new SourceSearchHealth(() => 1_000);
    health.succeeded('profile-a:shared-key', 150, false);

    const order = health.scheduleOrder([
      source('shared-key', 'profile-b:shared-key'),
      source('shared-key', 'profile-a:shared-key'),
    ]);

    expect(order).toEqual([1, 0]);
  });

  it('applies declared timeout to unknown sources and a short budget to recent failures', () => {
    const health = new SourceSearchHealth(() => 1_000);
    health.failed('broken');

    expect(health.budget(source('unknown', 'unknown', 12), 12_000, 20_000)).toBe(12_000);
    expect(health.budget(source('broken', 'broken', 12), 12_000, 20_000)).toBe(3_500);
  });

  it('limits repeated empty sources and restores history-based budgets after a hit', () => {
    let now = 1_000;
    const health = new SourceSearchHealth(() => now);
    const emptySource = source('empty');

    health.succeeded('empty', 2_000, true);
    expect(health.budget(emptySource, 15_000, 20_000)).toBe(6_000);

    now += 1_000;
    health.succeeded('empty', 2_000, false);
    expect(health.budget(emptySource, 15_000, 20_000)).toBe(5_000);
  });

  it('clears session history explicitly', () => {
    const health = new SourceSearchHealth(() => 1_000);
    const sources = [source('other'), source('fast')];
    health.succeeded('fast', 100, false);
    expect(health.scheduleOrder(sources)).toEqual([1, 0]);

    health.clear();
    expect(health.scheduleOrder(sources)).toEqual([0, 1]);
    expect(health.budget(source('fast'), 15_000, 12_000)).toBe(12_000);
  });
});
