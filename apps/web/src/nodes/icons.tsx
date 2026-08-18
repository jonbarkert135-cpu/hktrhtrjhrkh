/**
 * The icon subset the node registry names (04_DESIGN_SYSTEM.md §7, lucide geometry). Inline paths
 * rather than a runtime icon package: nine glyphs do not justify a dependency, and the canvas needs
 * the same ids as the DOM.
 */

const PATHS: Record<string, string> = {
  globe:
    'M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM1.5 8h13M8 1.5c1.8 2 2.7 4.1 2.7 6.5S9.8 12.5 8 14.5c-1.8-2-2.7-4.1-2.7-6.5S6.2 3.5 8 1.5z',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1',
  type: 'M3 3.5h10M8 3.5v9M6 12.5h4',
  'sticky-note': 'M3 2.5h10v7l-3.5 3.5H3zM13 9.5H9.5V13',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M6 6.2a.8.8 0 11-1.6 0 .8.8 0 011.6 0z',
  file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  user: 'M8 8a2.75 2.75 0 100-5.5A2.75 2.75 0 008 8zM2.75 14c0-2.6 2.35-4.25 5.25-4.25S13.25 11.4 13.25 14',
  'git-branch':
    'M5 2.5v11M5 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM5 14.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM11 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM11 6.5v1c0 2-2 2.5-4 2.5',
  'help-circle':
    'M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM6.4 6.2A1.7 1.7 0 019.6 7c0 1.1-1.6 1.4-1.6 2.4M8 11.6h.01',
};

export interface NodeIconProps {
  icon: string;
  label?: string;
  className?: string;
}

/** Decorative by default: the card title already names the node, so the icon is `aria-hidden`. */
export function NodeIcon({ icon, label, className }: NodeIconProps) {
  const path = PATHS[icon] ?? PATHS['help-circle'];
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'nx-node-icon'}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <path d={path} />
    </svg>
  );
}

export function hasIcon(icon: string): boolean {
  return icon in PATHS;
}
