import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import { auditSources, type SourceAuditPorts } from '../src/engine/vod/SourceAudit';

function source(key: string, type: number, api = 'https://example.test/api', ext = ''): SourceBean {
  return { key, name: key, type, api, ext } as SourceBean;
}

function ports(overrides: Partial<SourceAuditPorts> = {}): SourceAuditPorts {
  let now = 100;
  const withTimeout: SourceAuditPorts['withTimeout'] = async (operation) => operation;
  return {
    loadHome: vi.fn(async () => ({ items: [], sortClasses: [] })),
    withTimeout,
    now: () => now++,
    ...overrides,
  };
}

describe('auditSources', () => {
  it('classifies supported source kinds, reports outcomes, and excludes unsupported source types', async () => {
    const configured = [
      source('cms', 0),
      source('rules', 3, 'https://example.test/rule.js'),
      source('python', 3, 'https://example.test/site.py'),
      source('jar', 3, 'https://example.test/api', '{siteUrl:"https://example.test"}'),
      source('unsupported', 2),
    ];
    const auditPorts = ports({
      loadHome: vi.fn(async (item: SourceBean) => {
        if (item.key === 'cms') return { items: [{}], sortClasses: [], homeFallback: true };
        if (item.key === 'python') throw new Error('network unavailable');
        return { items: [], sortClasses: [] };
      }),
    });

    const report = await auditSources(configured, auditPorts);

    expect(report.map((item) => item.key)).toEqual(['cms', 'rules', 'python', 'jar']);
    expect(report.map((item) => item.kind)).toEqual(['cms-xml', 'js', 'py', 'jar']);
    expect(report[0]).toMatchObject({ health: 'ok-content', usable: true, homeFallback: true });
    expect(report[1]).toMatchObject({ health: 'needs-ext', needsExt: true });
    expect(report[2]).toMatchObject({ health: 'error', error: 'network unavailable' });
    expect(report[3]).toMatchObject({ health: 'empty', extEmpty: false });
    expect(auditPorts.loadHome).toHaveBeenCalledTimes(4);
  });

  it('bounds concurrency and returns results in configured source order', async () => {
    const configured = ['first', 'second', 'third', 'fourth', 'fifth'].map((key) => source(key, 0));
    let active = 0;
    let maximumActive = 0;
    const auditPorts = ports({
      loadHome: vi.fn(async (item: SourceBean) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, item.key === 'first' ? 10 : 1));
        active -= 1;
        return { items: [item.key], sortClasses: [] };
      }),
    });

    const report = await auditSources(configured, auditPorts, { concurrency: 2 });

    expect(maximumActive).toBe(2);
    expect(report.map((item) => item.key)).toEqual(configured.map((item) => item.key));
  });

  it('passes the timeout contract to the injected timeout adapter', async () => {
    const calls: { operation: Promise<unknown>; timeoutMs: number; message: string }[] = [];
    const withTimeout: SourceAuditPorts['withTimeout'] = async (operation, timeoutMs, message) => {
      calls.push({ operation, timeoutMs, message });
      return operation;
    };

    await auditSources([source('one', 0)], ports({ withTimeout }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ timeoutMs: 30_000, message: '主页加载超时（>30s）' });
    expect(calls[0].operation).toBeInstanceOf(Promise);
  });
});
