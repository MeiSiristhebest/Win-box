// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerKernelControl } from '../src/renderer/features/playback/PlayerKernelControl';

vi.mock('../src/renderer/lib/usePlayerPanelPosition', () => ({ usePlayerPanelPosition: () => ({ current: null }) }));
afterEach(cleanup);

describe('kernel preference menu', () => {
  it('can restore auto even when HTML5 is the only available engine', () => {
    const onSelect = vi.fn();
    render(<PlayerKernelControl kernel="html5" preference="html5" choices={[{ id: 'html5', label: '内置（HTML5）' }]} containerRef={{ current: null }} onSelect={onSelect} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTitle('当前内核：内置（HTML5）'));
    fireEvent.click(screen.getByRole('button', { name: '自动选择' }));
    expect(onSelect).toHaveBeenCalledWith('auto');
  });

  it('distinguishes the automatic preference from its effective MPV engine', () => {
    render(<PlayerKernelControl kernel="mpv" preference="auto" choices={[{ id: 'html5', label: '内置' }, { id: 'mpv', label: 'MPV' }]} containerRef={{ current: null }} onSelect={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTitle('自动选择；当前内核：MPV'));
    expect(screen.getByRole('button', { name: '自动选择' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'MPV' }).getAttribute('aria-pressed')).toBe('false');
  });
});
