// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useCovers } from '../src/renderer/lib/useCovers';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    metaGetSettings: vi.fn(),
    metaSearch: vi.fn(),
  },
}));

vi.mock('../src/renderer/lib/coverPick', () => ({
  resolveCover: vi.fn(async (_item: unknown, options: { query: (provider: string) => Promise<string> }) => options.query('tmdb')),
  preloadImage: vi.fn(async () => true),
}));

const POSTER = 'https://images.example.test/movie.jpg';

beforeEach(async () => {
  const { client } = await import('../src/renderer/api/client');
  vi.mocked(client.metaGetSettings).mockResolvedValue({
    tmdbApiKey: '', tmdbApiBase: '', tmdbImageBase: '', hasUserKey: true, metaSource: 'tmdb',
  } as never);
  vi.mocked(client.metaSearch).mockResolvedValue({ poster: POSTER } as never);
  vi.mocked(client.metaGetSettings).mockClear();
  vi.mocked(client.metaSearch).mockClear();
});

function Probe({ id }: { id: string }) {
  const item = { id, name: 'Shared title', year: '2025', pic: '' };
  const covers = useCovers([item]);
  return <span>{covers.picOf(item)}</span>;
}

describe('useCovers', () => {
  it('shares settings and metadata requests across components for the same title', async () => {
    render(<><Probe id="a" /><Probe id="b" /></>);

    await waitFor(() => expect(screen.getAllByText(POSTER)).toHaveLength(2));
    const { client } = await import('../src/renderer/api/client');
    expect(client.metaGetSettings).toHaveBeenCalledTimes(1);
    expect(client.metaSearch).toHaveBeenCalledTimes(1);
  });
});
