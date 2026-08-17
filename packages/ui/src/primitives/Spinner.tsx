import type { CSSProperties } from 'react';

export interface SpinnerProps {
  /** Icon-grid size token: 1 = 16px, 2 = 20px, 3 = 24px. */
  size?: 1 | 2 | 3;
  /** Accessible label; omit inside an element that already has `aria-busy`. */
  label?: string;
  className?: string;
}

/**
 * Indeterminate activity indicator. Rotation stops under `prefers-reduced-motion`
 * (see `primitives.css`), where the arc reads as a static glyph.
 */
export function Spinner({ size = 1, label, className }: SpinnerProps) {
  const style: CSSProperties = {
    width: `var(--nx-icon-${size})`,
    height: `var(--nx-icon-${size})`,
  };
  return (
    <svg
      className={className ? `nx-spinner ${className}` : 'nx-spinner'}
      style={style}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="9.4 28.3"
      />
    </svg>
  );
}
