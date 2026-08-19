/**
 * Quick add (P6 §5.11): `N` drops a note at the cursor, `L` opens a one-field capture input, and
 * the "+" button opens the same two actions for pointer users. The input is also the fallback when
 * the browser refuses clipboard access (§6): anything pasted into it is detected the same way a
 * `paste` event would be, so the analyst is never stuck.
 */

import { detectTransfer } from '@nexus/domain';
import { Button, Dialog, Field, Menu, MenuItem } from '@nexus/ui';
import { useCallback, useEffect, useState } from 'react';

export interface QuickAddProps {
  onNote: () => void;
  /** Receives a raw text payload — a URL, several URLs, or prose. */
  onCapture: (text: string) => void;
}

/** The sentence under the field: what this payload will become before the user commits. */
export function describePayload(text: string): string {
  const detection = detectTransfer({ text: text.trim() });
  switch (detection.kind) {
    case 'urls':
      return detection.urls.length === 1
        ? 'Adds one website node.'
        : `Adds ${String(detection.urls.length)} website nodes.`;
    case 'text':
      return detection.text.length <= 280 ? 'Adds one text node.' : 'Adds one note.';
    default:
      return 'Paste a link, several links, or any text.';
  }
}

export function QuickAdd({ onNote, onCapture }: QuickAddProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const submit = useCallback(() => {
    if (value.trim() === '') return;
    onCapture(value);
    setValue('');
    setOpen(false);
  }, [value, onCapture]);

  // `N` and `L` are single-key shortcuts, so they must never fire while the analyst is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const node = event.target;
      if (
        node instanceof HTMLElement &&
        (node.isContentEditable || /^(INPUT|TEXTAREA)$/.test(node.tagName))
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        onNote();
      } else if (key === 'l') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNote]);

  return (
    <>
      <Menu
        trigger={
          <Button variant="secondary" aria-label="Add to board" data-testid="quick-add">
            +
          </Button>
        }
      >
        <MenuItem onSelect={onNote}>Note (N)</MenuItem>
        <MenuItem onSelect={() => setOpen(true)}>Link or text (L)</MenuItem>
      </Menu>

      {/* Mounted only while open: the board is the hot path and Radix' dialog is not free. */}
      {open ? (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Add to board"
          description="Paste a link or any text. The right node type is chosen for you."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={value.trim() === ''}
                onClick={submit}
                data-testid="quick-add-confirm"
              >
                Add
              </Button>
            </>
          }
        >
          <Field
            label="Link or text"
            data-testid="quick-add-input"
            value={value}
            description={describePayload(value)}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}
