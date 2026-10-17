// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { client } from '../src/renderer/api/client';
import type { DlnaDevice } from '../src/shared/dlna';
import { DlnaCastControl } from '../src/renderer/features/playback/DlnaCastControl';

const device: DlnaDevice = {
  udn: 'uuid:bedroom-tv',
  name: 'Bedroom TV',
  controlUrl: 'http://tv.example.test/control',
  location: 'http://tv.example.test/device.xml',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DlnaCastControl', () => {
  it('discovers a device and sends the current playback position', async () => {
    const discover = vi.spyOn(client, 'dlnaDiscover').mockResolvedValue([device]);
    const cast = vi.spyOn(client, 'dlnaCast').mockResolvedValue({ ok: true, device: 'Bedroom TV' });
    render(<DlnaCastControl url="https://example.test/movie.mp4" resourceName="Movie" getCurrentTime={() => 12.345} />);

    fireEvent.click(screen.getByRole('button', { name: '投屏（DLNA）' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bedroom TV' }));

    await waitFor(() => expect(cast).toHaveBeenCalledOnce());
    expect(discover).toHaveBeenCalledOnce();
    expect(cast).toHaveBeenCalledWith({
      device,
      target: { url: 'https://example.test/movie.mp4', name: 'Movie', positionMs: 12345 },
    });
    expect(await screen.findByText('已投到「Bedroom TV」')).toBeTruthy();
  });

  it('reports when no device is found', async () => {
    vi.spyOn(client, 'dlnaDiscover').mockResolvedValue([]);
    render(<DlnaCastControl url="https://example.test/movie.mp4" getCurrentTime={() => 0} />);

    fireEvent.click(screen.getByRole('button', { name: '投屏（DLNA）' }));

    expect(await screen.findByText('没有发现可投屏设备（电视需支持 DLNA/UPnP，且与本机在同一局域网）')).toBeTruthy();
  });
});
