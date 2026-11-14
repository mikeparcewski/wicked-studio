/**
 * cytoBase — the cytoscape helpers RingGraph shares with CytoGraph, plus the PURE geometry the ring
 * canvas needs (no React, no cytoscape import): the concentric transform, and the label
 * placement/collision/LOD pass. Keeping the geometry pure lets the hard parts be unit-tested as
 * plain functions, away from a headless renderer.
 */

import type { ItemKind } from '../../graph/ringModel.js';

// ───────────────────────────── theme observer ─────────────────────────────

/**
 * Watch <html> for a theme change (data-theme, an inline style that re-points a token, or a class)
 * and call `onChange`. Both graph canvases re-run cy.style() with freshly resolved tokens on this —
 * never the layout. Returns a disconnect fn; a no-op where MutationObserver is absent (jsdom without
 * the shim). `attributeOldValue` is off: consumers re-resolve unconditionally.
 */
export function observeTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const obs = new MutationObserver(() => onChange());
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
  return () => obs.disconnect();
}

// ───────────────────────────── ring layout transform ─────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/**
 * The concentric transform. cytoscape's built-in concentric distributes ring k's items evenly by
 * angle (dθ = 2π/n_k from a 12-o'clock start); this takes each item's resulting ANGLE, shifts it by
 * π/n_k so nothing lands at 12 o'clock, and overrides the radius to the model's r_k. The focus
 * (level 0) sits at the origin. Because (2j+1)·π/n_k is never a multiple of 2π, no item ever falls
 * on 12 o'clock after the shift.
 */
export function ringPosition(position: Point, level: number, radii: number[], countPerLevel: number[]): Point {
  if (level <= 0) return { x: 0, y: 0 };
  const nk = Math.max(1, countPerLevel[level] ?? 1);
  const rk = radii[level] ?? 0;
  const theta = Math.atan2(position.y, position.x) + Math.PI / nk;
  return { x: rk * Math.cos(theta), y: rk * Math.sin(theta) };
}

// ───────────────────────────── label geometry ─────────────────────────────

export type FontKind = 'sans' | 'mono';

/** Measure a string's ON-SCREEN width in px at the caption size, in the given face. */
export type Measure = (text: string, font: FontKind) => number;

/** The longest a radial label runs before it is cut with an ellipsis. */
export const LABEL_MAX_CHARS = 24;

/** The LOD gate for ring-k≥2 symbol labels: a candidate only while RING_STEP·zoom ≥ this. */
export const LOD_MIN_RING_PX = 64;

export interface LabelInput {
  id: string;
  kind: ItemKind | 'guide';
  /** 0 = focus; ≥1 = the ring the item (or guide) sits on. */
  level: number;
  /** the raw label text. */
  text: string;
  /** model-px distance of the node centre (or the guide ring) from the origin, i.e. r_k. */
  rRing: number;
  /** model-px node radius (size ÷ 2); 0 for a guide. */
  rNode: number;
  /** the node's model-space angle (radians); ignored for the focus and guides. */
  angle: number;
  /** cy :selected. */
  selected: boolean;
  /** hovered OR on the selected chain. */
  hovered: boolean;
}

export interface LabelGeom {
  id: string;
  /** the (possibly truncated) text actually drawn. */
  text: string;
  font: FontKind;
  /** cytoscape font-size in MODEL px: captionPx ÷ zoom keeps the on-screen size constant. */
  fontSizeModelPx: number;
  /** cytoscape text-margin-x / -y in MODEL px. */
  marginXModelPx: number;
  marginYModelPx: number;
  /** text rotation in radians. */
  rotation: number;
  /** the oriented rectangle used for collision, in SCREEN px (pan-independent: model × zoom). */
  rect: OrientedRect;
  isGuide: boolean;
  isFocus: boolean;
}

export interface OrientedRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** rotation in radians. */
  rot: number;
}

function truncate(text: string): string {
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text;
}

/**
 * Everything about one label: the text drawn, the face, the cytoscape font size and margins in model
 * px, and the oriented rectangle (screen px) the collision pass tests. All label geometry is in
 * screen px; the margins are converted back to model px for cytoscape.
 */
export function labelGeom(input: LabelInput, zoom: number, captionPx: number, measure: Measure): LabelGeom {
  const h = captionPx; // on-screen text height
  const fontSizeModelPx = captionPx / zoom;
  const isFocus = input.level === 0 && input.kind !== 'guide';
  const isGuide = input.kind === 'guide';

  if (isFocus) {
    const text = truncate(input.text);
    const w = measure(text, 'sans');
    const marginYModelPx = input.rNode + (6 + h / 2) / zoom; // below the focus, horizontal
    const cy = marginYModelPx * zoom; // node at origin; screen offset downward
    return {
      id: input.id, text, font: 'sans', fontSizeModelPx,
      marginXModelPx: 0, marginYModelPx, rotation: 0,
      rect: { cx: 0, cy, w, h, rot: 0 }, isGuide: false, isFocus: true,
    };
  }

  if (isGuide) {
    const text = input.text.toLowerCase(); // guide labels are lower-case (the type-scale lint forbids capitals)
    const w = measure(text, 'mono');
    const marginYModelPx = -(input.rRing + (6 + h / 2) / zoom); // at 12 o'clock, above the ring
    const cy = marginYModelPx * zoom;
    return {
      id: input.id, text, font: 'mono', fontSizeModelPx,
      marginXModelPx: 0, marginYModelPx, rotation: 0,
      rect: { cx: 0, cy, w, h, rot: 0 }, isGuide: true, isFocus: false,
    };
  }

  // Radial (level ≥ 1): margin runs along the node's angle θ; rotate by θ, flipped on the left half.
  const text = truncate(input.text);
  const w = measure(text, 'sans');
  const theta = input.angle;
  const reach = input.rNode + (6 + w / 2) / zoom; // model px
  const marginXModelPx = reach * Math.cos(theta);
  const marginYModelPx = reach * Math.sin(theta);
  const rot = Math.cos(theta) < 0 ? theta + Math.PI : theta;
  const R = (input.rRing + reach) * zoom; // screen-px distance of the label centre from the origin
  return {
    id: input.id, text, font: 'sans', fontSizeModelPx,
    marginXModelPx, marginYModelPx, rotation: rot,
    rect: { cx: R * Math.cos(theta), cy: R * Math.sin(theta), w, h, rot }, isGuide: false, isFocus: false,
  };
}

