import type { ReactNode } from 'react';

/** Content for assistive technology only; still focusable if it contains a control. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="nx-visually-hidden">{children}</span>;
}

export interface SkipToContentProps {
  /** Id of the target landmark, without `#`. */
  targetId: string;
  children?: ReactNode;
}

/**
 * First focusable element in the document (03_UX §19.1). Hidden until focused,
 * then it slides into the top-left corner.
 */
export function SkipToContent({ targetId, children = 'Skip to content' }: SkipToContentProps) {
  return (
    <a className="nx-skip-link" href={`#${targetId}`}>
      {children}
    </a>
  );
}
