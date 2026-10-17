// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { useDetailDataController } from '../src/renderer/features/detail/useDetailDataController';
import type { VodDetail } from '../src/shared/types';
import { uiMem } from '../src/renderer/lib/uiMemory';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    cfgGet: vi.fn(),
    detail: vi.fn(),
  },
}));

vi.mock('../src/renderer/lib/uiMemory', () => ({
  uiMem: { detail: { get: vi.fn(), set: vi.fn() } },
}));

function detail(name: string): VodDetail {
  return {
    id: name,
    name,
    pic: '',
    type: '',
    year: '',
    area: '',
    director: '',
    actor: '',
    des: '',
    remarks: '',
    flags: [],
    episodes: {},
  };
}

function route(key: string, id: string, profileId: string) {
  return { key, id, requestedProfileId: profileId, routeKey: `${key}\u0000${id}\u0000${profileId}` };
}

beforeEach(() => {
  vi.mocked(client.cfgGet).mockReset();
  vi.mocked(client.detail).mockReset();
  vi.mocked(uiMem.detail.get).mockReset();
  vi.mocked(uiMem.detail.set).mockReset();
  vi.mocked(client.cfgGet).mockResolvedValue({ activeProfileId: 'profile-default' } as Awaited<ReturnType<typeof client.cfgGet>>);
  vi.mocked(client.detail).mockResolvedValue(null);
  vi.mocked(uiMem.detail.get).mockReturnValue(undefined);
});

describe('useDetailDataController', () => {
  it('ignores a detail response after navigation changes the route', async () => {
    let resolveOld!: (value: VodDetail | null) => void;
    let resolveNew!: (value: VodDetail | null) => void;
    vi.mocked(client.detail)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    const { result, rerender } = renderHook(
      ({ args }) => useDetailDataController(args),
      { initialProps: { args: route('source', 'old-id', 'profile-old') } },
    );
    await waitFor(() => expect(client.detail).toHaveBeenCalledTimes(1));

    rerender({ args: route('source', 'new-id', 'profile-new') });
    await waitFor(() => expect(client.detail).toHaveBeenCalledTimes(2));
    expect(result.current.detail).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveNew(detail('new detail'));
    });
    await waitFor(() => expect(result.current.detail?.name).toBe('new detail'));
    expect(result.current.profileId).toBe('profile-new');

    await act(async () => {
      resolveOld(detail('old detail'));
    });

    expect(result.current.detail?.name).toBe('new detail');
    expect(client.detail).toHaveBeenNthCalledWith(2, { key: 'source', ids: ['new-id'], profileId: 'profile-new' });
  });
});
