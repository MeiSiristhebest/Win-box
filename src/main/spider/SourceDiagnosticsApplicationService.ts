import type { HttpClient, Logger, SourceBean, SourceDebugReport } from '../../shared/types';
import { auditSources, type SourceAuditHome } from '../../engine/vod/SourceAudit';
import type { SourceAuditPorts } from '../../engine/vod/SourceAudit';
import { sourceDebug } from './SourceDebugger';

/** Query capability owned by source diagnostics rather than by the spider host. */
export interface SourceDiagnosticsCatalogPort {
  currentSources(): readonly SourceBean[];
  findSource(key: string): SourceBean | null;
}

/** Only the source operations required to diagnose a configured source. */
export interface SourceDiagnosticsGatewayPort {
  home(source: SourceBean): Promise<SourceAuditHome>;
}

export interface SourceDiagnosticsApplicationPorts {
  catalog: SourceDiagnosticsCatalogPort;
  gateway: SourceDiagnosticsGatewayPort;
  http: HttpClient;
  logger: Logger;
  globalSpiderJar(): string;
  withTimeout: SourceAuditPorts['withTimeout'];
  now(): number;
}

/** Source health and live diagnostics, independent from IPC registration and host lifecycle. */
export class SourceDiagnosticsApplicationService {
  constructor(private readonly ports: SourceDiagnosticsApplicationPorts) {}

  auditAll() {
    return auditSources(this.ports.catalog.currentSources(), {
      loadHome: (source) => this.ports.gateway.home(source),
      withTimeout: this.ports.withTimeout,
      now: this.ports.now,
    });
  }

  async debug(key: string): Promise<SourceDebugReport> {
    const source = this.ports.catalog.findSource(key);
    if (!source) throw new Error(`源不存在: ${key}`);

    const runHome = async (_sourceKey: string) => {
      const startedAt = this.ports.now();
      try {
        const result = await this.ports.gateway.home(source);
        return {
          ok: true,
          ms: this.ports.now() - startedAt,
          classes: result.sortClasses.length,
          items: result.items.length,
          head: JSON.stringify(result.items[0] ?? result.sortClasses[0] ?? null).slice(0, 200),
        };
      } catch (error) {
        return {
          ok: false,
          ms: this.ports.now() - startedAt,
          classes: 0,
          items: 0,
          head: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    return sourceDebug(source, {
      http: this.ports.http,
      logger: this.ports.logger,
      globalSpiderJar: this.ports.globalSpiderJar(),
    }, runHome);
  }
}
