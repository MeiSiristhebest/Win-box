import type { VodDetail } from '../../shared/types';
import { driveBindHintFromPlaySources, driveProviderKeyFromHint } from '../../shared/driveProvider';

export interface LearnedDriveBindingStore {
  getObject<T>(key: string, fallback: T): T;
  setObject<T>(key: string, value: T): void;
  flush(): void;
}

export interface DriveBindingLearningLogger {
  i(message: string): void;
  w(message: string): void;
}

/** Learns which sources require a drive account from observed detail and playback data. */
export class DriveBindingRequirementLearning {
  private readonly requiredSources: Set<string>;
  private readonly providerBySource = new Map<string, string>();

  constructor(
    private readonly store: LearnedDriveBindingStore,
    private readonly logger: DriveBindingLearningLogger,
  ) {
    const saved = store.getObject<unknown>('list', null);
    this.requiredSources = new Set(
      Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string' && key.length > 0) : [],
    );
  }

  markRequired(sourceKey: string): void {
    const key = sourceKey.trim();
    if (!key || this.requiredSources.has(key)) return;
    this.requiredSources.add(key);
    try {
      this.store.setObject('list', [...this.requiredSources]);
      this.store.flush();
    } catch (error) {
      this.logger.w(`drive-bind 学习结果落盘失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  learnedSourceKeys(): string[] {
    return [...this.requiredSources];
  }

  rememberProvider(sourceKey: string, provider: string): void {
    const key = sourceKey.trim();
    const value = provider.trim();
    if (key && value) this.providerBySource.set(key, value);
  }

  providerForGenericAuth(message: string, sourceKey: string): string | null {
    if (!/(授权|登录|扫码|cookie|token|未绑定|绑定)/i.test(message)) return null;
    return this.providerBySource.get(sourceKey) || null;
  }

  learnFromDetail(sourceKey: string, detail: VodDetail | null): void {
    const hint = driveBindHintFromPlaySources(
      detail?.flags,
      detail ? Object.values(detail.episodes || {}).flat().map((episode) => episode.url) : null,
    );
    if (!hint) return;
    this.logger.i(`detect 详情播放源含网盘（${hint}）→ 记入绑定清单: ${sourceKey}`);
    const provider = driveProviderKeyFromHint(hint);
    if (provider) this.rememberProvider(sourceKey, provider);
    this.markRequired(sourceKey);
  }
}
