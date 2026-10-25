import { parseSiteConfig, parseSiteConfigWithBase, type ParseResult } from '../../engine/config/ApiConfigParser';
import { parseMultiRepo, splitRepoLine, type MultiRepo } from '../../engine/config/multiRepo';

export interface SubscriptionConfigImportSource {
  url?: string;
  json?: string;
  name?: string;
}

export interface SubscriptionConfigImportOptions {
  snapshot: boolean;
  signal?: AbortSignal;
}

export interface MultiRepositoryImportOptions {
  snapshot: boolean;
  name: string;
  preferredLine: number;
  subscriptionUrl: string;
  signal?: AbortSignal;
  expectedConfigRevision: number;
}

/** Network, profile persistence, and multi-repository work are application ports. */
export interface SubscriptionConfigImportPorts {
  currentConfigRevision(): number;
  fetchConfigWithDiagnostics(url: string, signal?: AbortSignal): Promise<{ text: string; hint: string }>;
  importMultiRepo(multi: MultiRepo, options: MultiRepositoryImportOptions): Promise<ParseResult>;
  commitParsedConfig(result: ParseResult, sourceUrl: string, snapshot: boolean, name: string): void;
}

/** Resolves and validates an import before allowing its adapter to commit it. */
export async function importSubscriptionConfig(
  source: SubscriptionConfigImportSource,
  options: SubscriptionConfigImportOptions,
  ports: SubscriptionConfigImportPorts,
): Promise<ParseResult> {
  const snapshot = options.snapshot;
  const expectedConfigRevision = ports.currentConfigRevision();
  let fetched = { text: source.json || '', hint: '' };
  const subscription = splitRepoLine(source.url || '');
  if (source.url) fetched = await ports.fetchConfigWithDiagnostics(subscription.url, options.signal);
  if (options.signal?.aborted) throw options.signal.reason ?? new Error('导入已取消；已保留原配置不变');

  const { text, hint } = fetched;
  const multi = parseMultiRepo(text);
  if (multi) {
    return ports.importMultiRepo(multi, {
      snapshot,
      name: source.name || '',
      preferredLine: subscription.line,
      subscriptionUrl: source.url || '',
      signal: options.signal,
      expectedConfigRevision,
    });
  }

  let result: ParseResult;
  try {
    result = source.url
      ? parseSiteConfigWithBase(text, subscription.url)
      : parseSiteConfig(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${hint ? `｜诊断：${hint}` : ''}`);
  }

  if (!result.config.sites.length && !result.config.lives.length && !result.config.parses.length) {
    throw new Error(
      '该订阅里没有任何可用的源（可能是未识别的「多仓」格式，或订阅本身已失效）；已保留原配置不变' +
      (hint ? `｜诊断：${hint}` : ''),
    );
  }
  if (options.signal?.aborted) throw options.signal.reason ?? new Error('导入已取消；已保留原配置不变');
  if (ports.currentConfigRevision() !== expectedConfigRevision) {
    throw new Error('配置已在导入期间更改；本次结果未覆盖现有配置，请重新导入');
  }

  ports.commitParsedConfig(result, source.url || '', snapshot, source.name || '');
  return result;
}
