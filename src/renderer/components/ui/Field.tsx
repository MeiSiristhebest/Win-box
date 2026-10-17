import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
}

export function Field({ label, hint, error, id, className, ...inputProps }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [inputProps['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      {hint && <span className={styles.hint} id={hintId}>{hint}</span>}
      <input
        {...inputProps}
        id={inputId}
        className={[styles.input, className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : inputProps['aria-invalid']}
        aria-describedby={describedBy}
      />
      {error && <span className={styles.error} id={errorId}>{error}</span>}
    </div>
  );
}
