import { useMemo, useState } from 'react';
import type { BlastRadius } from '../../api/types.js';
import { blastCompleteness, blastRows } from '../../graph/blastRings.js';
import { buildCodeRings, type CollapseState } from '../../graph/codeRings.js';
import type { Item } from '../../graph/ringModel.js';
import { RingGraph } from './RingGraph.js';

type Dependent = BlastRadius['dependents'][number];

const hops = (k: number): string => `${k} hop${k === 1 ? '' : 's'}`;

/**
 * BLAST RADIUS AS RINGS (studio#1290; Graph rings, part 3): a symbol's dependents drawn by hop around it on the ring
 * canvas (RingGraph over codeRings), in place of the side panel's "first 30, +N more" list. A ring with more than 24
 * symbols shows file groups (a tap opens one) and pages the files and members; a hop past the canvas's budget waits
 * behind a summary (a tap opens it). Opened files can be closed one by one, or the whole view reset, so the canvas's
 * 500-item budget never strands a dependent. A symbol tapped is named with its file and hop count, and opens in the
 * code graph.
 *
 * Every dependent is also in a list under the canvas (name, file:line, hops, Open): the keyboard and screen-reader
 * path, and the only place a row with no hop count (an older estate) can be shown, as it is on no ring.
 */
export function BlastRings({ blast, onOpen, onBack }: {
  blast: BlastRadius;
  /** Open a dependent in the code graph. */
  onOpen: (dep: Dependent) => void;
  onBack: () => void;
}): React.ReactElement {
  const rows = useMemo(() => blastRows(blast), [blast]);
  const rings = useMemo(() => buildCodeRings({ query: blast.target, rows, edges: [] }), [blast.target, rows]);
  const [state, setState] = useState<CollapseState>(() => rings.defaultState());
  const [moved, setMoved] = useState(false);
  const [shownFor, setShownFor] = useState(rings);
  const [picked, setPicked] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [listed, setListed] = useState(false);
  // A new answer (another symbol, or the same one asked again) starts from its own default view.
  if (shownFor !== rings) {
    setShownFor(rings);
    setState(rings.defaultState());
    setMoved(false);
    setPicked(null);
    setRefused(null);
  }
  const current = shownFor === rings ? state : rings.defaultState();
  const model = useMemo(() => rings.model(current), [rings, current]);

  const byId = useMemo(() => new Map(blast.dependents.map((d) => [d.id, d])), [blast.dependents]);
  const depthOf = useMemo(() => new Map(rows.map((r) => [r.symbolId, r.depth])), [rows]);
  const levels = useMemo(() => {
    const n = new Map<number, number>();
    for (const r of rows) if (r.depth !== null) n.set(r.depth, (n.get(r.depth) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);
  const unplaced = rows.filter((r) => r.depth === null).length;
  // The list: by hop, then name; rows with no hop count last.
  const list = useMemo(() => [...blast.dependents].sort((a, b) => {
    const da = depthOf.get(a.id) ?? Infinity;
    const db = depthOf.get(b.id) ?? Infinity;
    return da !== db ? da - db : a.name.localeCompare(b.name);
  }), [blast.dependents, depthOf]);

  // The files opened on the canvas, each with its file name (the ring's own block label).
  const openFiles = useMemo(() => [...current.openGroups].map((id) => {
    const lvl = Number(/^g:(\d+):/.exec(id)?.[1] ?? NaN);
    const block = Number.isNaN(lvl) ? undefined : rings.blocks(current, lvl).find((b) => b.id === id);
    return { id, label: block?.label ?? id, level: lvl };
  }), [rings, current]);

  const apply = (next: CollapseState): void => {
    const res = rings.tryApply(current, next);
    setState(res.state);
    if (res.state !== current) setMoved(true);
    setRefused(res.refused === undefined ? null : `Showing ${model.counts.visible}. Close a file or reset the view to open others.`);
  };
  const reset = (): void => {
    setState(rings.defaultState());
    setMoved(false);
    setRefused(null);
  };
  const activate = (it: Item): void => {
    if (it.kind === 'group') apply(rings.openGroup(current, it.id));
    else if (it.kind === 'summary') apply(rings.openToLevel(current, Math.max(current.openLevel + 1, it.level)));
    else if (it.kind === 'more') {
      const files = /^m:(\d+):files$/.exec(it.id);
      if (files !== null) apply(rings.moreGroups(current, Number(files[1])));
      else if (it.id.startsWith('m:g:')) apply(rings.moreMembers(current, it.id.slice(2)));
    }
  };
  const select = (it: Item): void => {
    setPicked(it.kind === 'symbol' && it.id.startsWith('n:') ? it.id.slice(2) : null);
  };
  const dep = picked === null ? undefined : byId.get(picked);
  const depDepth = picked === null ? null : depthOf.get(picked) ?? null;

  const notes: string[] = [];
  if (unplaced > 0) {
    notes.push(unplaced === 1
      ? '1 dependent has no hop count, so it is not drawn; it is in the list.'
      : `${unplaced} dependents have no hop count, so they are not drawn; they are in the list.`);
  }
  notes.push(...blastCompleteness(blast));

  return (
    <div data-testid="blast-rings" className="h-full flex flex-col min-h-0">
      <div data-testid="blast-rings-header" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b shrink-0 max-h-[35%] overflow-y-auto" style={{ borderColor: 'var(--surface-raised)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--ink-high)' }}>
          Blast radius of <span className="font-mono">{blast.target}</span>
        </span>
        <span data-testid="blast-rings-levels" className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          {levels.map(([k, n]) => `${hops(k)} · ${n}`).join(' · ')}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {moved && <button type="button" data-testid="blast-rings-reset" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={reset}>Reset view</button>}
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={onBack}>Back to the code graph</button>
        </span>
      </div>
      <div className="flex-1 min-h-[min(120px,30%)]">
        <RingGraph model={model} view="rings" selectedId={picked === null ? null : `n:${picked}`} hoverLevel={null}
          onSelect={select} onActivate={activate}
          ariaLabel={`Blast radius of ${blast.target}: ${blast.dependents.length} dependents by hop. Tap a file group or a summary to open it. Every dependent is also in the list below.`} />
      </div>
      {/* Header, canvas and footer always fit the panel (codex r1-r2, a phone's short panel): the header scrolls within
          a third of it, the canvas keeps 120px (or 30% of a shorter panel), and the footer takes at most half and shrinks and scrolls in what is left. */}
      <div data-testid="blast-rings-footer" className="shrink min-h-0 max-h-[50%] overflow-y-auto border-t px-3 py-2 flex flex-col gap-1.5 text-xs" style={{ borderColor: 'var(--surface-raised)' }}>
        {dep !== undefined && (
          <div data-testid="blast-rings-picked" className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{dep.name}</span>
            <span className="font-mono min-w-0" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>{dep.file}:{dep.line}</span>
            {depDepth !== null && <span style={{ color: 'var(--ink-muted)' }}>{hops(depDepth)}</span>}
            <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => onOpen(dep)}>Open in the code graph</button>
          </div>
        )}
        {refused !== null && <p data-testid="blast-rings-refused" role="status" style={{ color: 'var(--ink-muted)' }}>{refused}</p>}
        {openFiles.length > 0 && (
          <div data-testid="blast-rings-open" className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span style={{ color: 'var(--ink-muted)' }}>Open:</span>
            {openFiles.map((f) => (
              <button key={f.id} type="button" className="wk-btn wk-btn--quiet wk-btn--sm font-mono" style={{ overflowWrap: 'anywhere' }}
                aria-label={`Close ${f.label}`} onClick={() => apply(rings.closeGroup(current, f.id))}>
                {f.label} ×
              </button>
            ))}
          </div>
        )}
        {notes.length > 0 && (
          <div data-testid="blast-rings-notes" className="flex flex-col gap-0.5" style={{ color: 'var(--ink-muted)' }}>
            {notes.map((n) => <p key={n}>{n}</p>)}
          </div>
        )}
        <button type="button" data-testid="blast-rings-list-toggle" className="wk-btn wk-btn--quiet wk-btn--sm self-start"
          aria-expanded={listed} aria-controls="blast-rings-list" onClick={() => setListed((v) => !v)}>
          {listed ? 'Hide the list' : `List all ${blast.dependents.length} dependents`}
        </button>
        {listed && (
          <ul id="blast-rings-list" data-testid="blast-rings-list" className="flex flex-col divide-y" style={{ borderColor: 'var(--surface-raised)' }}>
            {list.map((d) => {
              const k = depthOf.get(d.id) ?? null;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 min-w-0">
                  <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{d.name}</span>
                  <span className="font-mono min-w-0" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>{d.file}:{d.line}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>{k === null ? 'no hop count' : hops(k)}</span>
                  <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm ml-auto" aria-label={`Open ${d.name} in the code graph`} onClick={() => onOpen(d)}>Open</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
