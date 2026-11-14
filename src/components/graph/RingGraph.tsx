/**
 * RingGraph — the cytoscape canvas that draws a visibleModel (ringModel.ts) as concentric rings: a
 * focus at the centre, each hop a coloured ring, file groups / "+N more" / summaries as placeholders,
 * classified edges between them, and a dashed guide ring per hop with its level label at 12 o'clock.
 *
 * It wires the PURE geometry in cytoBase.ts (the concentric transform, the label placement/collision/
 * LOD pass) to a live cytoscape instance, reads every derived fact back off cytoscape onto data-*
 * attributes, and never forks ringModel.ts / codeRings.ts. No screen uses it yet (rings 2 of 5).
 */
import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

import type { Item, VisibleModel, ModelEdge } from '../../graph/ringModel.js';
import { RING_STEP } from '../../graph/ringModel.js';
import { resolveToken, resolveTokenValue, resolveTokenPx } from '../../styles/resolveToken.js';
import {
  observeTheme, ringPosition, labelGeom, placeLabels, formatPerLevel,
  type FontKind, type LabelInput, type Measure,
} from './cytoBase.js';

export interface RingGraphProps {
  model: VisibleModel;
  /** Only 'rings' for now; the Tree view comes in a later run. */
  view: 'rings';
  selectedId: string | null;
  /** A hovered level (an input, e.g. from the chips): dims every other level. */
  hoverLevel: number | null;
  onSelect: (item: Item) => void;
  onActivate: (item: Item) => void;
  /** Overrides the default aria-label (focus label + placed count + open level). */
  ariaLabel?: string;
}

const PADDING = 48;
const BOUNDING = 2000; // a fixed layout box centred on 0; the transform overrides radii anyway
const CAPTION_FALLBACK = 12;

const sansStack = (): string => resolveTokenValue('--font-sans') || 'system-ui, sans-serif';
const monoStack = (): string => resolveTokenValue('--font-mono') || 'ui-monospace, monospace';
const captionPx = (): number => {
  const px = resolveTokenPx('--text-caption');
  return Number.isFinite(px) ? px : CAPTION_FALLBACK;
};

const sizeOf = (item: Pick<Item, 'size'>): number =>
  (item.size === 'focus' ? 28 : item.size === 'placeholder' ? 22 : 14);
const clampLevel = (n: number): number => Math.min(5, Math.max(1, n));

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Whether a real 2D canvas is available. jsdom stubs getContext with an object that has no
 * setTransform, so cytoscape's render loop throws on its first frame; there we run headless (no
 * renderer) — positions, style and fit still compute, nothing draws. A real browser always renders.
 */
function canRender(): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    return ctx != null && typeof (ctx as CanvasRenderingContext2D).setTransform === 'function';
  } catch {
    return false;
  }
}

/** A canvas-backed text measurer at the caption size; the label geometry's `measure` dependency. */
function makeMeasure(cap: number): Measure {
  let ctx: CanvasRenderingContext2D | null = null;
  // Cache the FIRST getContext attempt (success or null) so a browserless environment, where
  // getContext always returns null, does not create a fresh canvas on every label measured (F6).
  let tried = false;
  const sans = sansStack();
  const mono = monoStack();
  return (text: string, font: FontKind): number => {
    if (!tried) {
      tried = true;
      try {
        ctx = document.createElement('canvas').getContext('2d');
      } catch {
        ctx = null;
      }
    }
    if (ctx === null) return text.length * (cap * 0.6); // non-browser fallback
    ctx.font = `${cap}px ${font === 'mono' ? mono : sans}`;
    return ctx.measureText(text).width;
  };
}

/** Count the drawn items per ring level (level 0 is the focus). */
function countPerLevel(model: VisibleModel): number[] {
  const out: number[] = [];
  for (const it of model.items) out[it.level] = (out[it.level] ?? 0) + 1;
  return out;
}

