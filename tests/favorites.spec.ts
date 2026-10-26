// tests/favorites.spec.ts
// ★ 2026-10-17（用户要求）：收藏集合（增删改查 + 跨窗口合并 + 删除墓碑）。
// 全部走真实代码路径（add/remove/restore/update/load 往返），只额外注入一个最小 localStorage 桩。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  FAVORITES_EVENT,
  favoriteKey,
  favoriteKeyCandidates,
  favoriteTitle,
  normalizeFavorite,
  mergeFavoriteViews,
  addFavorite,
  removeFavorite,
  restoreFavorite,
  updateFavorite,
  clearFavorites,
  findFavorite,
  isFavorited,
  listFavorites,
  favoritesCount,
  loadFavorites,
  type FavoriteItem,
} from '../src/renderer/features/favorites/favoritesRuntime';
import { unionTombstones } from '../src/renderer/lib/uiMemory';

/** 测试环境是 node（无 jsdom）→ 提供最小 localStorage 实现（读写都在调用期发生，故注入即可） */
const memStore = new Map<string, string>();
beforeAll(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
    setItem: (k: string, v: string) => void memStore.set(k, String(v)),
    removeItem: (k: string) => void memStore.delete(k),
    clear: () => memStore.clear(),
  };
});

beforeEach(() => {
  memStore.clear();
  clearFavorites();
});

afterEach(() => {
  memStore.clear();
  clearFavorites();
});

/** 「另一部片」的收藏输入 */
const A = { name: '狂飙 - 第1集', sourceKey: 'srcX', vodId: '1001', profileId: 'p1', sourceName: '源X', pic: 'http://x/a.jpg', remarks: '更新至39集', year: '2023', type: '剧集' };

describe('收藏键 — 同订阅同源同片一条', () => {
  it('同订阅同源同片 → 同键；换集（name 不同）仍是同键', () => {
    expect(favoriteKey(A)).toBe(favoriteKey({ ...A, name: '狂飙 - 第12集' }));
  });

  it('不同订阅 / 不同源 / 不同片 → 不同键', () => {
    expect(favoriteKey(A)).not.toBe(favoriteKey({ ...A, profileId: 'p2' }));
    expect(favoriteKey(A)).not.toBe(favoriteKey({ ...A, sourceKey: 'srcY' }));
    expect(favoriteKey(A)).not.toBe(favoriteKey({ ...A, vodId: '2002' }));
  });

  it('候选键：带订阅 id 与不带订阅 id 两种写法', () => {
    const cands = favoriteKeyCandidates({ sourceKey: 'srcX', vodId: '1001', name: '狂飙', profileId: 'p1' });
    expect(cands).toHaveLength(2);
    expect(cands[0]).toContain('p1');
    expect(cands[1]).not.toContain('p1');
    // 没有 profileId 时只有一种写法
    expect(favoriteKeyCandidates({ sourceKey: 'srcX', vodId: '1001', name: '狂飙' })).toHaveLength(1);
  });
});

