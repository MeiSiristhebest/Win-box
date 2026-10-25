import {
  newSourceStat,
  noteSourceFail,
  noteSourceOk,
  scheduleOrder,
  sourceBudgetMs,
  type SourceStat,
} from './searchScheduler';

export interface SearchHealthSource {
  key: string;
  runtimeScope?: string;
}

/** Session-local search history shared by aggregate search and spider prewarming. */
export class SourceSearchHealth {
  private readonly statistics = new Map<string, SourceStat>();

  constructor(private readonly now: () => number = Date.now) {}

  scheduleOrder(sources: readonly SearchHealthSource[]): number[] {
    return scheduleOrder(
      sources.length,
      (index) => this.scopeOf(sources[index]),
      this.statistics,
      this.now(),
    );
  }

  budget(source: SearchHealthSource, declaredTimeoutMs: number, maximumMs: number): number {
    return sourceBudgetMs(
      this.statistics.get(this.scopeOf(source)),
      declaredTimeoutMs,
      maximumMs,
      this.now(),
    );
  }

  succeeded(scope: string, elapsedMs: number, empty: boolean): void {
    noteSourceOk(this.statOf(scope), elapsedMs, { empty, now: this.now() });
  }

  failed(scope: string): void {
    noteSourceFail(this.statOf(scope), this.now());
  }

  clear(): void {
    this.statistics.clear();
  }

  private scopeOf(source: SearchHealthSource): string {
    return source.runtimeScope || source.key;
  }

  private statOf(scope: string): SourceStat {
    let statistic = this.statistics.get(scope);
    if (!statistic) {
      statistic = newSourceStat();
      this.statistics.set(scope, statistic);
    }
    return statistic;
  }
}
