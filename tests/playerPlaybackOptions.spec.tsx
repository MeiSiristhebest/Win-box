// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLAYER_FITS } from '../src/renderer/lib/playerPrefs';
import { PlayerFitControl, PlayerRateControl } from '../src/renderer/features/playback/PlayerPlaybackOptions';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('player playback options', () => {
  it('offers the supported playback rates and reports the selected rate', async () => {
    const onRateChange = vi.fn() as unknown as (rate: number) => void;
    const user = userEvent.setup();
    render(<PlayerRateControl rate={1} onRateChange={onRateChange} />);
    await user.click(screen.getByRole('button', { name: '播放速度：1倍' }));

    const rates = screen.getAllByRole('menuitemradio');
    expect(rates.map((option) => Number(option.textContent?.replace('x', '')))).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    await user.click(screen.getByRole('menuitemradio', { name: '1.5x' }));
    expect(onRateChange).toHaveBeenCalledWith(1.5);
  });

  it('opens from the keyboard and moves focus through the rate options', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<PlayerRateControl rate={1} onRateChange={() => undefined} />);
    const trigger = screen.getByRole('button', { name: '播放速度：1倍' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: '播放速度' });
    const options = screen.getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(options[options.length - 1]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[0]);
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
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
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
