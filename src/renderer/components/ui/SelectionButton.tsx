import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ToggleButton as FluentToggleButton } from '@fluentui/react-components';

export interface SelectionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-pressed'> {
  selected: boolean;
  children: ReactNode;
}

/** A compact single-choice control; visual state and aria-pressed expose selection without a duplicate glyph. */
export function SelectionButton({ selected, children, style, ...props }: SelectionButtonProps) {
  return (
    <FluentToggleButton
      {...props}
      checked={selected}
      appearance="outline"
      style={{
        minHeight: 40,
        borderRadius: 'var(--radius-control)',
        backgroundColor: selected ? 'var(--accent-soft)' : 'var(--surface-raised)',
        borderColor: selected ? 'var(--color-accent)' : 'var(--border-subtle)',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: selected ? 700 : 500,
        ...style,
      }}
    >
      {children}
    </FluentToggleButton>
  );
}
