// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PLAYER_FITS } from '../src/renderer/lib/playerPrefs';
import { PlayerFitControl, PlayerRateControl } from '../src/renderer/features/playback/PlayerPlaybackOptions';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('player playback options', () => {
  it('offers the supported playback rates and reports the selected rate', () => {
    const onRateChange = vi.fn() as unknown as (rate: number) => void;
    const { container } = render(<PlayerRateControl rate={1} onRateChange={onRateChange} />);
    const select = container.querySelector('select') as HTMLSelectElement;

    expect(Array.from(select.options).map((option) => Number(option.value))).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    fireEvent.change(select, { target: { value: '1.5' } });
    expect(onRateChange).toHaveBeenCalledWith(1.5);
  });

  it('opens the fit panel, reports a fit choice, and tracks hover visibility', () => {
    const props = {
      fit: PLAYER_FITS[0].value,
      open: false,
      onFitSelect: vi.fn() as unknown as (fit: typeof PLAYER_FITS[number]['value']) => void,
      onFitOpen: vi.fn() as unknown as () => void,
      onFitPointerEnter: vi.fn() as unknown as () => void,
      onFitPointerLeave: vi.fn() as unknown as () => void,
    };
    const { container } = render(<PlayerFitControl {...props} />);
    const host = container.querySelector('.vp-vol') as HTMLDivElement;
    const buttons = Array.from(container.querySelectorAll('.vsp-btn'));

    expect(buttons).toHaveLength(PLAYER_FITS.length);
    expect(buttons[0].classList.contains('active')).toBe(true);
    fireEvent.click(container.querySelector('.vp-ctl') as HTMLButtonElement);
    fireEvent.click(buttons[1]);
    fireEvent.pointerOver(host);
    (container.querySelector('.vp-ctl') as HTMLButtonElement).blur();
    fireEvent.pointerLeave(host, { relatedTarget: null });

    expect(props.onFitOpen).toHaveBeenCalledOnce();
    expect(props.onFitSelect).toHaveBeenCalledWith(PLAYER_FITS[1].value);
    expect(props.onFitPointerEnter).toHaveBeenCalledOnce();
    expect(props.onFitPointerLeave).toHaveBeenCalled();
  });
});
