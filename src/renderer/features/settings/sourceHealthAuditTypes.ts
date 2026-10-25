export type AuditFilter = 'all' | 'usable' | 'needs-ext' | 'bad';

export interface SourceHealthAuditNotice {
  text: string;
  kind: 'ok' | 'err';
}