describe('增 / 查 / 改', () => {
  it('收藏后：列表有 1 条、isFavorited 命中、计数正确', () => {
    addFavorite(A);
    expect(favoritesCount()).toBe(1);
    expect(listFavorites()).toHaveLength(1);
    expect(isFavorited({ sourceKey: 'srcX', vodId: '1001', name: '狂飙', profileId: 'p1' })).toBe(true);
    expect(findFavorite({ sourceKey: 'srcX', vodId: '1001', name: '狂飙', profileId: 'p1' })?.item.name).toBe(A.name);
  });

  it('不带订阅 id 查询也能命中（老记录）', () => {
    addFavorite(A);
    expect(isFavorited({ sourceKey: 'srcX', vodId: '1001', name: '狂飙' })).toBe(true);
  });

  it('重复收藏不新增，且保留首次收藏时间', () => {
    const first = addFavorite(A);
    const again = addFavorite({ ...A, name: '狂飙 - 第2集', remarks: '更新至40集' });
    expect(favoritesCount()).toBe(1);
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.name).toBe('狂飙 - 第2集');
    expect(again.remarks).toBe('更新至40集');
    expect(again.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('改：更新显示名与备注；展示名优先用改过的名字', () => {
    const it = addFavorite(A);
    const key = favoriteKey(A);
    expect(favoriteTitle(it)).toBe('狂飙');
    expect(updateFavorite(key, { title: '我的狂飙', note: '看完了前10集' })).toBe(true);
    const got = findFavorite(A)?.item as FavoriteItem;
    expect(favoriteTitle(got)).toBe('我的狂飙');
    expect(got.note).toBe('看完了前10集');
    // 改不存在的键 → false
    expect(updateFavorite('nope', { note: 'x' })).toBe(false);
  });
});

describe('删 + 墓碑（另一个窗口的旧快照不能复活）', () => {
  it('移除后立即生效；重新从盘载入（模拟另一窗口）仍然没有', () => {
    const it = addFavorite(A);
    const key = favoriteKey(A);
    expect(removeFavorite(key)).toBe(true);
    expect(favoritesCount()).toBe(0);
    loadFavorites(); // 模拟「另一个窗口」读盘并进内存
    expect(listFavorites()).toHaveLength(0);
    expect(isFavorited({ sourceKey: 'srcX', vodId: '1001', name: '狂飙', profileId: 'p1' })).toBe(false);
    expect(it.createdAt).toBeGreaterThan(0);
  });

  it('另一窗口拿着含该条的旧快照合并 → 仍不复活（墓碑生效）', () => {
    const key = favoriteKey(A);
    const now = Date.now();
    const tombs = unionTombstones(new Map([[key, now]]), null, now + 1);
    const snapshot = new Map<string, FavoriteItem>([[key, normalizeFavorite(key, { ...A, createdAt: now - 5000, updatedAt: now - 5000 })]]);
    const persisted: Array<[string, unknown]> = [[key, { ...A, createdAt: now - 5000, updatedAt: now - 5000 }]];
    expect(mergeFavoriteViews(snapshot, persisted, tombs).has(key)).toBe(false);
  });

  it('删除后又重新收藏 → 新记录正常存在（不被自己的墓碑挡住）', () => {
    addFavorite(A);
    const key = favoriteKey(A);
    removeFavorite(key);
    addFavorite(A);
    loadFavorites();
    expect(isFavorited({ sourceKey: 'srcX', vodId: '1001', name: '狂飙', profileId: 'p1' })).toBe(true);
  });

  it('撤销（restoreFavorite）→ 重新载入后条目仍在，且时间戳未被刷新', () => {
    const it = addFavorite(A);
    const key = favoriteKey(A);
    removeFavorite(key);
    expect(restoreFavorite(it)).toBe(true);
    loadFavorites();
    const got = findFavorite(A)?.item as FavoriteItem;
    expect(got.createdAt).toBe(it.createdAt);
    expect(got.updatedAt).toBe(it.updatedAt);
    // 已在内存里 → 再撤销一次返回 false
    expect(restoreFavorite(it)).toBe(false);
  });
});

describe('排序 / 清空 / 异常兜底', () => {
  it('列表按收藏时间倒序', () => {
    const key1 = favoriteKey({ ...A, vodId: '1' });
    const key2 = favoriteKey({ ...A, vodId: '2' });
    memStore.set('winbox-favorites', JSON.stringify({
      favorites: [
        [key1, { ...A, vodId: '1', createdAt: 1000, updatedAt: 1000 }],
        [key2, { ...A, vodId: '2', createdAt: 2000, updatedAt: 2000 }],
      ],
      deleted: [],
    }));
    loadFavorites();
    expect(listFavorites().map((x) => x.vodId)).toEqual(['2', '1']);
  });

  it('清空全部收藏（显式意图）：不留墓碑，之后重新收藏正常', () => {
    addFavorite(A);
    clearFavorites();
    expect(favoritesCount()).toBe(0);
    expect(memStore.has('winbox-favorites')).toBe(false);
    addFavorite(A);
    loadFavorites();
    expect(isFavorited({ sourceKey: 'srcX', vodId: '1001', name: '狂飙', profileId: 'p1' })).toBe(true);
  });

  it('归一/合并对畸形输入不抛：空键、非数字时间、非对象一律兜底', () => {
    const norm = normalizeFavorite('k:1', { name: 123 as unknown as string, createdAt: 'x' as unknown as number, updatedAt: Number.NaN });
    expect(norm.name).toBe('k:1');
    expect(norm.createdAt).toBe(0);
    expect(norm.updatedAt).toBe(0);

    const out = mergeFavoriteViews(new Map(), [[ '', { a: 1 }], ['k:ok', null as unknown as object], ['k:ok2', 'str' as unknown as object], ['k:good', { ...A, updatedAt: 5 }]], new Map());
    expect(out.size).toBe(1);
    expect(out.has('k:good')).toBe(true);
  });

  it('广播事件名固定（同窗口 UI 订阅用）', () => {
    expect(FAVORITES_EVENT).toBe('winbox:favorites-changed');
  });
});
