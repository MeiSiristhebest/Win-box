import { parseSiteConfig } from '../../engine/config/ApiConfigParser';
import type { SourceBean, SubscriptionSourceRefreshDiff, UserProfile } from '../../shared/types';

const SOURCE_OVERRIDE_FIELDS = [
  'name',
  'searchable',
  'quickSearch',
  'changeable',
  'filterable',
  'playUrl',
  'ext',
  'jar',
  'playerType',
  'categories',
  'timeout',
  'click',
  'style',
  'homePage',
] as const satisfies readonly (keyof SourceBean)[];

const SOURCE_DIFF_FIELDS = [
  'name',
  'type',
  'api',
  ...SOURCE_OVERRIDE_FIELDS.filter((field) => field !== 'name'),
] as const satisfies readonly (keyof SourceBean)[];

type SourceOverrideField = typeof SOURCE_OVERRIDE_FIELDS[number];

export interface SubscriptionSourceOverrides {
  version: 1;
  order: string[];
  deletedKeys: string[];
  additions: SourceBean[];
  patches: Array<{
    key: string;
    values: Partial<SourceBean>;
    removedFields: SourceOverrideField[];
  }>;
}

export interface SubscriptionProfileRefreshResult {
  sources: SourceBean[];
  sourceOverridesJson: string;
  preserveCurrentProfile?: boolean;
  upstreamJson?: string;
  pendingUpstreamJson?: string;
  refreshDiff?: SubscriptionSourceRefreshDiff;
}

export function deriveSubscriptionSourceOverrides(
  upstream: readonly SourceBean[],
  effective: readonly SourceBean[],
): SubscriptionSourceOverrides {
  const upstreamByKey = new Map(upstream.map((source) => [source.key, source]));
  const effectiveByKey = new Map(effective.map((source) => [source.key, source]));
  const additions = effective
    .filter((source) => !upstreamByKey.has(source.key))
    .map(copySource);
  const deletedKeys = upstream
    .filter((source) => !effectiveByKey.has(source.key))
    .map((source) => source.key);
  const patches: SubscriptionSourceOverrides['patches'] = [];

  for (const source of effective) {
    const baseline = upstreamByKey.get(source.key);
    if (!baseline) continue;
    const values: Partial<SourceBean> = {};
    const removedFields: SourceOverrideField[] = [];
    for (const field of SOURCE_OVERRIDE_FIELDS) {
      const before = baseline[field];
      const after = source[field];
      if (sameValue(before, after)) continue;
      if (after === undefined) removedFields.push(field);
      else Object.assign(values, { [field]: copyValue(after) });
    }
    if (Object.keys(values).length || removedFields.length) {
      patches.push({ key: source.key, values, removedFields });
    }
  }

  return {
    version: 1,
    order: effective.map((source) => source.key),
    deletedKeys: [...new Set(deletedKeys)],
    additions,
    patches,
  };
}

export function applySubscriptionSourceOverrides(
  upstream: readonly SourceBean[],
  overrides: SubscriptionSourceOverrides,
): SourceBean[] {
  const byKey = new Map(upstream.map((source) => [source.key, copySource(source)]));
  for (const key of overrides.deletedKeys) byKey.delete(key);

  for (const patch of overrides.patches) {
    const source = byKey.get(patch.key);
    if (!source) continue;
    const next: SourceBean = { ...source };
    for (const field of patch.removedFields) Reflect.deleteProperty(next, field);
    Object.assign(next, cloneRecord(patch.values));
    next.key = source.key;
    byKey.set(source.key, next);
  }

  for (const source of overrides.additions) byKey.set(source.key, copySource(source));

  const rank = new Map<string, number>();
  overrides.order.forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });
  return [...byKey.values()]
    .map((source, index) => ({ source, index, rank: rank.get(source.key) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ source }) => source);
}

export function serializeSubscriptionSourceOverrides(overrides: SubscriptionSourceOverrides): string {
  return JSON.stringify(overrides);
}

export function parseSubscriptionSourceOverrides(value: string | undefined): SubscriptionSourceOverrides | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    if (!raw || raw.version !== 1) return null;
    const order = stringArray(raw.order);
    const deletedKeys = stringArray(raw.deletedKeys);
    if (!order || !deletedKeys || !Array.isArray(raw.additions) || !Array.isArray(raw.patches)) return null;

    const additions: SourceBean[] = [];
    for (const value of raw.additions) {
      const source = parseSource(value);
      if (!source) return null;
      additions.push(source);
    }

    const patches: SubscriptionSourceOverrides['patches'] = [];
    for (const value of raw.patches) {
      if (!isRecord(value) || typeof value.key !== 'string' || !value.key || !isRecord(value.values)) return null;
      const removed = stringArray(value.removedFields);
      if (!removed || !removed.every(isSourceOverrideField)) return null;
      const values: Partial<SourceBean> = {};
      for (const [field, fieldValue] of Object.entries(value.values)) {
        if (!isSourceOverrideField(field) || !isValidFieldValue(field, fieldValue)) return null;
        if (removed.includes(field)) return null;
        Object.assign(values, { [field]: copyValue(fieldValue) });
      }
      patches.push({ key: value.key, values, removedFields: removed });
    }
    return { version: 1, order, deletedKeys, additions, patches };
  } catch {
    return null;
  }
}

