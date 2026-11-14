/**
 * The pure ring model (Graph rings, part 1). A focus at the centre and, around it, concentric rings:
 * ring k holds the items an adapter places k hops away. The first adapter (codeRings.ts) draws a code
 * blast radius; a domain tree will reuse the same pipeline later. This module is deliberately pure —
 * no React, no cytoscape, no I/O, no knowledge of code, files or domains. An adapter supplies the
 * placed nodes, the drawn items, who owns each node and the ring labels; this module turns that into a
 * drawable model (classified edges, projected aggregates, radii and a layout scaffold).
 *
 * Ids are opaque strings here. The adapter tags them (q: centre, n: symbol, g: group, m: more,
 * s: summary, sp: spine, gd: guide); this module never parses a tag.
 */

export type NodeId = string;

/** A node the adapter has already classified. `level` is its ring (0 = centre), or null when unplaced. */
export interface RingNode {
  id: NodeId;
  label: string;
  level: number | null;
  groupKey: string;
}

/** A dependency edge, read as "src depends on tgt". */
export interface RingEdge {
  src: NodeId;
  tgt: NodeId;
}

export type ItemKind = 'focus' | 'symbol' | 'group' | 'more' | 'summary' | 'domain';
export type ItemSize = 'focus' | 'node' | 'placeholder';

/**
 * A drawable item the adapter produced for the current collapse state. The adapter owns `order`
 * (block order); this module keeps it untouched.
 */
export interface Item {
  id: NodeId;
  kind: ItemKind;
  size: ItemSize;
  outlined: boolean;
  refocusable: boolean;
  activatable: boolean;
  level: number;
  order: number;
  colorLevel: number;
  label: string;
  count: number;
  hiddenLinks: number;
}

export interface RingInput {
  focusId: NodeId;
  nodes: RingNode[];
  edges: RingEdge[];
  parentHint?: Record<NodeId, NodeId>;
}

/** What the adapter hands the pipeline for the current collapse state. */
export interface AdapterView {
  items: Item[];
  openLevel: number;
  /** The drawing owner of a placed node (itself when drawn, else the placeholder that stands for it). */
  ownerOf: (id: NodeId) => NodeId;
  /** The ring label for level k with its placed count, e.g. "1 hop · 9". */
  levelLabel: (k: number, count: number) => string;
  /** The placed node ids an item represents (a symbol → itself; a placeholder → its members). */
  membersOf: (itemId: NodeId) => NodeId[];
  /** The ids that are centre members (level 0, folded into the focus). */
  centreMembers: ReadonlySet<NodeId>;
  /** Every placed level, ascending (listed even when nothing on it is drawn). */
  placedLevels: number[];
  /** Placed rows on level k. */
  placedCount: (k: number) => number;
  /** Items shown on level k in the current state. */
  shownCount: (k: number) => number;
  /** Rows counted but never drawn (bad/missing depth). */
  unplaced: number;
  /** Slice nodes with no row that are not centre members. */
  loadedNotPlaced: number;
}

export type EdgeClass = 'primary' | 'same' | 'skip' | 'alt';

export interface ModelEdge {
  src: NodeId;
  tgt: NodeId;
  cls: EdgeClass;
  colorLevel: number;
  count: number;
  aggregate: boolean;
}

export interface LevelRow {
  k: number;
  placed: number;
  shown: number;
  label: string;
}

export interface ScaffoldEdge {
  src: NodeId;
  tgt: NodeId;
}

export interface Scaffold {
  spines: NodeId[];
  /** concentric guide-ring ids gd:1…gd:maxDrawnLevel (layout-only, drawn as circles by a later run). */
  guides: NodeId[];
  edges: ScaffoldEdge[];
}

export interface VisibleCounts {
  visible: number;
  symbols: number;
  unplaced: number;
  loadedNotPlaced: number;
  droppedEdges: number;
}

export interface VisibleModel {
  items: Item[];
  openLevel: number;
  edges: ModelEdge[];
  levels: LevelRow[];
  radii: number[];
  scaffold: Scaffold;
  counts: VisibleCounts;
}

export const RING_STEP = 150;
const NODE_ARC = 26; // minimum arc length a drawn item wants on its ring

export type Direction = 'out' | 'in' | 'both';

