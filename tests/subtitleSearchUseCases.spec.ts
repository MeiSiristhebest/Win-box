import { describe, expect, it, vi } from 'vitest';
import type { SubtitleCandidate, SubtitleFetchResult, SubtitleSearchReport } from '../src/shared/subtitle';
import { buildSearchQuery } from '../src/engine/subtitle/normalizeQuery';
import type { SubtitleSearchDependencies } from '../src/renderer/features/playback/application/subtitleSearchPorts';
import { prepareSubtitleCandidate, searchSubtitleCandidates } from '../src/renderer/features/playback/application/subtitleSearchUseCases';

const candidate: SubtitleCandidate = { file: 'download-id', subname: 'Example.mkv' };

function createDependencies(report: SubtitleSearchReport): SubtitleSearchDependencies {
  let remembered: Record<string, string> = {};
  return {
    service: {
      listProviders: async () => [],
      search: vi.fn(async () => report),
      fetch: async () => ({ text: '', fileName: '' }),
      enableSubtitles: async () => undefined,
    },
    queryMemory: {
      load: vi.fn(() => ({ ...remembered })),
      save: vi.fn((next) => { remembered = { ...next }; }),
    },
  };
}

describe('subtitle search application use cases', () => {
  it('remembers a custom query only after a hit', async () => {
    const dependencies = createDependencies({ candidates: [candidate], providers: [] });

    await searchSubtitleCandidates('alternate title', 'Example Series 第 1 集', dependencies);

    expect(dependencies.service.search).toHaveBeenCalledWith('alternate title');
    expect(dependencies.queryMemory.save).toHaveBeenCalledWith({ 'Example Series 第 1 集': 'alternate title' });
  });

  it('does not save the generated query or a no-hit query', async () => {
    const defaultDependencies = createDependencies({ candidates: [candidate], providers: [] });
    const resourceName = 'Example Series 第 1 集';
    await searchSubtitleCandidates(buildSearchQuery(resourceName), resourceName, defaultDependencies);
    expect(defaultDependencies.queryMemory.save).not.toHaveBeenCalled();

    const noHitDependencies = createDependencies({ candidates: [], providers: [] });
    await searchSubtitleCandidates('alternate title', 'Example Series 第 1 集', noHitDependencies);
    expect(noHitDependencies.queryMemory.save).not.toHaveBeenCalled();
  });

  it('parses the downloaded file using its actual filename', async () => {
    const fetch = vi.fn(async (): Promise<SubtitleFetchResult> => ({
      text: '[Script Info]\nTitle: Example\n[V4+ Styles]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello\n',
      fileName: 'episode.ass',
      format: 'ass',
      entries: 2,
    }));

    const prepared = await prepareSubtitleCandidate(candidate, { fetch });

    expect(fetch).toHaveBeenCalledWith(candidate);
    expect(prepared).toMatchObject({ kind: 'ready', fileName: 'episode.ass', entries: 2 });
    if (prepared.kind === 'ready') expect(prepared.cues).toEqual([{ start: 1, end: 2, text: 'Hello' }]);
  });

  it('keeps download and parse failures distinct', async () => {
    await expect(prepareSubtitleCandidate(candidate, { fetch: async () => ({ text: '', fileName: '', reason: 'source unavailable' }) }))
      .resolves.toEqual({ kind: 'download-failed', reason: 'source unavailable' });
    await expect(prepareSubtitleCandidate(candidate, { fetch: async () => ({ text: 'not a subtitle', fileName: 'episode.srt', format: 'srt' }) }))
      .resolves.toEqual({ kind: 'parse-failed', format: 'srt' });
  });
});
