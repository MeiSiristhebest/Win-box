import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Button as FluentButton, Spinner } from '@fluentui/react-components';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  loading = false,
  disabled = false,
  className,
  children,
  ref,
  style,
  ...props
}: ButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  const appearance = variant === 'quiet' ? 'subtle' : variant === 'primary' || variant === 'danger' ? 'primary' : 'secondary';
  return (
    <FluentButton
      {...props}
      ref={ref}
      className={classes}
      appearance={appearance}
      style={{
        minHeight: 40,
        borderRadius: 'var(--radius-control)',
        ...(variant === 'danger' ? {
          backgroundColor: 'var(--color-danger)',
          borderColor: 'transparent',
          color: 'var(--on-danger)',
        } : {}),
        ...style,
      }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      icon={loading ? <Spinner size="tiny" aria-label="正在处理" /> : undefined}
    >
      {children}
    </FluentButton>
  );
}
