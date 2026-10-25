// Pure policies for per-resource and per-episode skip settings.
export interface SkipSeg {
  /** 片头跳过秒数（= 起播跳到的位置，0 = 未设置） */
  intro: number;
  /** 片尾跳过秒数（距结尾还剩这么多秒时跳下一集，0 = 未设置） */
  outro: number;
}

export interface SkipRecord extends SkipSeg {
  /** 写入时间（ms）：跨窗口合并取更新者，也是「本资源最近一次设置」的排序依据 */
  at: number;
  /** 写入时的集展示名（如「第12集」）——「沿用 X 的设置」提示用 */
  from?: string;
  /** 用户明确清除了本集设置；保留此标记以阻止跨窗口合并复活旧记录或重新继承。 */
  cleared?: true;
}

/** 键 = `资源键|集键`（资源键由调用方给，与历史分组同口径：见 uiMemory.historyGroupKey） */
export type SkipStore = Record<string, SkipRecord>;

/** 存储条数上限（超出按 at 新→旧截断），防 localStorage 无限膨胀 */
export const SKIP_MAX = 2000;
/** 秒数上限（6 小时；防手滑输入天文数字） */
export const SKIP_SEC_MAX = 6 * 3600;

/** 组合键（资源 / 集都会 trim，避免空白差异产生两条记录） */
export function skipStoreKey(resource: string, ep: string): string {
  return `${(resource || '').trim()}|${(ep || '').trim()}`;
}

/** 秒数归一：非法/负/NaN → 0；超上限截断（纯函数，可单测） */
export function clampSeconds(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, SKIP_SEC_MAX);
}

/** 归一一条记录：两项都为 0 / 非法 → null（视为无记录） */
export function normalizeSkipRecord(raw: unknown): SkipRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { intro?: unknown; outro?: unknown; at?: unknown; from?: unknown };
  const intro = clampSeconds(r.intro);
  const outro = clampSeconds(r.outro);
  if (!intro && !outro) return null;
  return { intro, outro, at: Number(r.at) || 0, from: typeof r.from === 'string' ? r.from : undefined };
}

/** Normalize a stored record while preserving explicit per-episode clears. */
function normalizeStoredSkipRecord(raw: unknown): SkipRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { intro?: unknown; outro?: unknown; at?: unknown; from?: unknown; cleared?: unknown };
  if (record.cleared === true) {
    const intro = clampSeconds(record.intro);
    const outro = clampSeconds(record.outro);
    if (intro !== 0 || outro !== 0) return null;
    return {
      intro: 0,
      outro: 0,
      at: Number(record.at) || 0,
      from: typeof record.from === 'string' ? record.from : undefined,
      cleared: true,
    };
  }
  return normalizeSkipRecord(raw);
}

/** 从存储里取资源下的全部记录（键格式 `资源|集`，按前缀精确匹配资源） */
function recordsOfResource(store: SkipStore, resource: string): Array<{ ep: string; rec: SkipRecord }> {
  const prefix = `${(resource || '').trim()}|`;
  const out: Array<{ ep: string; rec: SkipRecord }> = [];
  if (!prefix) return out;
  for (const [k, rec] of Object.entries(store)) {
    if (!k.startsWith(prefix)) continue;
    out.push({ ep: k.slice(prefix.length), rec });
  }
  return out;
}

/** 本集自己的记录（无 → null） */
export function ownSkip(store: SkipStore, resource: string, ep: string): SkipRecord | null {
  const rec = store[skipStoreKey(resource, ep)];
  return rec || null;
}

/** 本资源**最近一次设置**（可排除某集）；用于「本集无记录 → 沿用」 */
export function latestSkipOfResource(
  store: SkipStore,
  resource: string,
  exceptEp?: string,
): { ep: string; rec: SkipRecord } | null {
  const list = recordsOfResource(store, resource).filter((x) => !x.rec.cleared && (!exceptEp || x.ep !== exceptEp));
  if (!list.length) return null;
  return list.reduce((best, x) => ((x.rec.at || 0) > (best.rec.at || 0) ? x : best), list[0]);
}

/** 取本集有效设置：本集记录 → 本资源最近一次设置（继承）→ null */
export function resolveSkip(
  store: SkipStore,
  resource: string,
  ep: string,
): { seg: SkipSeg; inheritedFrom: string | null } | null {
  const own = ownSkip(store, resource, ep);
  if (own) return { seg: { intro: own.intro, outro: own.outro }, inheritedFrom: null };
  const latest = latestSkipOfResource(store, resource, ep);
  if (!latest) return null;
  return {
    seg: { intro: latest.rec.intro, outro: latest.rec.outro },
    inheritedFrom: latest.rec.from || latest.ep,
  };
}

/** 写入/清除本集记录（纯函数，返回新 store；两项都为 0 = 清除本集记录，**不再继承**） */
export function putSkipRecord(
  store: SkipStore,
  resource: string,
  ep: string,
  seg: SkipSeg,
  label: string | undefined,
  now: number,
): SkipStore {
  const out: SkipStore = { ...store };
  const key = skipStoreKey(resource, ep);
  const at = Math.max(now, (out[key]?.at ?? -1) + 1);
  const intro = clampSeconds(seg.intro);
  const outro = clampSeconds(seg.outro);
  out[key] = intro || outro
    ? { intro, outro, at, from: label }
    : { intro: 0, outro: 0, at, from: label, cleared: true };
  return out;
}

/** 合并两份存储（同键取 at 更新者），并按上限裁剪 */
export function mergeSkipStores(a: SkipStore, b: SkipStore): SkipStore {
  const out: SkipStore = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    const cur = out[k];
    if (!cur || (v.at || 0) > (cur.at || 0)) out[k] = v;
  }
  return pruneSkipStore(out);
}

/** 按 at 新→旧保留前 max 条（超出才重建对象） */
export function pruneSkipStore(store: SkipStore, max: number = SKIP_MAX): SkipStore {
  const keys = Object.keys(store);
  if (keys.length <= max) return store;
  keys.sort((x, y) => (store[y].at || 0) - (store[x].at || 0));
  const out: SkipStore = {};
  for (const k of keys.slice(0, max)) out[k] = store[k];
  return out;
}

/** Decode an already-parsed storage value without touching browser APIs. */
export function decodeSkipStore(value: unknown): SkipStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SkipStore = {};
  for (const [key, record] of Object.entries(value)) {
    if (!key) continue;
    const normalized = normalizeStoredSkipRecord(record);
    if (normalized) out[key] = normalized;
  }
  return out;
}
// ---- 播放期判据（纯函数，可单测）----

/**
 * 是否该跳过片头：本集已跳过一次 → 不再跳（用户手动拖回片头时不该又被弹走）。
 * `dur` 已知时，片头点须落在片内（压到片尾 = 无效记录，不跳）。
 */
export function shouldSkipIntro(cur: number, dur: number, seg: SkipSeg, fired: boolean): boolean {
  if (fired || seg.intro <= 0.5) return false;
  if (dur > 0 && seg.intro >= dur - 1) return false;
  return cur >= 0 && cur < seg.intro - 0.5;
}

/**
 * 是否该跳过片尾：未知时长（直播）/片尾秒数过小 / 出点落在片外 → 不跳。
 * `fired` 保证一集只触发一次。
 */
export function shouldSkipOutro(cur: number, dur: number, seg: SkipSeg, fired: boolean): boolean {
  if (fired || seg.outro <= 1 || !(dur > 0)) return false;
  const point = dur - seg.outro;
  if (point <= 1 || point >= dur) return false;
  return cur >= point;
}
