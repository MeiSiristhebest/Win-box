import { parseSite } from '../../engine/config/SiteParser';
import type { LiveBean, SourceBean, SourceMoveDirection, SourceUpdatePatch, UserConfig } from '../../shared/types';
import { clampIndex } from './userConfigNormalization';
import { sourceDeletionKeys, withSourceDeletionKeys } from './sourceDeletionScopes';

/** Fields that source settings are allowed to edit after a source has been created. */
const MUTABLE_SOURCE_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'ext',
  'jar',
  'playUrl',
  'searchable',
  'quickSearch',
  'filterable',
  'changeable',
  'timeout',
  'categories',
  'style',
  'click',
]);

export interface SourceCatalogChange<T> {
  config: UserConfig;
  value: T;
}

/** Validate and append a source without mutating the supplied snapshot. */
export function addSourceToConfig(config: UserConfig, bean: SourceBean): SourceCatalogChange<SourceBean> {
  if (!bean || typeof bean !== 'object') {
    throw new Error('源数据不合法（请填写 key/name/type/api）');
  }
  const key = String((bean as { key?: unknown }).key ?? '').trim();
  if (!key) throw new Error('源 key 不能为空');
  if (config.sources.some((source) => source.key === key)) {
    throw new Error(`源 key 已存在：${key}（请更换 key 或先删除旧源）`);
  }
  const parsed = parseSite(bean as unknown, config.sources.length);
  if (!parsed.bean) throw new Error(`源校验失败：${parsed.report.message}`);

  // Re-adding a deleted key is an explicit user action, so clear its deletion marker.
  const next = withSourceDeletionKeys(
    { ...config, sources: [...config.sources, parsed.bean] },
    sourceDeletionKeys(config).filter((deletedKey) => deletedKey !== parsed.bean!.key),
  );
  return { config: next, value: { ...parsed.bean } };
}

/** Apply a source settings patch while keeping identity and provider fields immutable. */
export function updateSourceInConfig(config: UserConfig, key: string, patch: SourceUpdatePatch): SourceCatalogChange<SourceBean> {
  if (!patch || typeof patch !== 'object') throw new Error('修改内容为空');
  const index = config.sources.findIndex((source) => source.key === key);
  if (index < 0) throw new Error(`源不存在：${key}`);
  for (const forbidden of ['key', 'type', 'api'] as const) {
    if (forbidden in patch) throw new Error(`源 ${forbidden} 一经创建不可修改（请删除后重新添加）`);
  }

  const cleaned: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (MUTABLE_SOURCE_FIELDS.has(field) && value !== undefined) cleaned[field] = value;
  }
  const merged: SourceBean = { ...config.sources[index], ...(cleaned as Partial<SourceBean>) };
  const parsed = parseSite(merged as unknown, index);
  if (!parsed.bean) throw new Error(`修改后源校验失败：${parsed.report.message}`);

  const sources = [...config.sources];
  sources[index] = parsed.bean;
  return { config: { ...config, sources }, value: { ...parsed.bean } };
}

/** Delete sources in one snapshot change, recording tombstones for subscription refreshes. */
export function deleteSourcesFromConfig(config: UserConfig, keys: readonly string[]): UserConfig | null {
  const removing = new Set(keys.filter(Boolean));
  if (!removing.size || !config.sources.some((source) => removing.has(source.key))) return null;

  const next: UserConfig = {
    ...config,
    sources: config.sources.filter((source) => !removing.has(source.key)),
    deletedSourceKeysByProfile: withSourceDeletionKeys(
      config,
      [...sourceDeletionKeys(config), ...config.sources.filter((source) => removing.has(source.key)).map((source) => source.key)],
    ).deletedSourceKeysByProfile,
  };
  if (removing.has(next.ui.activeSourceKey)) next.ui = { ...next.ui, activeSourceKey: '' };
  return next;
}

/** Reorder a source. Missing keys and boundary moves are no-ops. */
export function moveSourceInConfig(config: UserConfig, key: string, direction: SourceMoveDirection): UserConfig | null {
  const sources = config.sources;
  const index = sources.findIndex((source) => source.key === key);
  if (index < 0) return null;
  let target = index;
  if (direction === 'up') target = index - 1;
  else if (direction === 'down') target = index + 1;
  else if (direction === 'top') target = 0;
  else if (direction === 'bottom') target = sources.length - 1;
  if (target === index || target < 0 || target >= sources.length) return null;

  const reordered = [...sources];
  const [source] = reordered.splice(index, 1);
  reordered.splice(target, 0, source);
  return { ...config, sources: reordered };
}

/** Add/update an imported local live playlist by URL, avoiding duplicate entries. */
export function addLiveToConfig(config: UserConfig, bean: LiveBean): SourceCatalogChange<{ index: number; replaced: boolean }> {
  const url = String(bean?.url || '').trim();
  if (!url) throw new Error('直播源地址为空');
  const name = String(bean?.name || '').trim() || '直播源';
  const lives = [...config.lives];
  const index = lives.findIndex((live) => String(live.url || '').trim() === url);
  const replaced = index >= 0;
  if (replaced) lives[index] = { ...lives[index], name };
  else lives.push({ ...bean, name });
  return { config: { ...config, lives }, value: { index: replaced ? index : lives.length - 1, replaced } };
}

/** Delete live entries by position and clamp the selected entry into the new list. */
export function deleteLivesFromConfig(config: UserConfig, indices: readonly number[]): UserConfig | null {
  const removing = new Set(indices.map((index) => Math.floor(index)).filter((index) => Number.isFinite(index) && index >= 0));
  if (!removing.size) return null;
  const lives = config.lives.filter((_, index) => !removing.has(index));
  if (lives.length === config.lives.length) return null;
  return { ...config, lives, ui: { ...config.ui, activeLiveIndex: clampIndex(config.ui.activeLiveIndex, lives.length) } };
}

/** Rename a live entry; empty names and invalid positions are no-ops. */
export function renameLiveInConfig(config: UserConfig, index: number, name: string): UserConfig | null {
  const position = Math.floor(index);
  const normalizedName = (name || '').trim();
  if (!normalizedName || !Number.isFinite(position) || position < 0 || position >= config.lives.length) return null;
  return {
    ...config,
    lives: config.lives.map((live, current) => current === position ? { ...live, name: normalizedName } : live),
  };
}
