// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerKernelControl } from '../src/renderer/features/playback/PlayerKernelControl';

vi.mock('../src/renderer/lib/usePlayerPanelPosition', () => ({ usePlayerPanelPosition: () => ({ current: null }) }));
afterEach(cleanup);

describe('kernel preference menu', () => {
  it('can restore auto even when HTML5 is the only available engine', () => {
    const onSelect = vi.fn();
    render(<PlayerKernelControl kernel="html5" preference="html5" choices={[{ id: 'html5', label: '标准播放' }]} containerRef={{ current: null }} onSelect={onSelect} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTitle('当前播放方式：标准播放'));
    fireEvent.click(screen.getByRole('button', { name: '自动选择（推荐）' }));
    expect(onSelect).toHaveBeenCalledWith('auto');
  });

  it('distinguishes the automatic preference from its effective MPV engine', () => {
    render(<PlayerKernelControl kernel="mpv" preference="auto" choices={[{ id: 'html5', label: '标准播放' }, { id: 'mpv', label: '兼容播放' }]} containerRef={{ current: null }} onSelect={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTitle('自动选择；当前：兼容播放'));
    expect(screen.getByRole('button', { name: '自动选择（推荐）' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '兼容播放' }).getAttribute('aria-pressed')).toBe('false');
  });
});
