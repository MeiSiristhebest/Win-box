import type { SourceBean, SourceUpdatePatch } from '../../../shared/types';

export interface SourceManagementDraft {
  name: string;
  ext: string;
  jar: string;
  playUrl: string;
  timeout: string;
  searchable: string;
  quickSearch: string;
  changeable: string;
  filterable: string;
}

export function createSourceManagementDraft(source: SourceBean): SourceManagementDraft {
  return {
    name: source.name,
    ext: source.ext,
    jar: source.jar,
    playUrl: source.playUrl,
    timeout: String(source.timeout ?? ''),
    searchable: String(source.searchable ?? 1),
    quickSearch: String(source.quickSearch ?? 1),
    changeable: String(source.changeable ?? 1),
    filterable: String(source.filterable ?? 1),
  };
}

function integerOr(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function toSourceUpdatePatch(draft: SourceManagementDraft): SourceUpdatePatch {
  return {
    name: draft.name,
    ext: draft.ext,
    jar: draft.jar,
    playUrl: draft.playUrl,
    timeout: integerOr(draft.timeout, 15),
    searchable: integerOr(draft.searchable, 1),
    quickSearch: integerOr(draft.quickSearch, 1),
    changeable: integerOr(draft.changeable, 1),
    filterable: integerOr(draft.filterable, 1),
  };
}
