import { describe, expect, it } from 'vitest';
import { pluginSectionToBoard } from '../src/shared/discoverBoards';

describe('plugin discover board categories', () => {
  it.each([
    ['movie', 'movie'],
    ['tv', 'tv'],
  ] as const)('preserves %s sections in the matching category filter', (mediaType, category) => {
    const board = pluginSectionToBoard({
      id: `plugin-${mediaType}`,
      browseId: `plugin:sample:${mediaType}`,
      title: `${mediaType} feed`,
      mediaType,
    });

    expect(board).toMatchObject({
      id: `plugin:sample:${mediaType}`,
      provider: 'plugin',
      mediaType,
      category,
    });
  });
});
