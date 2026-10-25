import type { InputHTMLAttributes, ReactNode } from 'react';
import { Field as FluentField, Input as FluentInput, Select as FluentSelect } from '@fluentui/react-components';
import styles from './Field.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'children' | 'size' | 'value' | 'defaultValue' | 'type'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  type?: 'date' | 'datetime-local' | 'email' | 'month' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'time' | 'url' | 'week';
}

export function Field({ label, hint, error, id, className, ...inputProps }: FieldProps) {
  return (
    <FluentField
      className={styles.field}
      label={label}
      hint={hint ? { children: <>{hint}</> } : undefined}
      validationMessage={error}
      validationState={error ? 'error' : 'none'}
    >
      <FluentInput
        {...inputProps}
        id={id}
        className={[styles.input, className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : inputProps['aria-invalid']}
      />
    </FluentField>
  );
}

export interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export function SelectField({ label, value, options, onChange, id, className, disabled, 'aria-label': ariaLabel }: SelectFieldProps) {
  return (
    <FluentField className={styles.field} label={label}>
      <FluentSelect
        id={id}
        className={[styles.input, className].filter(Boolean).join(' ')}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(_event, data) => onChange(data.value)}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </FluentSelect>
    </FluentField>
  );
}
