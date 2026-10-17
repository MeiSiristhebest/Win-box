// @vitest-environment happy-dom
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PlayerVolumeControl } from '../src/renderer/features/playback/PlayerVolumeControl';

function makeProps() {
  return {
    volume: 0.25,
    open: false,
    hidden: true,
    inputRef: createRef<HTMLInputElement>(),
    onFocusChange: vi.fn() as unknown as (focused: boolean) => void,
    onPointerEnter: vi.fn() as unknown as () => void,
    onPointerLeave: vi.fn() as unknown as () => void,
    onChange: vi.fn() as unknown as (volume: number) => void,
    onPointerStart: vi.fn() as unknown as () => void,
    onPointerEnd: vi.fn() as unknown as () => void,
    onToggleMute: vi.fn() as unknown as () => void,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PlayerVolumeControl', () => {
  it('keeps slider state, focus, pointer, and mute actions on the supplied callbacks', () => {
    const props = makeProps();
    const { container, rerender } = render(<PlayerVolumeControl {...props} />);
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

    expect(slider.value).toBe('25');
    expect(slider.getAttribute('aria-orientation')).toBe('vertical');
    expect(slider.tabIndex).toBe(-1);
    expect(container.querySelector('.vp-vpanel')?.getAttribute('style')).toContain('visibility: hidden');
    expect(container.querySelector('.vp-vpct')?.textContent).toBe('25%');

    fireEvent.change(slider, { target: { value: '75' } });
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.focus(slider);
    fireEvent.blur(slider, { relatedTarget: document.body });
    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(props.onChange).toHaveBeenCalledWith(0.75);
    expect(props.onPointerStart).toHaveBeenCalledOnce();
    expect(props.onPointerEnd).toHaveBeenCalledOnce();
    expect(props.onFocusChange).toHaveBeenNthCalledWith(1, true);
    expect(props.onFocusChange).toHaveBeenLastCalledWith(false);
    expect(props.onToggleMute).toHaveBeenCalledOnce();

    rerender(<PlayerVolumeControl {...props} open hidden={false} />);
    expect(slider.tabIndex).toBe(0);
    expect(container.querySelector('.vp-vpanel')?.getAttribute('style')).toBeNull();
  });

  it('reports pointer hover and labels the unmute action when volume is zero', () => {
    const props = { ...makeProps(), volume: 0 };
    const { container } = render(<PlayerVolumeControl {...props} />);
    const control = container.querySelector('.vp-vol') as HTMLDivElement;
    fireEvent.pointerOver(control);
    fireEvent.pointerOut(control, { relatedTarget: null });

    expect(props.onPointerEnter).toHaveBeenCalledOnce();
    expect(props.onPointerLeave).toHaveBeenCalledOnce();
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('取消静音');
  });
});
