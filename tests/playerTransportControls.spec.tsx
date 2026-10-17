// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PlayerTransportControls } from '../src/renderer/features/playback/PlayerTransportControls';

function makeProps() {
  return {
    mini: false,
    paused: true,
    canPrev: false as boolean | undefined,
    canNext: true as boolean | undefined,
    onPrev: vi.fn() as unknown as () => void,
    onNext: vi.fn() as unknown as () => void,
    onToggle: vi.fn() as unknown as () => void,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PlayerTransportControls', () => {
  it('preserves navigation availability and forwards transport actions', () => {
    const props = makeProps();
    const { container } = render(<PlayerTransportControls {...props} />);
    const buttons = Array.from(container.querySelectorAll('button'));

    expect(buttons).toHaveLength(3);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].getAttribute('aria-label')).toBe('已是第一集');
    expect(buttons[1].title).toBe('播放');
    expect(buttons[2].disabled).toBe(false);
    expect(buttons[2].getAttribute('aria-label')).toBe('下一集');

    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    expect(props.onPrev).not.toHaveBeenCalled();
    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(props.onNext).toHaveBeenCalledOnce();
  });

  it('hides navigation without episode state and uses mini-window icon sizes', () => {
    const props = { ...makeProps(), mini: true, canPrev: undefined, canNext: undefined, paused: false };
    const { container } = render(<PlayerTransportControls {...props} />);
    const buttons = Array.from(container.querySelectorAll('button'));

    expect(buttons).toHaveLength(1);
    expect(buttons[0].title).toBe('暂停');
    expect(buttons[0].querySelector('svg')?.getAttribute('width')).toBe('18');
  });
});