/** The edge-class tally for the data attribute, e.g. "primary:9,aggregate:2,same:1,alt:1,skip:1". */
function edgeCounts(edges: ModelEdge[]): string {
  const c = { primary: 0, aggregate: 0, same: 0, alt: 0, skip: 0 };
  for (const e of edges) {
    if (e.aggregate) c.aggregate += 1;
    else c[e.cls] += 1;
  }
  return `primary:${c.primary},aggregate:${c.aggregate},same:${c.same},alt:${c.alt},skip:${c.skip}`;
}

/** "1:9,2:60" — placed counts per level from the model. */
function levelsAttr(model: VisibleModel): string {
  return model.levels.map((r) => `${r.k}:${r.placed}`).join(',');
}

/**
 * The selected chain: nodes + primary (incl. aggregate-primary) edges from the selection in to the focus.
 *
 * POL-2101: this is a hand-written pointer chase, not cytoscape traversal (bfs/aStar/successors), on purpose.
 * Each node has at most one primary parent (computeParents, src/graph/ringModel.ts:220), so the chain is an
 * O(depth) walk up a single-parent map, not a search. It runs on the pure VisibleModel that the build and
 * selection effects share, so its tests need no renderer or cy instance. It has no weights, heuristics or
 * search order, so cytoscape's graph search would add machinery without changing the single path returned.
 */
function selectedChain(model: VisibleModel, selectedId: string | null, focusId: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (selectedId === null || selectedId === focusId) return { nodes, edges };
  const primaryFrom = new Map<string, ModelEdge>();
  for (const e of model.edges) if (e.cls === 'primary') primaryFrom.set(e.src, e);
  let cur = selectedId;
  nodes.add(cur);
  const guard = new Set<string>();
  while (cur !== focusId && !guard.has(cur)) {
    guard.add(cur);
    const e = primaryFrom.get(cur);
    if (e === undefined) break;
    edges.add(`${e.src}\u0000${e.tgt}`);
    nodes.add(e.tgt);
    cur = e.tgt;
  }
  return { nodes, edges };
}

/** The per-render context the effects thread through the shared helpers below. */
interface Ctx {
  cy: cytoscape.Core;
  model: VisibleModel;
  focusId: string;
  cap: number;
  measure: Measure;
}

const focusIdOf = (model: VisibleModel): string =>
  model.items.find((i) => i.kind === 'focus')?.id ?? model.items[0]?.id ?? 'q:';

/** The label inputs for the current positions, selection and hover — one per item, plus one per guide. */
function buildLabelInputs(ctx: Ctx, selectedId: string | null, hoverLevel: number | null): LabelInput[] {
  const chain = selectedChain(ctx.model, selectedId, ctx.focusId);
  const inputs: LabelInput[] = ctx.model.items.map((it) => {
    // Model ids are cytoscape element ids verbatim; cy.$id looks them up literally (POL-2101).
    const p = ctx.cy.$id(it.id).position();
    return {
      id: it.id, kind: it.kind, level: it.level, text: it.label,
      rRing: Math.hypot(p.x, p.y), rNode: sizeOf(it) / 2, angle: Math.atan2(p.y, p.x),
      selected: it.id === selectedId,
      // `hovered` means "on the selected chain OR on the hovered ring" — both earn label priority, so
      // a hovered ring's labels win a collision over dimmed labels of equal base rank (F3).
      hovered: chain.nodes.has(it.id) || (hoverLevel !== null && it.level === hoverLevel),
    };
  });
  for (const g of ctx.model.scaffold.guides) {
    const k = Number(g.split(':')[1]);
    const r = ctx.model.radii[k] ?? 0;
    if (r <= 0) continue;
    inputs.push({ id: g, kind: 'guide', level: k, text: ctx.model.levels.find((l) => l.k === k)?.label ?? '', rRing: r, rNode: 0, angle: -Math.PI / 2, selected: false, hovered: false });
  }
  return inputs;
}

