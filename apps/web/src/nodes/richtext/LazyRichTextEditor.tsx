/**
 * The editor is the heaviest thing on the board (ProseMirror + the extension set), and most board
 * sessions never open it: reading a board, moving cards and following edges need none of it. It is
 * therefore split out and fetched on the first edit, which keeps the board route's first paint
 * inside the P1 §7 budget.
 */

import { lazy, Suspense } from 'react';

import type { RichTextEditorProps } from './RichTextEditor.tsx';

const Editor = lazy(async () => ({
  default: (await import('./RichTextEditor.tsx')).RichTextEditor,
}));

export function LazyRichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="nx-richtext" data-testid={`richtext-loading-${props.node.id}`}>
          <p className="nx-card-meta">Loading the editor…</p>
        </div>
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
