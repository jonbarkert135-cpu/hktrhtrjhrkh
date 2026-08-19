/**
 * Where a newly created node goes (06_NODE_SYSTEM.md §1.6).
 *
 * "Add note" always aims at the middle of the viewport, so without this every note would land on
 * top of the previous one. The search is pure and deterministic: the caller passes the boxes that
 * are already occupied and gets back the first free slot on an outward spiral, so the same board
 * plus the same aim always yields the same placement (which is what makes it testable).
 */

export interface PlacementBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PlacementOptions {
  /** Top-left the caller would use if the board were empty. */
  readonly desired: { readonly x: number; readonly y: number };
  /** Size of the node being placed. */
  readonly size: { readonly w: number; readonly h: number };
  /** Boxes already on the board, in world units. */
  readonly occupied: readonly PlacementBox[];
  /** Free space required around the new node before a slot counts as empty. */
  readonly gap?: number;
  /** Distance between candidate slots; defaults to the node size plus the gap. */
  readonly step?: { readonly x: number; readonly y: number };
  /** How many rings of the spiral to try before giving up. */
  readonly maxRings?: number;
}

const overlaps = (a: PlacementBox, b: PlacementBox, gap: number): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

const isFree = (candidate: PlacementBox, occupied: readonly PlacementBox[], gap: number): boolean =>
  !occupied.some((box) => overlaps(candidate, box, gap));

/**
 * Candidate offsets in ring order: the aim itself, then the eight slots around it, then the next
 * ring out. Ring `r` is walked left-to-right, top-to-bottom, skipping the cells of ring `r - 1`.
 */
function* ringOffsets(maxRings: number): Generator<{ dx: number; dy: number }> {
  for (let ring = 0; ring <= maxRings; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        yield { dx, dy };
      }
    }
  }
}

/**
 * Returns the top-left corner for a new node: `desired` when nothing is in the way, otherwise the
 * nearest free slot. Falls back to a diagonal cascade off `desired` when every ring is taken, so
 * the node is always created — a full board never swallows the user's click.
 */
export function findFreePlacement(options: PlacementOptions): { x: number; y: number } {
  const gap = options.gap ?? 24;
  const step = options.step ?? { x: options.size.w + gap, y: options.size.h + gap };
  const maxRings = options.maxRings ?? 12;

  for (const { dx, dy } of ringOffsets(maxRings)) {
    const candidate = {
      x: options.desired.x + dx * step.x,
      y: options.desired.y + dy * step.y,
      w: options.size.w,
      h: options.size.h,
    };
    if (isFree(candidate, options.occupied, gap)) return { x: candidate.x, y: candidate.y };
  }

  const cascade = (options.occupied.length % 12) + 1;
  return { x: options.desired.x + cascade * gap, y: options.desired.y + cascade * gap };
}