/** Place the labels at the current zoom and write each node's label text + geometry; returns the result. */
function applyLabels(ctx: Ctx, selectedId: string | null, hoverLevel: number | null): ReturnType<typeof placeLabels> {
  const zoom = ctx.cy.zoom() || 1;
  const inputs = buildLabelInputs(ctx, selectedId, hoverLevel);
  const placed = placeLabels(inputs, zoom, ctx.cap, ctx.measure, RING_STEP);
  for (const input of inputs) {
    const node = ctx.cy.$id(input.id);
    if (node.empty()) continue;
    const g = labelGeom(input, zoom, ctx.cap, ctx.measure);
    node.data({ dlabel: placed.shown.has(input.id) ? g.text : '', fsize: g.fontSizeModelPx, mx: g.marginXModelPx, my: g.marginYModelPx, rot: g.rotation });
  }
  return placed;
}

/** Reflect selection + the selected chain + hover dimming as classes. Selection never dims. */
function applyStateClasses(ctx: Ctx, selectedId: string | null, hoverLevel: number | null): void {
  const { cy, model, focusId } = ctx;
  cy.batch(() => {
    cy.elements().removeClass('dim chain');
    cy.nodes().unselect();
    if (selectedId !== null) { const n = cy.$id(selectedId); if (n.nonempty()) n.select(); }
    const chain = selectedChain(model, selectedId, focusId);
    for (const id of chain.nodes) { const n = cy.$id(id); if (n.nonempty()) n.addClass('chain'); }
    for (const e of cy.edges()) if (chain.edges.has(e.data('key') as string)) e.addClass('chain');
    if (hoverLevel !== null) {
      // Dim never lands on the selection or on a selected-chain element: the focus can be the
      // selection with its chain empty (selectedChain returns early when selectedId === focusId), so
      // the :selected / .chain guards — not chain membership alone — keep it lit (F1).
      cy.nodes().forEach((n) => {
        if ((n.data('level') as number) !== hoverLevel && !n.selected() && !n.hasClass('chain')) n.addClass('dim');
      });
      // Compare each edge's REAL colour level (its data, not the 1..5 colour clamp) with hoverLevel,
      // so on graphs deeper than five rings a level-6/7 edge dims when level 5 is hovered and vice
      // versa; clamp stays for colour only (F2).
      cy.edges().forEach((e) => {
        if ((e.data('colorLevel') as number) !== hoverLevel && !e.hasClass('chain')) e.addClass('dim');
      });
      const guide = model.scaffold.guides.find((g) => Number(g.split(':')[1]) === hoverLevel);
      if (guide !== undefined) { const n = cy.$id(guide); if (n.nonempty()) n.removeClass('dim').addClass('chain'); }
    }
  });
}

/** The selected node's centre in viewport coordinates, as "x,y" (empty when nothing is selected). */
function selectedXY(cy: cytoscape.Core): string {
  const s = cy.nodes(':selected');
  if (s.empty()) return '';
  const rp = s.first().renderedPosition();
  return `${Math.round(rp.x)},${Math.round(rp.y)}`;
}

/** The aria-label: an explicit override, else the derived "<focus> ring graph — N placed, open to level K". */
function ariaLabelFor(model: VisibleModel, focusId: string, ariaLabel: string | undefined): string {
  if (ariaLabel !== undefined) return ariaLabel;
  const focusLabel = model.items.find((i) => i.id === focusId)?.label ?? '';
  const placedTotal = model.levels.reduce((s, r) => s + r.placed, 0);
  return `${focusLabel} ring graph — ${placedTotal} placed, open to level ${model.openLevel}`;
}

/** The model-derived + theme-derived attributes (change only on a model / theme / style change). */
function writeModelAttrs(host: HTMLElement, ctx: Ctx, view: string, ariaLabel: string | undefined): void {
  const { cy, model, focusId } = ctx;
  const focusLabel = model.items.find((i) => i.id === focusId)?.label ?? '';
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', ariaLabelFor(model, focusId, ariaLabel));
  host.dataset.view = view;
  host.dataset.focus = focusLabel;
  host.dataset.visible = String(model.counts.visible);
  host.dataset.symbols = String(model.counts.symbols);
  host.dataset.levels = levelsAttr(model);
  host.dataset.openLevel = String(model.openLevel);
  host.dataset.edges = edgeCounts(model.edges);
  host.dataset.styleTheme = document.documentElement.getAttribute('data-theme') ?? '';
  const focusNode = cy.$id(focusId);
  host.dataset.focusColor = focusNode.nonempty() ? focusNode.style('background-color') : '';
}

