import { useEffect, useState } from 'react';
import { Dialog } from '@nexus/ui';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Registry-of-one for P1: reserves the shortcut and proves the mechanism.
 * `combo` is `mod+k` style: `mod` = Cmd on macOS, Ctrl elsewhere.
 */
export function useShortcut(combo: string, handler: () => void): void {
  useEffect(() => {
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1] ?? '';
    const needsMod = parts.includes('mod');
    const needsShift = parts.includes('shift');
    const needsAlt = parts.includes('alt');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key) return;
      if (needsMod !== (event.metaKey || event.ctrlKey)) return;
      if (needsShift !== event.shiftKey) return;
      if (needsAlt !== event.altKey) return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo, handler]);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useShortcut('mod+k', () => setOpen(true));

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search actions, nodes and boards."
    >
      <p className="nx-muted">No commands yet</p>
    </Dialog>
  );
}
