import { describe, expect, it } from 'vitest';
import { reduceSkipSegmentsDraft, type SkipSegmentsDraft } from '../src/renderer/features/playback/application/skipSegmentsDraft';

describe('skip segment draft state', () => {
  it('applies an intro edit without changing the previous snapshot', () => {
    const current: SkipSegmentsDraft = { intro: '90', outro: '120' };

    const next = reduceSkipSegmentsDraft(current, { type: 'change-intro', value: '45' });

    expect(next).toEqual({ intro: '45', outro: '120' });
    expect(current).toEqual({ intro: '90', outro: '120' });
  });

  it('preserves an empty edit while the user is clearing a field', () => {
    const current: SkipSegmentsDraft = { intro: '90', outro: '120' };

    expect(reduceSkipSegmentsDraft(current, { type: 'change-outro', value: '' }))
      .toEqual({ intro: '90', outro: '' });
  });

  it('returns the same snapshot when an edit does not change its field', () => {
    const current: SkipSegmentsDraft = { intro: '90', outro: '120' };

    expect(reduceSkipSegmentsDraft(current, { type: 'change-intro', value: '90' })).toBe(current);
  });
});
