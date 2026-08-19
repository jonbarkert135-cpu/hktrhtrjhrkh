/**
 * Every tuned number the engine uses, in one place, exported so bench, e2e and the debug overlay
 * assert against the same values (05_CANVAS_ENGINE.md §5.2, §6.8, §6.10, §7.4).
 */

/* ------------------------------------------------------------------ camera */

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
/** Only reachable through fit/fitAll, never through the wheel. */
export const MIN_ZOOM_FIT = 0.02;
export const ZOOM_SNAP_STOPS = [0.1, 0.25, 0.5, 1, 2, 4] as const;
export const ZOOM_SNAP_TOL = 0.015;
/** Screen px per e-fold of zoom; tuned on a trackpad (05 §5.3). */
export const ZOOM_CURVE_K = 320;
export const DOUBLE_CLICK_ZOOM = 1;
export const CAMERA_ANIM_MS = 320;
export const FIT_PADDING_PX = 64;
/** Camera cannot leave the scene bounds by more than this. */
export const CAMERA_BOUNDS_MARGIN = 2000;
export const MAX_DPR = 2;

/* --------------------------------------------------------------------- LOD */

/** Lower bound of each level; compare with the *stable* zoom, never the raw one. */
export const LOD_THRESHOLDS = {
  /** zoom < dots: flat rects / density blobs. */
  glyph: 0.18,
  /** ≥ glyphWithText: glyph + icon + one clipped title line. */
  glyphWithText: 0.4,
  /** ≥ dom: DOM cards for visible nodes. */
  dom: 0.55,
} as const;

/** Dead-band around each threshold so slow scrolling cannot thrash promotion. */
export const LOD_HYSTERESIS = 0.02;
/** Quantization step for the stable ("efficient") zoom used by LOD decisions. */
export const LOD_ZOOM_QUANTUM = 0.05;
/** Quantization is released this long after the last camera event. */
export const LOD_SETTLE_MS = 120;
/** Nodes narrower than this in screen px get no title at L2. */
export const LOD_TITLE_MIN_SCREEN_W = 60;
/** Hard cap on canvas-painted text length, independent of host truncation. */
export const MAX_CANVAS_TEXT = 256;
export const TEXT_CACHE_LIMIT = 2000;

/* ---------------------------------------------------------- culling / DOM */

export const CULL_MARGIN_MIN = 256;
export const CULL_MARGIN_RATIO = 0.25;
export const CULL_MARGIN_MAX = 2048;
export const MAX_DOM_NODES = 260;

/* --------------------------------------------------------------- geometry */

export const MIN_NODE_SIZE = 24;
/** Camera clamps to scene bounds inflated by CAMERA_BOUNDS_MARGIN; coordinates beyond this are clamped. */
export const MAX_WORLD_COORD = 1e7;
/** Uniform cell size of the spatial index, in world px (05 §6.3). */
export const INDEX_CELL_SIZE = 512;

/* ------------------------------------------------------------ interaction */

export const DRAG_THRESHOLD_PX = 4;
export const CLICK_MAX_MS = 500;
export const DBLCLICK_MAX_MS = 320;
export const LONG_PRESS_MS = 480;
export const HOVER_LEAVE_MS = 80;
export const EDGE_HIT_TOL_PX = 10;
/** Half-width of the connection band around a card border (P5 §5.3). */
export const PORT_BAND_PX = 10;
/**
 * Below this zoom the port band is off: cards are glyphs or dots there, the band would cover the
 * whole card, and dragging the card must keep winning (P5 §5.3 read together with 05 §6.8).
 */
export const PORT_MIN_ZOOM = 0.4;
/** Candidate targets offered to a keyboard-driven connection, nearest first (P5 §6). */
export const CONNECT_CANDIDATE_LIMIT = 12;
export const HANDLE_HIT_PAD_PX = 6;
export const ANCHOR_MAGNET_PX = 28;
export const SNAP_TOL_PX = 6;
export const GRID_SNAP = 8;
/** Alignment guides consider at most this many nearby nodes. */
export const SNAP_CANDIDATE_LIMIT = 400;
export const AUTOPAN_EDGE_PX = 48;
export const AUTOPAN_MAX_SPEED = 18;
export const MULTI_DRAG_GHOST_LIMIT = 120;

/* ------------------------------------------------------------------- grid */

export const GRID_SPACING = 24;
/** Below this zoom the background grid is not drawn at all. */
export const GRID_MIN_ZOOM = 0.35;

/* ---------------------------------------------------------------- minimap */

export const MINIMAP_MAX_FPS = 10;
