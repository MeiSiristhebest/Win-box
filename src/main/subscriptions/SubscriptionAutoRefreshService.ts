import type { ImportReport, Logger } from '../../shared/types';

const SUBSCRIPTION_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SubscriptionAutoRefreshPorts {
  activeSubscriptionUrl(): string;
  lastSuccessfulRefreshAt(): number;
  recordSuccessfulRefreshAt(timestamp: number): void;
  refresh(url: string): Promise<{ report: Pick<ImportReport, 'ok' | 'skipped' | 'degraded'> }>;
  logger: Pick<Logger, 'i' | 'w'>;
}

/** Runs the weekly refresh policy without coupling it to SpiderHost or a file-backed store. */
export class SubscriptionAutoRefreshService {
  constructor(
    private readonly ports: SubscriptionAutoRefreshPorts,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async refreshIfDue(): Promise<boolean> {
    try {
      const url = this.ports.activeSubscriptionUrl().trim();
      if (!/^https?:\/\//i.test(url)) return false;

      const lastAt = this.ports.lastSuccessfulRefreshAt();
      const now = this.now();
      if (lastAt && now - lastAt < SUBSCRIPTION_REFRESH_INTERVAL_MS) return false;

      const result = await this.ports.refresh(url);
      this.ports.recordSuccessfulRefreshAt(this.now());
      this.ports.logger.i(
        `自动订阅刷新完成：${url}（${result.report.ok} 源 OK / 跳过 ${result.report.skipped} / 降级 ${result.report.degraded}）`,
      );
      return true;
    } catch (error) {
      this.ports.logger.w('自动订阅刷新失败：' + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  }
}
