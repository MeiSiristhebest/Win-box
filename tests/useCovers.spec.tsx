// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useCovers } from '../src/renderer/features/covers/useCovers';
import { CoversProvider } from '../src/renderer/features/covers/CoverLookupContext';
import type { CoverLookupPort } from '../src/renderer/features/covers/application/coverLookupPort';

vi.mock('../src/renderer/lib/coverPick', () => ({
  resolveCover: vi.fn(async (_item: unknown, options: { query: (provider: string) => Promise<string> }) => options.query('tmdb')),
  preloadImage: vi.fn(async () => true),
}));

const POSTER = 'https://images.example.test/movie.jpg';
const coverLookup: CoverLookupPort = {
  loadSettings: vi.fn(),
  searchPoster: vi.fn(),
};
const coverRuntimePorts = {
  lookup: coverLookup,
  settingsChanges: { subscribe: vi.fn(() => () => undefined) },
  images: { validate: vi.fn(async () => true), relay: (url: string) => url },
  clock: { now: () => Date.now() },
};

beforeEach(() => {
  vi.mocked(coverLookup.loadSettings).mockResolvedValue({ key: 'tmdb', hasTmdb: true });
  vi.mocked(coverLookup.searchPoster).mockResolvedValue(POSTER);
  vi.mocked(coverLookup.loadSettings).mockClear();
  vi.mocked(coverLookup.searchPoster).mockClear();
});

function Probe({ id }: { id: string }) {
  const item = { id, name: 'Shared title', year: '2025', pic: '' };
  const covers = useCovers([item]);
  return <span>{covers.picOf(item)}</span>;
}

describe('useCovers', () => {
  it('shares settings and metadata requests across components for the same title', async () => {
    render(<CoversProvider ports={coverRuntimePorts}><><Probe id="a" /><Probe id="b" /></></CoversProvider>);

    await waitFor(() => expect(screen.getAllByText(POSTER)).toHaveLength(2));
    expect(coverLookup.loadSettings).toHaveBeenCalledTimes(1);
    expect(coverLookup.searchPoster).toHaveBeenCalledTimes(1);
  });
});
