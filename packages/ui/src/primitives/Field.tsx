import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Bare text input. Use `Field` unless the label lives elsewhere (e.g. a toolbar search). */
export function Input({ className, ...rest }: InputProps) {
  return <input {...rest} className={className ? `nx-input ${className}` : 'nx-input'} />;
}

export interface FieldProps extends Omit<InputProps, 'id' | 'aria-describedby' | 'aria-invalid'> {
  label: string;
  /** Static helper text. Always announced, error or not. */
  description?: string;
  /** Inline validation message: what is wrong and what to do about it. */
  error?: string;
  children?: never;
}

/**
 * Label + input + description + inline error, wired with `aria-describedby`,
 * `aria-invalid` and a live region so the error is announced when it appears.
 */
export function Field({ label, description, error, className, ...inputProps }: FieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="nx-field">
      <label className="nx-field-label" htmlFor={id}>
        {label}
      </label>
      <Input
        {...inputProps}
        id={id}
        className={className}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {description ? (
        <span className="nx-field-description" id={descriptionId}>
          {description}
        </span>
      ) : null}
      <span className="nx-field-error" id={errorId} role="alert">
        {error ?? ''}
      </span>
    </div>
  );
}
