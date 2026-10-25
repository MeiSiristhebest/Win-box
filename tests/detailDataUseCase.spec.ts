import { describe, expect, it, vi } from 'vitest';
import { loadDetailRoute } from '../src/renderer/features/detail/application/detailDataUseCase';
import type { DetailDataPort } from '../src/renderer/features/detail/application/detailDataPorts';
import type { VodDetail } from '../src/shared/types';

const detail: VodDetail = {
  id: 'title-id', name: 'Title', pic: '', type: '', year: '', area: '', director: '', actor: '', des: '', remarks: '',
  flags: ['slow', 'preferred'],
  episodes: { slow: [{ name: '第1集', url: 'slow-1' }], preferred: Array.from({ length: 55 }, (_, index) => ({ name: `第${index + 1}集`, url: String(index + 1) })) },
};

describe('loadDetailRoute', () => {
  it('restores valid profile-scoped selection and remembers it with scroll position', async () => {
    const port: DetailDataPort = {
      readActiveProfileId: vi.fn(async () => 'active'),
      loadDetail: vi.fn(async () => detail),
      readSelection: vi.fn(() => ({ flag: 'preferred', ep: 51, scrollTop: 410 })),
      rememberSelection: vi.fn(),
    };
    const result = await loadDetailRoute({ key: 'source', id: 'title-id', requestedProfileId: 'profile-B' }, port);
    expect(port.loadDetail).toHaveBeenCalledWith('source', 'title-id', 'profile-B');
    expect(port.readSelection).toHaveBeenCalledWith('profile-B:source:title-id');
    expect(result).toMatchObject({ profileId: 'profile-B', memoryKey: 'profile-B:source:title-id', flag: 'preferred', episodeIndex: 51, episodePage: 1 });
    expect(port.rememberSelection).toHaveBeenCalledWith('profile-B:source:title-id', { flag: 'preferred', ep: 51, scrollTop: 410 });
  });

  it('uses the active profile and the existing preferred-flag policy when no selection exists', async () => {
    const port: DetailDataPort = {
      readActiveProfileId: vi.fn(async () => 'active-profile'),
      loadDetail: vi.fn(async () => detail),
      readSelection: vi.fn(() => undefined),
      rememberSelection: vi.fn(),
    };
    const result = await loadDetailRoute({ key: 'source', id: 'title-id', requestedProfileId: '' }, port);
    expect(port.loadDetail).toHaveBeenCalledWith('source', 'title-id', 'active-profile');
    expect(result).toMatchObject({ profileId: 'active-profile', flag: 'slow', episodeIndex: 0, episodePage: 0 });
  });

  it('falls back when remembered source or episode is no longer available', async () => {
    const port: DetailDataPort = {
      readActiveProfileId: vi.fn(async () => 'active'),
      loadDetail: vi.fn(async () => detail),
      readSelection: vi.fn(() => ({ flag: 'removed-source', ep: 999, scrollTop: 12 })),
      rememberSelection: vi.fn(),
    };
    const result = await loadDetailRoute({ key: 'source', id: 'title-id', requestedProfileId: 'A' }, port);
    expect(result).toMatchObject({ flag: 'slow', episodeIndex: 0, episodePage: 0 });
    expect(port.rememberSelection).toHaveBeenCalledWith('A:source:title-id', { flag: 'slow', ep: 0, scrollTop: 12 });
  });

  it('does not create selection memory when detail has no playable source', async () => {
    const noPlaybackDetail = { ...detail, flags: [], episodes: {} };
    const port: DetailDataPort = {
      readActiveProfileId: vi.fn(async () => 'active'),
      loadDetail: vi.fn(async () => noPlaybackDetail),
      readSelection: vi.fn(),
      rememberSelection: vi.fn(),
    };
    const result = await loadDetailRoute({ key: 'source', id: 'title-id', requestedProfileId: 'A' }, port);
    expect(result).toMatchObject({ detail: noPlaybackDetail, flag: '', episodeIndex: 0, episodePage: 0 });
    expect(port.readSelection).not.toHaveBeenCalled();
    expect(port.rememberSelection).not.toHaveBeenCalled();
  });
});
