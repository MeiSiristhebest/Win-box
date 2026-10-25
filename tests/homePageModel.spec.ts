import { describe, expect, it } from 'vitest';
import { nonEmptySourceFilters } from '../src/renderer/features/home/application/homeBrowseFilters';
import { formatSearchCacheTime } from '../src/renderer/features/home/homePageModel';

describe('nonEmptySourceFilters', () => {
  it('omits only empty values and keeps the remaining selections', () => {
    expect(nonEmptySourceFilters({ area: '', year: '2026', language: 'zh' })).toEqual({ year: '2026', language: 'zh' });
  });
});

describe('formatSearchCacheTime', () => {
  it('formats the supplied cache timestamp without depending on the current clock', () => {
    const timestamp = new Date(2026, 0, 2, 3, 4, 0, 0).getTime();

    expect(formatSearchCacheTime(timestamp)).toBe('03:04');
  });

  it('returns no label for invalid or absent timestamps', () => {
    expect(formatSearchCacheTime(0)).toBe('');
    expect(formatSearchCacheTime(Number.NaN)).toBe('');
  });
});