/** The placement-derived attributes (recomputed on every zoom / state change). */
function writeLabelAttrs(host: HTMLElement, cy: cytoscape.Core, placed: ReturnType<typeof placeLabels>): void {
  host.dataset.labelOverlaps = String(placed.overlaps);
  host.dataset.labelsHidden = String(placed.hidden.size);
  host.dataset.guidesHidden = String(placed.guidesHidden);
  host.dataset.labelsShown = formatPerLevel(placed.perLevelShown);
  const sel = cy.nodes(':selected');
  host.dataset.selected = sel.nonempty() ? sel.first().id() : '';
}

export function RingGraph({ model, view, selectedId, hoverLevel, onSelect, onActivate, ariaLabel }: RingGraphProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const rafRef = useRef<number | null>(null);
  // Whether the pending zoom frame was scheduled with setTimeout (no requestAnimationFrame): cleanup
  // must clearTimeout it, not cancelAnimationFrame it, or it fires after unmount on a destroyed cy (F6).
  const frameIsTimeoutRef = useRef(false);
  // Latest selection/hover, so the zoom + theme callbacks (which outlive the build render) read the
  // CURRENT values, not the ones captured when the graph was built (F2).
  const selectedIdRef = useRef(selectedId);
  const hoverLevelRef = useRef(hoverLevel);
  // The latest aria-label, so refresh() (zoom/theme frames) never rewrites a stale label and a
  // label-only prop change still updates the host even when the model and view did not change (F6).
  const ariaLabelRef = useRef(ariaLabel);
  // The {selectedId, hoverLevel} the canvas was last painted with (by either effect). The selection
  // effect compares against it instead of a skip-once flag, so a model-only rebuild never swallows the
  // next selection or hover change (F1).
  const lastAppliedRef = useRef<{ selectedId: string | null; hoverLevel: number | null } | null>(null);
  // Whether this instance has a real renderer; a headless instance (jsdom tests) must not animate.
  const rendersRef = useRef(true);
  const onSelectRef = useRef(onSelect);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onActivateRef.current = onActivate;
  }, [onSelect, onActivate]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    hoverLevelRef.current = hoverLevel;
    ariaLabelRef.current = ariaLabel;
  });

  // A label-only prop change (model and view unchanged, so the build effect does not re-run) still
  // updates the host's aria-label; refresh() then reads the ref, so a later zoom never reverts it (F6).
  useEffect(() => {
    const host = containerRef.current;
    const cy = cyRef.current;
    if (host === null || cy === null || cy.destroyed()) return;
    host.setAttribute('aria-label', ariaLabelFor(model, focusIdOf(model), ariaLabel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel]);

  // Build / rebuild on a model (or view) change.
  useEffect(() => {
    const host = containerRef.current;
    if (host === null) return undefined;

    const focusId = focusIdOf(model);
    const cap = captionPx();
    const measure = makeMeasure(cap);
    const counts = countPerLevel(model);

    // Model ids (and guide ids) are used verbatim as cytoscape element ids. cytoscape 3.34.1 accepts
    // any string id and resolves it literally via cy.$id()/getElementById and edge source/target, so
    // no remap is needed for ids carrying ':', '/', '%', '.', '#', spaces or quotes (POL-2101).
    const nodeIds = new Set<string>([...model.items.map((it) => it.id), ...model.scaffold.guides]);

    const itemById = new Map(model.items.map((it) => [it.id, it]));

    const nodeEls: cytoscape.ElementDefinition[] = model.items.map((it) => ({
      group: 'nodes' as const,
      data: {
        id: it.id, level: it.level, kind: it.kind,
        isFocus: it.kind === 'focus' ? 1 : 0, isGuide: 0,
        clamp: clampLevel(it.colorLevel), outlined: it.outlined ? 1 : 0,
        diameter: sizeOf(it), dlabel: '', fsize: cap, mx: 0, my: 0, rot: 0,
      },
    }));

    const guideEls: cytoscape.ElementDefinition[] = model.scaffold.guides.map((g) => {
      const k = Number(g.split(':')[1]);
      const r = model.radii[k] ?? 0;
      const label = model.levels.find((l) => l.k === k)?.label ?? '';
      return {
        group: 'nodes' as const,
        data: { id: g, level: k, kind: 'guide', isFocus: 0, isGuide: 1, clamp: clampLevel(k), outlined: 0, diameter: 2 * r, dlabel: '', fsize: cap, mx: 0, my: 0, rot: 0, guideLabel: label },
        grabbable: false, selectable: false,
      };
    });

    const edgeEls: cytoscape.ElementDefinition[] = model.edges
      .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.tgt))
      .map((e, i) => ({
        group: 'edges' as const,
        data: {
          id: `e${i}`, key: `${e.src}\u0000${e.tgt}`,
          source: e.src, target: e.tgt,
          ecls: e.aggregate ? 'aggregate' : e.cls,
          // `clamp` (1..5) drives the hop colour; `colorLevel` keeps the edge's REAL level so hover
          // dimming can compare it directly with hoverLevel on graphs deeper than five rings (F2).
          clamp: clampLevel(e.colorLevel), colorLevel: e.colorLevel,
          count: e.count, dlabel: e.aggregate ? String(e.count) : '',
        },
      }));

    const renders = canRender();
    rendersRef.current = renders;
    const cy = cytoscape({
      ...(renders ? { container: host } : { headless: true, styleEnabled: true }),
      elements: [...nodeEls, ...guideEls, ...edgeEls],
      style: ringStyle(),
      layout: { name: 'null' } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
    });
    cyRef.current = cy;
    const ctx: Ctx = { cy, model, focusId, cap, measure };

    // Lock guides at the origin (they are circles centred on the focus, sized to 2·r_k).
    const guideCol = cy.nodes('[isGuide = 1]');
    guideCol.positions({ x: 0, y: 0 });
    guideCol.lock();

    const maxLevel = model.items.reduce((m, it) => Math.max(m, it.level), 0);
    const drawn = cy.nodes('[isGuide = 0]');

    // Concentric distributes the angle; the transform shifts by π/n_k and sets the radius to r_k.
    cy.layout({
      name: 'concentric',
      // @ts-expect-error cytoscape's layout typings omit concentric's own options
      eles: drawn,
      concentric: (node: cytoscape.NodeSingular) => maxLevel - (node.data('level') as number),
      levelWidth: () => 1,
      equidistant: false,
      avoidOverlap: true,
      boundingBox: { x1: -BOUNDING / 2, y1: -BOUNDING / 2, w: BOUNDING, h: BOUNDING },
      fit: false,
      animate: false,
      transform: (node: cytoscape.NodeSingular, pos: { x: number; y: number }) =>
        ringPosition(pos, node.data('level') as number, model.radii, counts),
    }).run();

    // Apply placement + the derived data attributes for the current zoom and state. Reads the latest
    // selection through the ref so a later zoom / theme frame never reverts to a stale selection (F2).
    const refresh = (): void => {
      const placed = applyLabels(ctx, selectedIdRef.current, hoverLevelRef.current);
      writeModelAttrs(host, ctx, view, ariaLabelRef.current);
      writeLabelAttrs(host, cy, placed);
      // Keep the selection's rendered position current after a zoom or pan (F5).
      host.dataset.selectedXy = selectedXY(cy);
    };

    // Tap: select (+ activate on an activatable item).
    cy.on('tap', 'node[isGuide = 0]', (evt) => {
      const it = itemById.get(evt.target.id());
      if (it === undefined) return;
      onSelectRef.current(it);
      if (it.activatable) onActivateRef.current(it);
    });

    // Recompute labels + the selection's rendered position on a viewport change (zoom OR pan),
    // coalesced to one frame. The callback no-ops if the instance was destroyed before the frame ran,
    // and the frame is tracked as rAF vs setTimeout so cleanup cancels the right handle (F5, F6).
    cy.on('zoom pan', () => {
      if (rafRef.current !== null) return;
      if (typeof requestAnimationFrame === 'function') {
        frameIsTimeoutRef.current = false;
        rafRef.current = requestAnimationFrame(() => { rafRef.current = null; if (!cy.destroyed()) refresh(); });
      } else {
        frameIsTimeoutRef.current = true;
        rafRef.current = setTimeout(() => { rafRef.current = null; if (!cy.destroyed()) refresh(); }, 0) as unknown as number;
      }
    });

    // A theme change re-resolves tokens: rebuild the stylesheet AND recompute the caption size + the
    // measurer (whose font stacks may have changed), so labels are re-measured with the new fonts —
    // never the layout (F6).
    const stopTheme = observeTheme(() => {
      if (cy.destroyed()) return;
      ctx.cap = captionPx();
      ctx.measure = makeMeasure(ctx.cap);
      cy.style(ringStyle());
      refresh();
    });

    // First paint: no animation; fit synchronously and write the attributes.
    applyStateClasses(ctx, selectedId, hoverLevel);
    cy.fit(cy.nodes(), PADDING);
    refresh();
    host.dataset.selectedXy = selectedXY(cy);
    host.dataset.animating = 'false';

    // Record what this build painted; the selection effect skips an apply only while it still matches.
    lastAppliedRef.current = { selectedId, hoverLevel };

    return () => {
      stopTheme();
      if (rafRef.current !== null) {
        if (frameIsTimeoutRef.current) clearTimeout(rafRef.current);
        else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      cy.stop();
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, view]);

  // Selection / hover changes: re-apply state + labels, animate the recentre unless reduced motion.
  useEffect(() => {
    const cy = cyRef.current;
    const host = containerRef.current;
    if (cy === null || host === null || cy.destroyed()) return;
    // The build effect already painted the current selection/hover (it records it in lastAppliedRef).
    // Skip only while this effect's values still match that paint; otherwise apply — a model-only
    // rebuild updates lastAppliedRef to the current values, so the NEXT real change still applies (F1).
    const prev = lastAppliedRef.current;
    if (prev !== null && prev.selectedId === selectedId && prev.hoverLevel === hoverLevel) return;
    // Only a SELECTION change may move the viewport; a hover-only change restyles and relabels in
    // place (F5).
    const selectionChanged = prev === null || prev.selectedId !== selectedId;
    lastAppliedRef.current = { selectedId, hoverLevel };
    const cap = captionPx();
    const ctx: Ctx = { cy, model, focusId: focusIdOf(model), cap, measure: makeMeasure(cap) };

    applyStateClasses(ctx, selectedId, hoverLevel);
    const placed = applyLabels(ctx, selectedId, hoverLevel);
    writeLabelAttrs(host, cy, placed);

    // A hover-only change never touches zoom or pan, and starts no animation (F5).
    if (!selectionChanged) {
      host.dataset.animating = 'false';
      return;
    }

    // The selection changed — record its rendered position synchronously, then recentre (F5).
    host.dataset.selectedXy = selectedXY(cy);

    // Animate only when there is a renderer to animate and motion is allowed (a headless instance has
    // no render loop; cy.animate's rAF step would dereference a missing viewport).
    if (reducedMotion() || !rendersRef.current) {
      cy.fit(cy.nodes(), PADDING);
      host.dataset.selectedXy = selectedXY(cy);
      host.dataset.animating = 'false';
    } else {
      host.dataset.animating = 'true';
      // Stop any in-flight fit first, so quick successive selections never stack 300 ms animations and
      // data-animating cannot read false while a later animation is still running (F5).
      cy.stop();
      cy.animate({
        fit: { eles: cy.nodes(), padding: PADDING }, duration: 300,
        easing: (resolveTokenValue('--ease-out') || 'ease-out') as cytoscape.Css.TransitionTimingFunction,
        complete: () => { host.dataset.selectedXy = selectedXY(cy); host.dataset.animating = 'false'; },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, hoverLevel]);

  return <div ref={containerRef} className="w-full h-full" data-testid="ring-graph" />;
}

/** The cytoscape stylesheet, rebuilt from freshly resolved tokens on every theme change. */
function ringStyle(): cytoscape.StylesheetJson {
  const style: cytoscape.StylesheetJson = [
    {
      selector: 'node',
      style: {
        shape: 'ellipse',
        width: 'data(diameter)', height: 'data(diameter)',
        'background-color': resolveToken('--ink-muted'),
        label: 'data(dlabel)',
        'font-family': sansStack(),
        'font-size': ('data(fsize)' as unknown as number),
        color: resolveToken('--ink-high'),
        'text-halign': 'center', 'text-valign': 'center',
        'text-margin-x': ('data(mx)' as unknown as number), 'text-margin-y': ('data(my)' as unknown as number),
        'text-rotation': ('data(rot)' as unknown as number),
        'text-background-color': resolveToken('--surface-base'),
        'text-background-opacity': 0.85,
        'text-background-shape': 'roundrectangle',
        'border-width': 0,
      },
    },
    { selector: 'node[isFocus = 1]', style: { 'background-color': resolveToken('--accent') } },
    // The generic edge rules come BEFORE the per-level primary-edge colours below: cytoscape keeps the
    // LAST matching declaration (no specificity), so the per-level hop colour must win over this
    // ink-dim base, not the other way round (F4).
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier', 'line-color': resolveToken('--ink-dim'),
        'target-arrow-color': resolveToken('--ink-dim'), 'arrow-scale': 0.7,
      },
    },
    { selector: 'edge[ecls = "primary"]', style: { width: 1.5, 'line-opacity': 0.6, 'target-arrow-shape': 'triangle' } },
  ];

  // Per-level hop colours (1–5; 5 covers every deeper ring). The primary-edge colour rule follows the
  // generic edge rule above, so it wins (F4).
  for (let k = 1; k <= 5; k++) {
    const colour = resolveToken(`--graph-level-${k}`);
    style.push({ selector: `node[clamp = ${k}][isFocus = 0][isGuide = 0]`, style: { 'background-color': colour } });
    style.push({ selector: `node[clamp = ${k}][outlined = 1]`, style: { 'border-width': 2, 'border-style': 'dashed', 'border-color': colour, 'background-opacity': 0.25 } });
    style.push({ selector: `edge[clamp = ${k}][ecls = "primary"]`, style: { 'line-color': colour, 'target-arrow-color': colour } });
  }

  style.push(
    // Guides: a transparent dashed circle with the level label, in mono/ink-dim, at 12 o'clock.
    {
      selector: 'node[isGuide = 1]',
      style: {
        'background-opacity': 0, 'border-width': 1, 'border-style': 'dashed',
        'border-color': resolveToken('--border-strong'),
        label: 'data(dlabel)', 'font-family': monoStack(), color: resolveToken('--ink-dim'),
        'text-background-opacity': 0, 'z-index': 0, events: 'no',
      },
    },
    // Secondary + aggregate edges (they never match the per-level primary rule, so order is free).
    {
      selector: 'edge[ecls = "same"], edge[ecls = "alt"], edge[ecls = "skip"]',
      style: { width: 1, 'line-style': 'dashed', 'line-dash-pattern': [2, 4], 'line-color': resolveToken('--ink-dim'), 'line-opacity': 0.3 },
    },
    {
      selector: 'edge[ecls = "aggregate"]',
      style: { width: 1, 'line-color': resolveToken('--ink-dim'), label: 'data(dlabel)', 'font-family': monoStack(), 'font-size': 10, color: resolveToken('--ink-dim') },
    },
    // Selection: a 3px accent border + an accent underlay, one fade-in (no looping pulse).
    {
      selector: 'node:selected',
      style: {
        'border-width': 3, 'border-style': 'solid', 'border-color': resolveToken('--accent'), 'border-opacity': 1,
        'underlay-color': resolveToken('--accent'), 'underlay-opacity': 0.28, 'underlay-padding': 8, 'underlay-shape': 'ellipse',
      },
    },
    { selector: '.dim', style: { opacity: 0.18 } },
    { selector: '.chain', style: { opacity: 1, 'z-index': 10 } },
  );
  return style;
}
