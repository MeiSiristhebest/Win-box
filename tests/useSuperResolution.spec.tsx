// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SrState } from '../src/shared/plugin';
import type { SuperResolutionPort } from '../src/renderer/features/playback/application/superResolutionPort';
import { useSuperResolution } from '../src/renderer/features/playback/useSuperResolution';

const capability: SrState = { available: true, modes: [{ id: 'quality', label: 'Quality' }], mode: 'off' };

function createPort(): SuperResolutionPort {
  return {
    readCapability: vi.fn(async () => capability),
    saveMode: vi.fn(async () => undefined),
    applyMode: vi.fn(async () => ({ ok: true })),
  };
}

function Harness({ active, port }: { active: boolean; port: SuperResolutionPort }) {
  const resolution = useSuperResolution(active, port);
  return (
    <div>
      <output data-testid='open'>{String(resolution.open)}</output>
      <output data-testid='mode'>{resolution.mode}</output>
      <div data-testid='feedback'>{resolution.feedback?.message ?? ''}</div>
      <button onClick={() => resolution.setOpen(true)}>Open</button>
      <button onClick={() => void resolution.apply('quality')}>Apply</button>
    </div>
  );
}

afterEach(cleanup);

describe('useSuperResolution', () => {
  it('loads capability only while the mpv session is active and closes its panel across session changes', async () => {
    const port = createPort();
    const view = render(<Harness active port={port} />);
    await waitFor(() => expect(port.readCapability).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('open').textContent).toBe('true');

    view.rerender(<Harness active={false} port={port} />);
    expect(screen.getByTestId('open').textContent).toBe('false');
    view.rerender(<Harness active port={port} />);
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(port.readCapability).toHaveBeenCalledTimes(2);
  });

  it('saves the selected mode before sending it to the active mpv session', async () => {
    const port = createPort();
    render(<Harness active port={port} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByTestId('feedback').textContent).toContain('切换指令'));
    expect(port.saveMode).toHaveBeenCalledWith('quality');
    expect(port.applyMode).toHaveBeenCalledWith('quality');
    expect(screen.getByTestId('mode').textContent).toBe('quality');
  });

  it('does not send a mode after persistence fails', async () => {
    const port = createPort();
    vi.mocked(port.saveMode).mockRejectedValue(new Error('disk full'));
    render(<Harness active port={port} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByTestId('feedback').textContent).toContain('disk full'));
    expect(port.applyMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('mode').textContent).toBe('off');
  });
});