/**
 * Breadth-first levels from `root` over `edges`, keeping the minimum depth for each node.
 * `out` follows src→tgt, `in` follows tgt→src, `both` follows either. `root` is depth 0.
 */
export function bfsLevels(root: NodeId, edges: RingEdge[], dir: Direction): Map<NodeId, number> {
  const fwd = new Map<NodeId, NodeId[]>();
  const rev = new Map<NodeId, NodeId[]>();
  for (const e of edges) {
    (fwd.get(e.src) ?? fwd.set(e.src, []).get(e.src)!).push(e.tgt);
    (rev.get(e.tgt) ?? rev.set(e.tgt, []).get(e.tgt)!).push(e.src);
  }
  const neighbours = (n: NodeId): NodeId[] => {
    if (dir === 'out') return fwd.get(n) ?? [];
    if (dir === 'in') return rev.get(n) ?? [];
    return [...(fwd.get(n) ?? []), ...(rev.get(n) ?? [])];
  };
  const depth = new Map<NodeId, number>([[root, 0]]);
  let frontier: NodeId[] = [root];
  while (frontier.length > 0) {
    const next: NodeId[] = [];
    const d = depth.get(frontier[0]!)! + 1;
    for (const n of frontier) {
      for (const m of neighbours(n)) {
        if (!depth.has(m)) {
          depth.set(m, d);
          next.push(m);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Normalise edges before classification:
 *  - rewrite any endpoint that is a centre member to the focus id (q:, level 0);
 *  - drop self-loops;
 *  - merge duplicate pairs;
 *  - a real hop-1→focus edge (after rewriting) supersedes the synthetic one the caller would add,
 *    because it already exists in the merged set.
 */
export function normaliseEdges(edges: RingEdge[], focusId: NodeId, centreMembers: ReadonlySet<NodeId>): RingEdge[] {
  const map = (id: NodeId): NodeId => (centreMembers.has(id) ? focusId : id);
  const seen = new Set<string>();
  const out: RingEdge[] = [];
  for (const e of edges) {
    const src = map(e.src);
    const tgt = map(e.tgt);
    if (src === tgt) continue; // self-loop (includes focus↔focus collapses)
    const key = `${src}\u0000${tgt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ src, tgt });
  }
  return out;
}

export interface ParentResult {
  /** parent[node] = the node's parent id (inner ring), or absent when it has none. */
  parent: Map<NodeId, NodeId>;
  /** the edges actually used, including a synthetic hop-1→focus edge where no real one exists. */
  edges: RingEdge[];
  /** the set of edge keys that are a node's primary (parent) edge. */
  primaryKeys: Set<string>;
  /** parent edge direction: true when parent→node (hint mode), false when node→parent (code mode). */
  hintMode: boolean;
}

const key = (src: NodeId, tgt: NodeId): string => `${src}\u0000${tgt}`;

/**
 * Compute each placed node's parent and the primary (parent) edges.
 *
 * Code mode (no hint): hop 1's parent is the focus, reached by a synthetic node→focus edge when no
 * real one exists. For hop k, the parent is the least tgt id among edges with src = node and tgt at
 * level k−1; a reverse edge is never a parent. Primary direction is node→parent.
 *
 * Hint mode: parent = the hint, primary direction is parent→node, and no synthetic edges are added.
 *
 * `nodeIds` is the full list of placed node ids (caller passes input.nodes). It matters because a
 * placed hop-1 row with no fetched edge must still get a synthetic node→focus primary; deriving the
 * node set from edge endpoints alone would miss it (edges can be partial). When omitted, the node set
 * falls back to the edge endpoints.
 */
export function computeParents(
  normEdges: RingEdge[],
  levelOf: (id: NodeId) => number | null,
  focusId: NodeId,
  parentHint?: Record<NodeId, NodeId>,
  nodeIds?: NodeId[],
): ParentResult {
  const hintMode = parentHint !== undefined;
  const parent = new Map<NodeId, NodeId>();
  const primaryKeys = new Set<string>();
  const edges = [...normEdges];
  const edgeSet = new Set(edges.map((e) => key(e.src, e.tgt)));

  if (hintMode) {
    for (const [node, p] of Object.entries(parentHint!)) {
      if (levelOf(node) === null || levelOf(p) === null) continue;
      parent.set(node, p);
      primaryKeys.add(key(p, node)); // parent→node
    }
    return { parent, edges, primaryKeys, hintMode };
  }

  // Code mode. Group forward edges by src.
  const fwdBySrc = new Map<NodeId, NodeId[]>();
  for (const e of normEdges) {
    (fwdBySrc.get(e.src) ?? fwdBySrc.set(e.src, []).get(e.src)!).push(e.tgt);
  }
  for (const [node, lvl] of allPlaced(normEdges, levelOf, nodeIds, focusId)) {
    if (lvl <= 0) continue; // focus / centre members have no parent
    if (lvl === 1) {
      parent.set(node, focusId);
      const k = key(node, focusId);
      primaryKeys.add(k);
      if (!edgeSet.has(k)) {
        edges.push({ src: node, tgt: focusId }); // synthetic hop-1 edge
        edgeSet.add(k);
      }
      continue;
    }
    // hop k ≥ 2: least tgt id among forward edges whose tgt is at level k-1.
    let best: NodeId | null = null;
    for (const tgt of fwdBySrc.get(node) ?? []) {
      if (levelOf(tgt) === lvl - 1 && (best === null || tgt < best)) best = tgt;
    }
    if (best !== null) {
      parent.set(node, best);
      primaryKeys.add(key(node, best));
    }
  }
  return { parent, edges, primaryKeys, hintMode };
}

/**
 * Every placed node to consider for parenting, with its level: the explicit `nodeIds` (when given)
 * unioned with the edge endpoints and the focus, so an edgeless placed row is never skipped.
 */
function allPlaced(
  edges: RingEdge[],
  levelOf: (id: NodeId) => number | null,
  nodeIds: NodeId[] | undefined,
  focusId: NodeId,
): Array<[NodeId, number]> {
  const ids = new Set<NodeId>();
  if (nodeIds !== undefined) for (const id of nodeIds) ids.add(id);
  for (const e of edges) {
    ids.add(e.src);
    ids.add(e.tgt);
  }
  ids.add(focusId);
  const out: Array<[NodeId, number]> = [];
  for (const id of ids) {
    const l = levelOf(id);
    if (l !== null) out.push([id, l]);
  }
  return out;
}

export interface ClassifiedEdge extends RingEdge {
  cls: EdgeClass;
  colorLevel: number;
}

/**
 * Classify every edge whose two ends are placed into exactly one class. Edges with an unplaced end are
 * counted as dropped (returned separately). colorLevel = the outer end's level.
 */
export function classifyEdges(
  edges: RingEdge[],
  levelOf: (id: NodeId) => number | null,
  primaryKeys: Set<string>,
): { classified: ClassifiedEdge[]; dropped: number } {
  const classified: ClassifiedEdge[] = [];
  let dropped = 0;
  for (const e of edges) {
    const ls = levelOf(e.src);
    const lt = levelOf(e.tgt);
    if (ls === null || lt === null) {
      dropped += 1;
      continue;
    }
    const colorLevel = Math.max(ls, lt);
    let cls: EdgeClass;
    if (primaryKeys.has(key(e.src, e.tgt))) cls = 'primary';
    else if (ls === lt) cls = 'same';
    else if (Math.abs(ls - lt) >= 2) cls = 'skip';
    else cls = 'alt';
    classified.push({ ...e, cls, colorLevel });
  }
  return { classified, dropped };
}

/**
 * Project classified edges onto their owners and merge with counts.
 *  - Both ends drawn as themselves → a real edge (kept, drawn).
 *  - A primary with a placeholder end → an aggregate (drawn, counted as aggregate not primary).
 *  - An aggregate secondary (same/skip/alt onto a placeholder) → counted on the owning item's
 *    hiddenLinks, never drawn.
 */
export function project(
  classified: ClassifiedEdge[],
  ownerOf: (id: NodeId) => NodeId,
): { edges: ModelEdge[]; hiddenLinks: Map<NodeId, number> } {
  const merged = new Map<string, ModelEdge>();
  const hiddenLinks = new Map<NodeId, number>();
  const bump = (id: NodeId): void => {
    hiddenLinks.set(id, (hiddenLinks.get(id) ?? 0) + 1);
  };

  for (const e of classified) {
    const os = ownerOf(e.src);
    const ot = ownerOf(e.tgt);
    const drawnAsSelf = os === e.src && ot === e.tgt;
    if (drawnAsSelf) {
      addEdge(merged, { src: os, tgt: ot, cls: e.cls, colorLevel: e.colorLevel, count: 1, aggregate: false });
      continue;
    }
    // At least one end is a placeholder.
    if (e.cls === 'primary') {
      if (os === ot) {
        // both ends collapsed into the same placeholder — nothing to draw, count as hidden
        bump(os);
        continue;
      }
      addEdge(merged, { src: os, tgt: ot, cls: 'primary', colorLevel: e.colorLevel, count: 1, aggregate: true });
    } else {
      // aggregate secondary: counted on each placeholder end, never drawn
      if (os !== e.src) bump(os);
      if (ot !== e.tgt) bump(ot);
    }
  }
  return { edges: [...merged.values()], hiddenLinks };
}

function addEdge(merged: Map<string, ModelEdge>, e: ModelEdge): void {
  const k = `${e.src}\u0000${e.tgt}\u0000${e.cls}\u0000${e.aggregate ? 1 : 0}`;
  const prev = merged.get(k);
  if (prev) {
    prev.count += e.count;
    prev.colorLevel = Math.max(prev.colorLevel, e.colorLevel);
  } else {
    merged.set(k, { ...e });
  }
}

/**
 * A placeholder's parent for the scaffold: the commonest owner of its members' parents, counting only
 * owners at the placeholder's level − 1 and never the placeholder itself. Ties break by model order
 * (the order members appear in `members`), then by id.
 */
export function placeholderParent(
  placeholderId: NodeId,
  placeholderLevel: number,
  members: NodeId[],
  parent: Map<NodeId, NodeId>,
  ownerOf: (id: NodeId) => NodeId,
  levelOf: (id: NodeId) => number | null,
): NodeId | null {
  const tally = new Map<NodeId, { count: number; order: number }>();
  let order = 0;
  for (const m of members) {
    const p = parent.get(m);
    if (p === undefined) continue;
    const owner = ownerOf(p);
    if (owner === placeholderId) continue; // never itself
    if (levelOf(owner) !== placeholderLevel - 1) continue;
    const prev = tally.get(owner);
    if (prev) prev.count += 1;
    else tally.set(owner, { count: 1, order: order++ });
  }
  let best: NodeId | null = null;
  let bestCount = 0;
  let bestOrder = Infinity;
  for (const [owner, { count, order: o }] of tally) {
    let better = count > bestCount;
    if (!better && count === bestCount) {
      if (o < bestOrder) better = true;
      else if (o === bestOrder && best !== null && owner < best) better = true;
    }
    if (better) {
      best = owner;
      bestCount = count;
      bestOrder = o;
    }
  }
  return best;
}

/**
 * Radii per ring: r_0 = 0; r_k = max(r_{k−1} + RING_STEP, n_k·NODE_ARC / 2π), where n_k is the number
 * of drawn items on ring k. An empty ring keeps a growing radius. Computed up to maxDrawnLevel.
 */
export function radii(drawnPerLevel: number[], maxDrawnLevel: number): number[] {
  const out: number[] = [0];
  for (let k = 1; k <= maxDrawnLevel; k++) {
    const n = drawnPerLevel[k] ?? 0;
    out[k] = Math.max(out[k - 1]! + RING_STEP, (n * NODE_ARC) / (2 * Math.PI));
  }
  return out;
}

/**
 * The layout-only tree scaffold: spines sp:1…sp:(max−1) chained focus→sp:1→sp:2…, and one edge per
 * drawn item at k ≥ 1 from its parent owner (when that owner is drawn at k−1) else sp:(k−1). Guide
 * rings gd:1…gd:maxDrawnLevel accompany the spines (one per drawn ring), layout-only.
 */
export function buildScaffold(
  items: Item[],
  focusId: NodeId,
  maxDrawnLevel: number,
  parentOwnerOf: (item: Item) => NodeId | null,
  drawnIds: ReadonlySet<NodeId>,
): Scaffold {
  const spines: NodeId[] = [];
  const guides: NodeId[] = [];
  const edges: ScaffoldEdge[] = [];
  for (let k = 1; k <= maxDrawnLevel; k++) guides.push(`gd:${k}`);
  for (let k = 1; k <= maxDrawnLevel - 1; k++) spines.push(`sp:${k}`);
  let prev: NodeId = focusId;
  for (const sp of spines) {
    edges.push({ src: prev, tgt: sp });
    prev = sp;
  }
  const spineAt = (k: number): NodeId => (k <= 0 ? focusId : `sp:${k}`);
  for (const it of items) {
    if (it.level < 1) continue;
    const po = parentOwnerOf(it);
    const src = po !== null && drawnIds.has(po) ? po : spineAt(it.level - 1);
    edges.push({ src, tgt: it.id });
  }
  return { spines, guides, edges };
}

/**
 * tryApply(prev, next, visibleOf): accept `next` unless it would show more than 500 items, in which
 * case keep `prev` and report the refusal's visible count. The adapter words the refusal; this module
 * holds no text.
 */
export function tryApply<S>(prev: S, next: S, visibleOf: (s: S) => number): { state: S; refused?: { visible: number } } {
  const v = visibleOf(next);
  if (v > 500) return { state: prev, refused: { visible: v } };
  return { state: next };
}

export const REFUSE_LIMIT = 500;

/**
 * Assemble the full drawable model for the current state. Pure: it reads the input graph and the
 * adapter's view (items, owners, labels, bookkeeping) and runs the pipeline — normalise, parents,
 * classify, project, radii, scaffold — returning everything a renderer needs.
 */
export function visibleModel(input: RingInput, view: AdapterView): VisibleModel {
  const levelById = new Map<NodeId, number | null>();
  for (const n of input.nodes) levelById.set(n.id, n.level);
  levelById.set(input.focusId, 0);
  const levelOf = (id: NodeId): number | null => (levelById.has(id) ? levelById.get(id)! : null);

  const norm = normaliseEdges(input.edges, input.focusId, view.centreMembers);
  const nodeIds = input.nodes.map((n) => n.id);
  const { parent, edges: withSynthetic, primaryKeys } = computeParents(norm, levelOf, input.focusId, input.parentHint, nodeIds);
  const { classified, dropped } = classifyEdges(withSynthetic, levelOf, primaryKeys);
  const { edges: projected, hiddenLinks } = project(classified, view.ownerOf);

  // Stamp hiddenLinks onto each item (aggregate secondaries counted on it).
  const items = view.items.map((it) => ({ ...it, hiddenLinks: hiddenLinks.get(it.id) ?? 0 }));

  const drawnIds = new Set<NodeId>(items.map((it) => it.id));

  // Drawn count per ring, and the highest ring with a drawn item.
  const drawnPerLevel: number[] = [];
  let maxDrawnLevel = 0;
  for (const it of items) {
    drawnPerLevel[it.level] = (drawnPerLevel[it.level] ?? 0) + 1;
    if (it.level > maxDrawnLevel) maxDrawnLevel = it.level;
  }

  const r = radii(drawnPerLevel, maxDrawnLevel);

  // Parent owner for the scaffold, per drawn item.
  const parentOwnerOf = (it: Item): NodeId | null => {
    if (it.level < 1) return null;
    const members = view.membersOf(it.id);
    if (it.size === 'node') {
      const p = parent.get(it.id);
      return p === undefined ? null : view.ownerOf(p);
    }
    return placeholderParent(it.id, it.level, members, parent, view.ownerOf, levelOf);
  };
  const scaffold = buildScaffold(items, input.focusId, maxDrawnLevel, parentOwnerOf, drawnIds);

  const levels: LevelRow[] = view.placedLevels.map((k) => {
    const placed = view.placedCount(k);
    return { k, placed, shown: view.shownCount(k), label: view.levelLabel(k, placed) };
  });

  const symbols = items.filter((it) => it.kind === 'symbol').length;
  const counts: VisibleCounts = {
    visible: items.length,
    symbols,
    unplaced: view.unplaced,
    loadedNotPlaced: view.loadedNotPlaced,
    droppedEdges: dropped,
  };

  return { items, openLevel: view.openLevel, edges: projected, levels, radii: r, scaffold, counts };
}
