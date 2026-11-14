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
  const sans = sansStack();
  const mono = monoStack();
  return (text: string, font: FontKind): number => {
    if (ctx === null) {
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

/** The selected chain: nodes + primary (incl. aggregate-primary) edges from the selection in to the focus. */
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
  cyIdOf: Map<string, string>;
  focusId: string;
  cap: number;
  measure: Measure;
}

const focusIdOf = (model: VisibleModel): string =>
  model.items.find((i) => i.kind === 'focus')?.id ?? model.items[0]?.id ?? 'q:';

/** The label inputs for the current positions and selection — one per item, plus one per guide. */
function buildLabelInputs(ctx: Ctx, selectedId: string | null): LabelInput[] {
  const chain = selectedChain(ctx.model, selectedId, ctx.focusId);
  const inputs: LabelInput[] = ctx.model.items.map((it) => {
    const p = ctx.cy.$id(ctx.cyIdOf.get(it.id)!).position();
    return {
      id: it.id, kind: it.kind, level: it.level, text: it.label,
      rRing: Math.hypot(p.x, p.y), rNode: sizeOf(it) / 2, angle: Math.atan2(p.y, p.x),
      selected: it.id === selectedId, hovered: chain.nodes.has(it.id),
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
function applyLabels(ctx: Ctx, selectedId: string | null): ReturnType<typeof placeLabels> {
  const zoom = ctx.cy.zoom() || 1;
  const inputs = buildLabelInputs(ctx, selectedId);
  const placed = placeLabels(inputs, zoom, ctx.cap, ctx.measure, RING_STEP);
  for (const input of inputs) {
    const cyId = ctx.cyIdOf.get(input.id);
    if (cyId === undefined) continue;
    const node = ctx.cy.$id(cyId);
    if (node.empty()) continue;
    const g = labelGeom(input, zoom, ctx.cap, ctx.measure);
    node.data({ dlabel: placed.shown.has(input.id) ? g.text : '', fsize: g.fontSizeModelPx, mx: g.marginXModelPx, my: g.marginYModelPx, rot: g.rotation });
  }
  return placed;
}

/** Reflect selection + the selected chain + hover dimming as classes. Selection never dims. */
function applyStateClasses(ctx: Ctx, selectedId: string | null, hoverLevel: number | null): void {
  const { cy, model, cyIdOf, focusId } = ctx;
  cy.batch(() => {
    cy.elements().removeClass('dim chain');
    cy.nodes().unselect();
    const safeSel = selectedId !== null ? cyIdOf.get(selectedId) : undefined;
    if (safeSel !== undefined) { const n = cy.$id(safeSel); if (n.nonempty()) n.select(); }
    const chain = selectedChain(model, selectedId, focusId);
    for (const id of chain.nodes) { const c = cyIdOf.get(id); if (c) cy.$id(c).addClass('chain'); }
    for (const e of cy.edges()) if (chain.edges.has(e.data('key') as string)) e.addClass('chain');
    if (hoverLevel !== null) {
      cy.nodes().forEach((n) => { if ((n.data('level') as number) !== hoverLevel) n.addClass('dim'); });
      cy.edges().forEach((e) => { if ((e.data('clamp') as number) !== clampLevel(hoverLevel)) e.addClass('dim'); });
      const guide = model.scaffold.guides.find((g) => Number(g.split(':')[1]) === hoverLevel);
      if (guide !== undefined) { const c = cyIdOf.get(guide); if (c) cy.$id(c).removeClass('dim').addClass('chain'); }
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

/** The model-derived + theme-derived attributes (change only on a model / theme / style change). */
function writeModelAttrs(host: HTMLElement, ctx: Ctx, view: string, ariaLabel: string | undefined): void {
  const { cy, model, cyIdOf, focusId } = ctx;
  const focusLabel = model.items.find((i) => i.id === focusId)?.label ?? '';
  const placedTotal = model.levels.reduce((s, r) => s + r.placed, 0);
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', ariaLabel ?? `${focusLabel} ring graph — ${placedTotal} placed, open to level ${model.openLevel}`);
  host.dataset.view = view;
  host.dataset.focus = focusLabel;
  host.dataset.visible = String(model.counts.visible);
  host.dataset.symbols = String(model.counts.symbols);
  host.dataset.levels = levelsAttr(model);
  host.dataset.openLevel = String(model.openLevel);
  host.dataset.edges = edgeCounts(model.edges);
  host.dataset.styleTheme = document.documentElement.getAttribute('data-theme') ?? '';
  const focusNode = cy.$id(cyIdOf.get(focusId)!);
  host.dataset.focusColor = focusNode.nonempty() ? focusNode.style('background-color') : '';
}

/** The placement-derived attributes (recomputed on every zoom / state change). */
function writeLabelAttrs(host: HTMLElement, cy: cytoscape.Core, placed: ReturnType<typeof placeLabels>): void {
  host.dataset.labelOverlaps = String(placed.overlaps);
  host.dataset.labelsHidden = String(placed.hidden.size);
  host.dataset.guidesHidden = String(placed.guidesHidden);
  host.dataset.labelsShown = formatPerLevel(placed.perLevelShown);
  const sel = cy.nodes(':selected');
  host.dataset.selected = sel.nonempty() ? String(sel.first().data('origId')) : '';
}

export function RingGraph({ model, view, selectedId, hoverLevel, onSelect, onActivate, ariaLabel }: RingGraphProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const idMapRef = useRef<Map<string, string>>(new Map()); // model id → safe cy id
  const rafRef = useRef<number | null>(null);
  const firstSelRef = useRef(true);
  const onSelectRef = useRef(onSelect);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onActivateRef.current = onActivate;
  }, [onSelect, onActivate]);

  // Build / rebuild on a model (or view) change.
  useEffect(() => {
    const host = containerRef.current;
    if (host === null) return undefined;

    const focusId = focusIdOf(model);
    const cap = captionPx();
    const measure = makeMeasure(cap);
    const counts = countPerLevel(model);

    // Safe cy ids (model ids carry ':', '/', '%', '.').
    const cyIdOf = new Map<string, string>();
    model.items.forEach((it, i) => cyIdOf.set(it.id, `i${i}`));
    model.scaffold.guides.forEach((g, i) => cyIdOf.set(g, `g${i}`));
    idMapRef.current = cyIdOf;

    const itemById = new Map(model.items.map((it) => [it.id, it]));

    const nodeEls: cytoscape.ElementDefinition[] = model.items.map((it) => ({
      group: 'nodes' as const,
      data: {
        id: cyIdOf.get(it.id)!, origId: it.id, level: it.level, kind: it.kind,
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
        data: { id: cyIdOf.get(g)!, origId: g, level: k, kind: 'guide', isFocus: 0, isGuide: 1, clamp: clampLevel(k), outlined: 0, diameter: 2 * r, dlabel: '', fsize: cap, mx: 0, my: 0, rot: 0, guideLabel: label },
        grabbable: false, selectable: false,
      };
    });

    const edgeEls: cytoscape.ElementDefinition[] = model.edges
      .filter((e) => cyIdOf.has(e.src) && cyIdOf.has(e.tgt))
      .map((e, i) => ({
        group: 'edges' as const,
        data: {
          id: `e${i}`, key: `${e.src}\u0000${e.tgt}`,
          source: cyIdOf.get(e.src)!, target: cyIdOf.get(e.tgt)!,
          ecls: e.aggregate ? 'aggregate' : e.cls, clamp: clampLevel(e.colorLevel),
          count: e.count, dlabel: e.aggregate ? String(e.count) : '',
        },
      }));

    const renders = canRender();
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
    const ctx: Ctx = { cy, model, cyIdOf, focusId, cap, measure };

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

    // Apply placement + the derived data attributes for the current zoom and state.
    const refresh = (): void => {
      const placed = applyLabels(ctx, selectedId);
      writeModelAttrs(host, ctx, view, ariaLabel);
      writeLabelAttrs(host, cy, placed);
    };

    // Tap: select (+ activate on an activatable item).
    cy.on('tap', 'node[isGuide = 0]', (evt) => {
      const it = itemById.get(evt.target.data('origId') as string);
      if (it === undefined) return;
      onSelectRef.current(it);
      if (it.activatable) onActivateRef.current(it);
    });

    // Recompute labels on zoom, in a single rAF frame.
    cy.on('zoom', () => {
      if (rafRef.current !== null) return;
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number;
      rafRef.current = raf(() => { rafRef.current = null; refresh(); });
    });

    // A theme change re-resolves tokens and re-applies the stylesheet — never the layout.
    const stopTheme = observeTheme(() => { if (!cy.destroyed()) { cy.style(ringStyle()); refresh(); } });

    // First paint: no animation; fit synchronously and write the attributes.
    applyStateClasses(ctx, selectedId, hoverLevel);
    cy.fit(cy.nodes(), PADDING);
    refresh();
    host.dataset.selectedXy = selectedXY(cy);
    host.dataset.animating = 'false';

    firstSelRef.current = true; // the build effect owns this model's initial paint; the selection effect skips it

    return () => {
      stopTheme();
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
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
    // The build effect already painted this model's initial selection/hover state; only react to changes.
    if (firstSelRef.current) { firstSelRef.current = false; return; }
    const cap = captionPx();
    const ctx: Ctx = { cy, model, cyIdOf: idMapRef.current, focusId: focusIdOf(model), cap, measure: makeMeasure(cap) };

    applyStateClasses(ctx, selectedId, hoverLevel);
    const placed = applyLabels(ctx, selectedId);
    writeLabelAttrs(host, cy, placed);

    if (reducedMotion()) {
      cy.fit(cy.nodes(), PADDING);
      host.dataset.selectedXy = selectedXY(cy);
      host.dataset.animating = 'false';
    } else {
      host.dataset.animating = 'true';
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
  ];

  // Per-level hop colours (1–5; 5 covers every deeper ring).
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
    // Edges.
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier', 'line-color': resolveToken('--ink-dim'),
        'target-arrow-color': resolveToken('--ink-dim'), 'arrow-scale': 0.7,
      },
    },
    { selector: 'edge[ecls = "primary"]', style: { width: 1.5, 'line-opacity': 0.6, 'target-arrow-shape': 'triangle' } },
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
