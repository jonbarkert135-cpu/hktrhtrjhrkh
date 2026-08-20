/**
 * Commands that exist regardless of what page is open (P7 §5.8: navigation + help). Registered
 * once, at import time — `palette.tsx` imports this module for its side effect.
 */

import { commandRegistry, type Command } from '../registry.ts';

const STATIC_COMMANDS: readonly Command[] = [
  {
    id: 'nav.settings',
    title: 'Go to settings',
    group: 'navigate',
    keywords: ['preferences', 'account'],
    run: (ctx) => ctx.navigate('/settings'),
  },
  {
    id: 'help.shortcuts',
    title: 'Keyboard shortcuts',
    group: 'help',
    keywords: ['help', 'keys', '?'],
    run: () => {
      window.alert(
        [
          '⌘/Ctrl+K — command palette',
          '⌘/Ctrl+P — switch board',
          '/ — focus search',
          'Esc — close',
        ].join('\n'),
      );
    },
  },
];

let registered = false;

/** Idempotent: safe to import from several entry points (tests, `main.tsx`) without duplicating. */
export function registerStaticCommands(): void {
  if (registered) return;
  registered = true;
  for (const command of STATIC_COMMANDS) commandRegistry.register(command);
}