export function deriveSubscriptionSourceOverridesFromSnapshot(
  upstreamJson: string | undefined,
  effective: readonly SourceBean[],
): string | undefined {
  const upstream = snapshotSources(upstreamJson);
  return upstream ? serializeSubscriptionSourceOverrides(deriveSubscriptionSourceOverrides(upstream, effective)) : undefined;
}

export function reconcileSubscriptionProfileRefresh(
  incoming: readonly SourceBean[],
  previous: Pick<UserProfile, 'json' | 'upstreamJson' | 'sourceOverridesJson'> | undefined,
  incomingSnapshotJson = JSON.stringify({ sites: incoming }),
): SubscriptionProfileRefreshResult {
  const upstream = incoming.map(copySource);
  const effective = snapshotSources(previous?.json);
  if (!previous) {
    const empty: SubscriptionSourceOverrides = { version: 1, order: [], deletedKeys: [], additions: [], patches: [] };
    return {
      sources: upstream,
      sourceOverridesJson: serializeSubscriptionSourceOverrides(empty),
      upstreamJson: incomingSnapshotJson,
    };
  }
  if (!effective) {
    const empty: SubscriptionSourceOverrides = { version: 1, order: [], deletedKeys: [], additions: [], patches: [] };
    return {
      sources: upstream,
      sourceOverridesJson: serializeSubscriptionSourceOverrides(empty),
      upstreamJson: incomingSnapshotJson,
    };
  }

  const previousUpstream = snapshotSources(previous.upstreamJson);
  if (!previousUpstream) {
    const empty = previous.sourceOverridesJson || serializeSubscriptionSourceOverrides({
      version: 1,
      order: [],
      deletedKeys: [],
      additions: [],
      patches: [],
    });
    return {
      sources: effective,
      sourceOverridesJson: empty,
      preserveCurrentProfile: true,
      pendingUpstreamJson: incomingSnapshotJson,
      refreshDiff: diffSubscriptionSources(effective, upstream),
    };
  }

  const overrides = parseSubscriptionSourceOverrides(previous.sourceOverridesJson)
    ?? deriveSubscriptionSourceOverrides(previousUpstream, effective);
  const result: SubscriptionProfileRefreshResult = {
    sources: applySubscriptionSourceOverrides(upstream, overrides),
    sourceOverridesJson: serializeSubscriptionSourceOverrides(overrides),
    upstreamJson: incomingSnapshotJson,
  };
  return result;
}

export function diffSubscriptionSources(
  previous: readonly SourceBean[],
  incoming: readonly SourceBean[],
): SubscriptionSourceRefreshDiff {
  const previousByKey = new Map(previous.map((source) => [source.key, source]));
  const incomingByKey = new Map(incoming.map((source) => [source.key, source]));
  const changed: SubscriptionSourceRefreshDiff['changed'] = [];
  for (const source of incoming) {
    const before = previousByKey.get(source.key);
    if (!before) continue;
    const fields = SOURCE_DIFF_FIELDS.filter((field) => !sameValue(before[field], source[field]));
    if (fields.length) changed.push({ key: source.key, fields: [...fields] });
  }
  return {
    addedKeys: incoming.filter((source) => !previousByKey.has(source.key)).map((source) => source.key),
    removedKeys: previous.filter((source) => !incomingByKey.has(source.key)).map((source) => source.key),
    changed,
  };
}

function snapshotSources(json: string | undefined): SourceBean[] | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!isRecord(raw) || !Array.isArray(raw.sites)) return null;
    return parseSiteConfig(json).config.sites.map(copySource);
  } catch {
    return null;
  }
}

function parseSource(value: unknown): SourceBean | null {
  if (!isRecord(value)) return null;
  return parseSiteConfig(JSON.stringify({ sites: [value] })).config.sites[0] ?? null;
}

function copySource(source: SourceBean): SourceBean {
  const copy: SourceBean = { ...source };
  delete copy.runtimeScope;
  if (source.categories) copy.categories = [...source.categories];
  return copy;
}

function cloneRecord(value: Partial<SourceBean>): Partial<SourceBean> {
  return { ...value, ...(value.categories ? { categories: [...value.categories] } : {}) };
}

function copyValue(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : null;
}

function isSourceOverrideField(value: string): value is SourceOverrideField {
  return (SOURCE_OVERRIDE_FIELDS as readonly string[]).includes(value);
}

function isValidFieldValue(field: SourceOverrideField, value: unknown): boolean {
  if (field === 'categories') return value === null || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
  if (field === 'searchable' || field === 'quickSearch' || field === 'changeable' || field === 'filterable' || field === 'playerType' || field === 'timeout') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return typeof value === 'string';
}
