/**
 * A comment pin at a node's corner (P8 §6: "20 px circles"). Shows the unresolved-reply count as
 * a badge; the board card itself carries the same count (§6) via `unresolvedCount`.
 */

import { cssVar } from '@nexus/ui';

const PIN_DIAMETER = 20;

export interface CommentPinProps {
  unresolvedCount: number;
  resolved: boolean;
  onOpen: () => void;
}

export function CommentPin({ unresolvedCount, resolved, onOpen }: CommentPinProps) {
  return (
    <button
      type="button"
      data-testid="comment-pin"
      aria-label={
        resolved ? 'Resolved comment thread' : `${String(unresolvedCount)} unresolved comments`
      }
      onClick={onOpen}
      style={{
        width: PIN_DIAMETER,
        height: PIN_DIAMETER,
        borderRadius: '50%',
        background: resolved ? cssVar('color.neutral.400') : cssVar('color.accent.500'),
        color: cssVar('color.neutral.000'),
      }}
    >
      {resolved ? null : unresolvedCount}
    </button>
  );
}
