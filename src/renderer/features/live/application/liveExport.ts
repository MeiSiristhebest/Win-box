import type { LiveTemplateView } from '../../../../shared/plugin';
import type { LiveGroup } from '../../../../shared/types';

export interface LiveExportPort {
  listTemplates(): Promise<LiveTemplateView[]>;
  exportGroups(input: { templateId: string; groups: LiveGroup[]; defaultName: string }): Promise<{ saved: boolean; path: string }>;
}

export interface LiveExportTemplate {
  id: string;
  ext: string;
}

export function selectLiveExportTemplate<T extends LiveExportTemplate>(templates: T[], selectedId: string): T | null {
  return templates.find((template) => template.id === selectedId) ?? templates[0] ?? null;
}
