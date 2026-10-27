import { describe, expect, it } from 'vitest';
import type { DiscoverSection } from '../src/shared/types';
import { projectBoardDirectory } from '../src/renderer/features/discovery/application/boardDirectoryPresentation';

const sections: DiscoverSection[] = [
  { id: 'popular', title: '热门', items: Array.from({ length: 4 }, (_, index) => ({ title: `影片 ${index}` } as DiscoverSection['items'][number])) },
];

describe('projectBoardDirectory', () => {
  it('does not present TMDB boards as locked while the credential check is unknown', () => {
    const projection = projectBoardDirectory(sections, { hasCredentials: null, status: 'idle' }, { categoryId: '', query: '' });

    expect(projection.lockedBoards).toEqual([]);
    expect(projection.previews.popular?.items).toHaveLength(3);
  });

  it('shows TMDB boards as locked only after a successful negative credential check', () => {
    const projection = projectBoardDirectory(sections, { hasCredentials: false, status: 'ready' }, { categoryId: '', query: '' });

    expect(projection.lockedBoards.length).toBeGreaterThan(0);
    expect(projection.boards.some((board) => board.provider.toLocaleLowerCase().includes('tmdb'))).toBe(false);
  });

  it('filters board title, description, provider, and category consistently', () => {
    const projection = projectBoardDirectory([], { hasCredentials: true, status: 'ready' }, { categoryId: 'movie', query: 'douban' });

    expect(projection.boards.length).toBeGreaterThan(0);
    expect(projection.boards.every((board) => board.category === 'movie')).toBe(true);
    expect(projection.boards.every((board) => `${board.title} ${board.description} ${board.provider}`.toLocaleLowerCase().includes('douban'))).toBe(true);
  });

  it.each(['loading', 'failed'] as const)('does not present cached negative credentials as current while status is %s', (status) => {
    const projection = projectBoardDirectory(sections, { hasCredentials: false, status }, { categoryId: '', query: '' });

    expect(projection.lockedBoards).toEqual([]);
    expect(projection.boards.some((board) => board.provider.toLocaleLowerCase().includes('tmdb'))).toBe(false);
  });
});
