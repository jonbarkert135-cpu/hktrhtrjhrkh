import type { CSSProperties } from 'react';

export interface SkeletonProps {
  /** Any CSS length, normally a token: `var(--nx-space-9)`. */
  width?: string;
  height?: string;
  /** Radius token value; defaults to the shared skeleton radius. */
  radius?: string;
  className?: string;
}

/**
 * Placeholder box that must match the real content's box exactly.
 * The shimmer is dropped under `prefers-reduced-motion` (see `primitives.css`).
 */
export function Skeleton({ width = '100%', height, radius, className }: SkeletonProps) {
  const style: CSSProperties = { width };
  if (height !== undefined) style.height = height;
  if (radius !== undefined) style.borderRadius = radius;
  return (
    <span
      className={className ? `nx-skeleton ${className}` : 'nx-skeleton'}
      style={style}
      data-testid="skeleton"
      aria-hidden="true"
    />
  );
}
