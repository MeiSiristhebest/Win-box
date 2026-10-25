// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('renders discovered devices and delegates casting to the presenter', async () => {
    const cast = vi.fn(async () => undefined);
    const toggle = vi.fn();
    const refresh = vi.fn();
    render(<DlnaCastControl open busy={false} devices={[device]} message="" onToggle={toggle} onRefresh={refresh} onCast={cast} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Bedroom TV' }));

    expect(cast).toHaveBeenCalledWith(device);
    fireEvent.click(screen.getByRole('button', { name: '投屏（DLNA）' }));
    expect(toggle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新搜索' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('shows the discovery message supplied by the presenter', () => {
    render(<DlnaCastControl open busy={false} devices={[]} message="没有发现可投屏设备" onToggle={() => undefined} onRefresh={() => undefined} onCast={() => undefined} />);
    expect(screen.getByText('没有发现可投屏设备')).toBeTruthy();
  });
});
