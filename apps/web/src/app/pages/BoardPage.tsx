/**
 * The board page (P3): the document provider mounts first, the canvas binds to the document, and
 * the top bar carries the save indicator, undo/redo, version history and export/import.
 *
 * Everything on this page works with the network permanently off (P3 §14).
 */

import { useParams } from 'react-router-dom';

import { BoardDocProvider } from '../../data/docProvider.tsx';
import { BoardWorkspace } from '../board/BoardWorkspace.tsx';

export default function BoardPage() {
  const { boardId } = useParams();
  // The root route opens a scratch board; a real id arrives from /b/:boardId.
  const id = boardId ?? 'scratch';
  return (
    <BoardDocProvider key={id} boardId={id}>
      <BoardWorkspace />
    </BoardDocProvider>
  );
}
