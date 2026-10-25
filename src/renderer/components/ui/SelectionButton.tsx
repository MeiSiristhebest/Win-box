import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ToggleButton as FluentToggleButton } from '@fluentui/react-components';
import { Checkmark16Regular } from '@fluentui/react-icons';

export interface SelectionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-pressed'> {
  selected: boolean;
  children: ReactNode;
}

/** A compact single-choice control with a persistent check mark and Fluent keyboard/focus behavior. */
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
      {selected && <Checkmark16Regular aria-hidden="true" />}
    </FluentToggleButton>
  );
}
