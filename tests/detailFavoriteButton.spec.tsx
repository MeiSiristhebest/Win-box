import { describe, expect, it, vi } from 'vitest';
import { DetailFavoriteButton } from '../src/renderer/features/detail/DetailFavoriteButton';

type ButtonElementProps = {
  'aria-pressed': boolean;
  children: unknown[] | string;
  disabled: boolean;
  onClick: () => void;
};

describe('DetailFavoriteButton', () => {
  it('reflects favorite state and delegates the action', () => {
    const onToggle = vi.fn();
    const element = DetailFavoriteButton({ favorited: false, disabled: false, onToggle });
    const props = element.props as ButtonElementProps;

    expect(element.type).toBe('button');
    expect(props['aria-pressed']).toBe(false);
    expect(props.disabled).toBe(false);
    expect(Array.isArray(props.children) ? props.children[1] : props.children).toBe('收藏');
    props.onClick();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('labels a saved item for removal and disables incomplete identities', () => {
    const onToggle = vi.fn();
    const element = DetailFavoriteButton({ favorited: true, disabled: true, onToggle });
    const props = element.props as ButtonElementProps;

    expect(props['aria-pressed']).toBe(true);
    expect(props.disabled).toBe(true);
    expect(Array.isArray(props.children) ? props.children[1] : props.children).toBe('已收藏');
    expect(onToggle).not.toHaveBeenCalled();
  });
});
