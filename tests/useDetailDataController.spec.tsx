// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDetailDataController } from '../src/renderer/features/detail/useDetailDataController';
import type { VodDetail } from '../src/shared/types';
import type { DetailDataPort } from '../src/renderer/features/detail/application/detailDataPorts';

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

const createPort = (): DetailDataPort => ({
  readActiveProfileId: vi.fn(async () => 'profile-default'),
  loadDetail: vi.fn(async () => null),
  readSelection: vi.fn(() => undefined),
  rememberSelection: vi.fn(),
});

describe('useDetailDataController', () => {
  it('ignores a detail response after navigation changes the route', async () => {
    let resolveOld!: (value: VodDetail | null) => void;
    let resolveNew!: (value: VodDetail | null) => void;
    const port = createPort();
    vi.mocked(port.loadDetail)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    const { result, rerender } = renderHook(
      ({ args, dataPort }) => useDetailDataController(args, dataPort),
      { initialProps: { args: route('source', 'old-id', 'profile-old'), dataPort: port } },
    );
    await waitFor(() => expect(port.loadDetail).toHaveBeenCalledTimes(1));

    rerender({ args: route('source', 'new-id', 'profile-new'), dataPort: port });
    await waitFor(() => expect(port.loadDetail).toHaveBeenCalledTimes(2));
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
    expect(port.loadDetail).toHaveBeenNthCalledWith(2, 'source', 'new-id', 'profile-new');
  });
});
