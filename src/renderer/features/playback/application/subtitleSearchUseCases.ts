import { buildSearchQuery } from '../../../../engine/subtitle/normalizeQuery';
import { parseSubtitleFile, type SubtitleCue } from '../../../../engine/subtitle/parseSubtitle';
import type { SubtitleCandidate, SubtitleSearchReport } from '../../../../shared/subtitle';
import type { SubtitleSearchDependencies, SubtitleSearchPort } from './subtitleSearchPorts';

export async function searchSubtitleCandidates(
  query: string,
  resourceName: string | undefined,
  dependencies: SubtitleSearchDependencies,
): Promise<SubtitleSearchReport> {
  const report = await dependencies.service.search(query);
  if (report.candidates.length && resourceName) {
    const defaultQuery = buildSearchQuery(resourceName);
    if (query !== defaultQuery) {
      const rememberedQueries = dependencies.queryMemory.load();
      rememberedQueries[resourceName] = query;
      dependencies.queryMemory.save(rememberedQueries);
    }
  }
  return report;
}

export type SubtitleCandidatePreparation =
  | { kind: 'download-failed'; reason?: string }
  | { kind: 'parse-failed'; format?: string }
  | { kind: 'ready'; cues: SubtitleCue[]; fileName: string; entries?: number };

export async function prepareSubtitleCandidate(
  candidate: SubtitleCandidate,
  service: Pick<SubtitleSearchPort, 'fetch'>,
): Promise<SubtitleCandidatePreparation> {
  const downloaded = await service.fetch(candidate);
  if (!downloaded?.text) return { kind: 'download-failed', reason: downloaded?.reason };

  const fileName = downloaded.fileName || candidate.subname || candidate.file;
  const cues = parseSubtitleFile(fileName, downloaded.text);
  if (!cues.length) return { kind: 'parse-failed', format: downloaded.format };
  return { kind: 'ready', cues, fileName, entries: downloaded.entries };
}