// ───────────────────────────── oriented-rectangle collision (SAT) ─────────────────────────────

function corners(r: OrientedRect): Array<[number, number]> {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  const hw = r.w / 2;
  const hh = r.h / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Array<[number, number]>)
    .map(([x, y]) => [r.cx + x * c - y * s, r.cy + x * s + y * c] as [number, number]);
}

function project(pts: Array<[number, number]>, ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of pts) {
    const d = x * ax + y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** True when two oriented rectangles overlap, by the separating-axis theorem. */
export function rectsOverlap(a: OrientedRect, b: OrientedRect): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i]!;
      const [x2, y2] = poly[(i + 1) % 4]!;
      const ax = -(y2 - y1);
      const ay = x2 - x1;
      const [amin, amax] = project(ca, ax, ay);
      const [bmin, bmax] = project(cb, ax, ay);
      if (amax < bmin || bmax < amin) return false; // a separating axis → no overlap
    }
  }
  return true;
}

// ───────────────────────────── placement ─────────────────────────────

export interface PlacementResult {
  /** ids whose label is drawn. */
  shown: Set<string>;
  /** ids that were candidates (passed LOD) but collided. */
  hidden: Set<string>;
  /** guides whose label is hidden. */
  guidesHidden: number;
  /** overlapping pairs AMONG the shown set — 0 by construction (a self-check). */
  overlaps: number;
  /** shown non-guide labels per ring level (k ≥ 1). */
  perLevelShown: Map<number, number>;
}

/**
 * Greedy label placement. Candidates are tried in a fixed priority — focus; selected / hovered /
 * selected-chain; level 1; placeholders; the rest in MODEL order; guides last — and a candidate
 * whose oriented rectangle overlaps any already-placed label is hidden. LOD drops ring-k≥2 SYMBOL
 * labels below the zoom floor before anything is placed. `inputs` must arrive in model order.
 */
export function placeLabels(
  inputs: LabelInput[],
  zoom: number,
  captionPx: number,
  measure: Measure,
  ringStep: number,
): PlacementResult {
  const lodOk = ringStep * zoom >= LOD_MIN_RING_PX;
  // An empty-text label is never a candidate: it would otherwise reserve a zero-width rect, count
  // toward data-labels-shown, and could suppress an overlapping non-empty label (F8).
  const candidates = inputs.filter((i) => i.text !== '' && !(i.kind === 'symbol' && i.level >= 2 && !lodOk));

  const rank = (i: LabelInput): number => {
    if (i.level === 0 && i.kind !== 'guide') return 0; // focus
    if (i.selected || i.hovered) return 1; // selected / hovered / selected-chain
    if (i.kind === 'guide') return 5; // guides last
    if (i.level === 1) return 2;
    if (i.kind === 'group' || i.kind === 'more' || i.kind === 'summary') return 3; // placeholders
    return 4; // the rest
  };

  // Stable sort by priority, model order within a rank (map keeps the original index as tiebreak).
  const ordered = candidates
    .map((input, idx) => ({ input, idx, geom: labelGeom(input, zoom, captionPx, measure) }))
    .sort((a, b) => rank(a.input) - rank(b.input) || a.idx - b.idx);

  const placed: OrientedRect[] = [];
  const shown = new Set<string>();
  const hidden = new Set<string>();
  const perLevelShown = new Map<number, number>();
  let guidesHidden = 0;

  for (const { input, geom } of ordered) {
    const collides = placed.some((r) => rectsOverlap(r, geom.rect));
    if (collides) {
      hidden.add(input.id);
      if (geom.isGuide) guidesHidden += 1;
      continue;
    }
    placed.push(geom.rect);
    shown.add(input.id);
    if (!geom.isGuide && input.level >= 1) perLevelShown.set(input.level, (perLevelShown.get(input.level) ?? 0) + 1);
  }

  // Self-check: the shown set holds no overlapping pair.
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (rectsOverlap(placed[i]!, placed[j]!)) overlaps += 1;
    }
  }

  return { shown, hidden, guidesHidden, overlaps, perLevelShown };
}

/** Format a per-level map as the data attribute string, e.g. "1:9,2:7" (levels ascending). */
export function formatPerLevel(perLevel: Map<number, number>): string {
  return [...perLevel.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(',');
}
