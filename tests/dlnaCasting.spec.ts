import { describe, expect, it, vi } from 'vitest';
import type { DlnaDevice } from '../src/shared/dlna';
import { LOCAL_PROXY_BASE } from '../src/shared/constants';
import { castCurrentMedia, discoverDlnaDevices, type DlnaCastingPort } from '../src/renderer/features/playback/application/dlnaCasting';

const device: DlnaDevice = {
  udn: 'uuid:living-room',
  name: 'Living room TV',
  controlUrl: 'http://tv.local/avtransport',
  location: 'http://tv.local/description.xml',
};

function createPort(): DlnaCastingPort {
  return {
    discoverDevices: vi.fn(async () => [device]),
    castToDevice: vi.fn(async () => ({ ok: true, device: device.name })),
  };
}

describe('DLNA casting use cases', () => {
  it('discovers devices through its capability port', async () => {
    const port = createPort();

    await expect(discoverDlnaDevices(port)).resolves.toEqual([device]);
    expect(port.discoverDevices).toHaveBeenCalledOnce();
  });

  it('builds a cast target from the selected device, title, and playback position', async () => {
    const port = createPort();

    const outcome = await castCurrentMedia(port, {
      device,
      url: 'https://media.example/episode.m3u8',
      title: 'Episode 1',
      positionSeconds: 12.3456,
    });

    expect(port.castToDevice).toHaveBeenCalledWith(device, {
      url: 'https://media.example/episode.m3u8',
      name: 'Episode 1',
      positionMs: 12346,
    });
    expect(outcome).toEqual({
      target: { url: 'https://media.example/episode.m3u8', name: 'Episode 1', positionMs: 12346 },
      result: { ok: true, device: device.name },
    });
  });

  it('preserves the local-relay warning metadata for the presentation layer', async () => {
    const port = createPort();

    const outcome = await castCurrentMedia(port, {
      device,
      url: LOCAL_PROXY_BASE + '/bt/item',
      positionSeconds: 0,
    });

    expect(outcome.target.localRelay).toBe(true);
    expect(port.castToDevice).toHaveBeenCalledWith(device, expect.objectContaining({ localRelay: true }));
  });
});
