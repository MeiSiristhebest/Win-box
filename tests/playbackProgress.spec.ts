import { describe, expect, it } from 'vitest';
import { playbackProgressKey, type PlaybackSourceRef } from '../src/renderer/lib/playbackProgress';

type ProfileWithoutKeyIsRejected = { profileId: string } extends PlaybackSourceRef ? false : true;
const profileWithoutKeyIsRejected: ProfileWithoutKeyIsRejected = true;
void profileWithoutKeyIsRejected;

describe('playback progress identity', () => {
  it('keeps the URL key for playback without a saved profile identity', () => {
    expect(playbackProgressKey('episode-url')).toBe('episode-url');
    expect(playbackProgressKey('episode-url', { key: 'source-a' })).toBe('episode-url');
  });

  it('separates the same URL across subscription profiles', () => {
    expect(playbackProgressKey('episode-url', { profileId: 'profile-a', key: 'source' }))
      .not.toBe(playbackProgressKey('episode-url', { profileId: 'profile-b', key: 'source' }));
  });

  it('separates sources in the same profile', () => {
    expect(playbackProgressKey('episode-url', { profileId: 'profile', key: 'source-a' }))
      .not.toBe(playbackProgressKey('episode-url', { profileId: 'profile', key: 'source-b' }));
  });

  it('trims profile and source identifiers before building the key', () => {
    expect(playbackProgressKey('episode-url', { profileId: ' profile ', key: ' source ' }))
      .toBe(playbackProgressKey('episode-url', { profileId: 'profile', key: 'source' }));
  });

  it('uses a dedicated composite namespace for profile-scoped keys', () => {
    expect(playbackProgressKey('episode-url', { profileId: 'profile', key: 'source' }))
      .toMatch(/^playback-progress:/);
  });
});
