import type { AuditItem, SourceBean } from '../../shared/types';
import { classifyHealth } from './sourceHealth';

export interface SourceAuditHome {
  items: unknown[];
  sortClasses: unknown[];
  homeFallback?: boolean;
}

export interface SourceAuditPorts {
  loadHome(source: SourceBean): Promise<SourceAuditHome>;
  withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T>;
  now(): number;
}

function auditKindOf(source: SourceBean): AuditItem['kind'] {
  if (source.type === 0) return 'cms-xml';
  if (source.type === 1 || source.type === 4) return 'cms-json';
  const api = String(source.api || '').toLowerCase();
  if (api.endsWith('.js')) return 'js';
  if (api.endsWith('.py')) return 'py';
  return 'jar';
}

function canAudit(source: SourceBean): boolean {
  return source.type === 0 || source.type === 1 || source.type === 3 || source.type === 4;
}

function auditItem(
  source: SourceBean,
  kind: AuditItem['kind'],
  startedAt: number,
  now: () => number,
  result: SourceAuditHome | null,
  error?: string,
): AuditItem {
  const extEmpty = !String(source.ext || '').trim();
  const items = result?.items.length ?? 0;
  const classes = result?.sortClasses.length ?? 0;
  const health = classifyHealth({ kind, items, classes, extEmpty, error });

  return {
    key: source.key,
    name: source.name || source.key,
    type: source.type,
    kind,
    items,
    classes,
    homeFallback: result?.homeFallback,
    extEmpty,
    error,
    ms: Math.max(0, now() - startedAt),
    health: health.health,
    usable: health.usable,
    needsExt: health.needsExt,
    advice: health.advice,
  };
}

/** Audit configured source home pages with bounded concurrency and stable source order. */
export async function auditSources(
  sources: readonly SourceBean[],
  ports: SourceAuditPorts,
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<AuditItem[]> {
  const pool = sources.filter(canAudit);
  if (pool.length === 0) return [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, pool.length));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const out = Array.from({ length: pool.length }) as AuditItem[];
  let cursor = 0;

  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= pool.length) return;
      const source = pool[index];
      const startedAt = ports.now();
      const kind = auditKindOf(source);
      try {
        const home = await ports.withTimeout(ports.loadHome(source), timeoutMs, '主页加载超时（>30s）');
        out[index] = auditItem(source, kind, startedAt, ports.now, home);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out[index] = auditItem(source, kind, startedAt, ports.now, null, message);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return out;
}
