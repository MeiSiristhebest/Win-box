import { parseSiteConfigWithBase, type ParseResult } from '../../engine/config/ApiConfigParser';
import { parseMultiRepo, splitRepoLine, type MultiRepo } from '../../engine/config/multiRepo';
import type { SubscriptionGroupMember } from '../../shared/types';
import { selectSubscriptionImportMemberIds } from './subscriptionImportSelection';
import type {
  SubscriptionImportProgressPatch,
  SubscriptionImportRunner,
} from './SubscriptionImportService';

export interface MultiRepositoryJobOptions {
  name: string;
  preferredLine: number;
  subscriptionUrl: string;
  signal: AbortSignal;
  onlyMemberIds?: ReadonlySet<string>;
  onProgress: (patch: SubscriptionImportProgressPatch) => void;
  expectedConfigRevision: number;
}

/** Side effects required by the subscription import use case. */
export interface SubscriptionImportRunnerPorts {
  currentConfigRevision(): number;
  groupMembers(sourceUrl: string): readonly Pick<SubscriptionGroupMember, 'id' | 'status'>[];
  fetchConfigText(url: string, signal: AbortSignal): Promise<string>;
  importMultiRepo(multi: MultiRepo, options: MultiRepositoryJobOptions): Promise<ParseResult>;
  commitImportedConfig(result: ParseResult, sourceUrl: string, name: string): void;
}

/** Builds a resumable runner while keeping network and persistence behind ports. */
export function createSubscriptionImportRunner(
  sourceUrl: string,
  name: string,
  ports: SubscriptionImportRunnerPorts,
): SubscriptionImportRunner {
  const initialConfigRevision = ports.currentConfigRevision();
  let initialRun = true;
  let rootLoaded = false;
  let rootText = '';
  let multiPlan: MultiRepo | null = null;

  return async (signal, selection, update, checkpoint, saveCheckpoint) => {
    const startRevision = initialRun ? initialConfigRevision : ports.currentConfigRevision();
    initialRun = false;
    const root = splitRepoLine(sourceUrl);
    if (!rootLoaded) {
      if (checkpoint.multiRepoItems) {
        multiPlan = { items: checkpoint.multiRepoItems.map((item) => ({ ...item })) };
        rootLoaded = true;
      } else {
        update({ state: 'resolving', message: '正在读取订阅清单…' });
        try {
          rootText = await ports.fetchConfigText(root.url, signal);
          multiPlan = parseMultiRepo(rootText);
          rootLoaded = true;
          if (multiPlan) {
            saveCheckpoint({
              multiRepoItems: multiPlan.items.map((item) => ({
                url: item.url,
                ...(item.name ? { name: item.name } : {}),
              })),
            });
          }
        } catch (error) {
          update(signal.aborted
            ? { total: 1, completed: 0, succeeded: 0, failed: 0, pending: 1 }
            : { total: 1, completed: 0, succeeded: 0, failed: 1, pending: 0 });
          throw error;
        }
      }
    }

    if (multiPlan) {
      const lineOnly = root.line >= 0;
      const onlyMemberIds = selectSubscriptionImportMemberIds(
        ports.groupMembers(sourceUrl),
        selection,
        lineOnly,
      );
      const result = await ports.importMultiRepo(multiPlan, {
        name,
        preferredLine: root.line,
        subscriptionUrl: sourceUrl,
        signal,
        onlyMemberIds,
        onProgress: update,
        expectedConfigRevision: startRevision,
      });
      return result.warnings?.at(-1) || '多仓导入完成';
    }

    try {
      const result = parseSiteConfigWithBase(rootText, root.url);
      if (!result.config.sites.length && !result.config.lives.length && !result.config.parses.length) {
        throw new Error('该订阅里没有可用的源；已保留原配置');
      }
      if (ports.currentConfigRevision() !== startRevision) {
        throw new Error('配置已在导入期间更改；本次结果未覆盖现有配置，请重新导入');
      }
      if (signal.aborted) throw signal.reason ?? new Error('导入已取消');
      ports.commitImportedConfig(result, sourceUrl, name);
      update({ total: 1, completed: 1, succeeded: 1, failed: 0, pending: 0, currentName: name || sourceUrl });
      return '订阅导入完成';
    } catch (error) {
      rootLoaded = false;
      update(signal.aborted
        ? { total: 1, completed: 0, succeeded: 0, failed: 0, pending: 1 }
        : { total: 1, completed: 0, succeeded: 0, failed: 1, pending: 0 });
      throw error;
    }
  };
}
