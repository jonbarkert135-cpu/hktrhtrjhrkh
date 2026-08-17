import type { ReactNode } from 'react';

export type BannerKind = 'info' | 'success' | 'warn' | 'danger';

export interface BannerProps {
  kind: BannerKind;
  /** What happened. */
  title: string;
  /** Why it happened and what to do next — never a bare error code. */
  children?: ReactNode;
  /** Right-aligned actions (ghost/link buttons). */
  actions?: ReactNode;
}

// Status is never colour alone (WCAG 1.4.1): each kind carries a distinct glyph + label.
const GLYPH: Record<BannerKind, { path: string; label: string }> = {
  info: { path: 'M8 7v5M8 4.5h.01M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Z', label: 'Information' },
  success: { path: 'M4.5 8.5 7 11l4.5-5M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Z', label: 'Success' },
  warn: {
    path: 'M8 6.5v3.5M8 12.5h.01M7 2.2 1.4 12.4a1.2 1.2 0 0 0 1 1.8h11.2a1.2 1.2 0 0 0 1-1.8L9 2.2a1.2 1.2 0 0 0-2 0Z',
    label: 'Warning',
  },
  danger: {
    path: 'M6 6l4 4M10 6l-4 4M5.6 1.5h4.8L14.5 5.6v4.8l-4.1 4.1H5.6L1.5 10.4V5.6L5.6 1.5Z',
    label: 'Error',
  },
};

/** Form- or panel-level message: cause on top, next step in the body. */
export function Banner({ kind, title, children, actions }: BannerProps) {
  const glyph = GLYPH[kind];
  return (
    <div className="nx-banner" data-kind={kind} role={kind === 'danger' ? 'alert' : 'status'}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: 'var(--nx-icon-1)', height: 'var(--nx-icon-1)', flex: 'none' }}
        role="img"
        aria-label={glyph.label}
      >
        <path d={glyph.path} />
      </svg>
      <div className="nx-banner-body">
        <span className="nx-banner-title">{title}</span>
        {children ? <span className="nx-banner-text">{children}</span> : null}
      </div>
      {actions}
    </div>
  );
}
