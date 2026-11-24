import { useMemo, useState } from 'react';
import type { BlastRadius } from '../../api/types.js';
import { blastRows } from '../../graph/blastRings.js';
import { buildCodeRings, type CollapseState } from '../../graph/codeRings.js';
import type { Item } from '../../graph/ringModel.js';
import { RingGraph } from './RingGraph.js';

type Dependent = BlastRadius['dependents'][number];

const hops = (k: number): string => `${k} hop${k === 1 ? '' : 's'}`;
const NAMES_LISTED = 12;

/**
 * BLAST RADIUS AS RINGS (studio#1290; Graph rings, part 3): a symbol's dependents drawn by hop around it on the ring
 * canvas (RingGraph over codeRings), in place of the side panel's "first 30, +N more" list, so every dependent is
 * reachable. A ring with more than 24 symbols shows file groups (a tap opens one) and pages the files and members; a
 * hop past the canvas's budget waits behind a summary (a tap opens it). A symbol tapped is named with its file and hop
 * count, and opens in the code graph. What the rings leave out is said under them.
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
  const [shownFor, setShownFor] = useState(rings);
  const [picked, setPicked] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // A new answer (another symbol, or the same one asked again) starts from its own default view.
  if (shownFor !== rings) {
    setShownFor(rings);
    setState(rings.defaultState());
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
  const unplaced = rows.filter((r) => r.depth === null);

  const apply = (next: CollapseState): void => {
    const res = rings.tryApply(current, next);
    setState(res.state);
    setRefused(res.refused?.message ?? null);
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
  if (unplaced.length > 0) {
    const names = unplaced.slice(0, NAMES_LISTED).map((r) => r.name).join(', ');
    const more = unplaced.length > NAMES_LISTED ? `, and ${unplaced.length - NAMES_LISTED} more` : '';
    notes.push(unplaced.length === 1
      ? `1 dependent has no hop count, so it is not drawn: ${names}.`
      : `${unplaced.length} dependents have no hop count, so they are not drawn: ${names}${more}.`);
  }
  if (blast.depth_horizon_reached === true) {
    notes.push(typeof blast.searched_depth === 'number'
      ? `The search stopped at ${hops(blast.searched_depth)}; more dependents lie beyond it.`
      : 'The search stopped at its hop limit; more dependents lie beyond it.');
  }
  if (blast.node_cap_reached === true) notes.push('The search reached its size limit, so some dependents are missing.');
  if (typeof blast.truncated_dependents === 'number' && blast.truncated_dependents > 0) {
    notes.push(`${blast.truncated_dependents} more ${blast.truncated_dependents === 1 ? 'dependent was' : 'dependents were'} left out of the answer to fit its size.`);
  }

  return (
    <div data-testid="blast-rings" className="h-full flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--surface-raised)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--ink-high)' }}>
          Blast radius of <span className="font-mono">{blast.target}</span>
        </span>
        <span data-testid="blast-rings-levels" className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          {levels.map(([k, n]) => `${hops(k)} · ${n}`).join(' · ')}
        </span>
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm ml-auto" onClick={onBack}>Back to the code graph</button>
      </div>
      <div className="flex-1 min-h-0">
        <RingGraph model={model} view="rings" selectedId={picked === null ? null : `n:${picked}`} hoverLevel={null}
          onSelect={select} onActivate={activate}
          ariaLabel={`Blast radius of ${blast.target}: ${blast.dependents.length} dependents by hop. Tap a file group or a summary to open it.`} />
      </div>
      {(dep !== undefined || refused !== null || notes.length > 0) && (
        <div className="shrink-0 border-t px-3 py-2 flex flex-col gap-1.5 text-xs" style={{ borderColor: 'var(--surface-raised)' }}>
          {dep !== undefined && (
            <div data-testid="blast-rings-picked" className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{dep.name}</span>
              <span className="font-mono min-w-0" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>{dep.file}:{dep.line}</span>
              {depDepth !== null && <span style={{ color: 'var(--ink-muted)' }}>{hops(depDepth)}</span>}
              <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => onOpen(dep)}>Open in the code graph</button>
            </div>
          )}
          {refused !== null && <p data-testid="blast-rings-refused" role="status" style={{ color: 'var(--ink-muted)' }}>{refused}</p>}
          {notes.length > 0 && (
            <div data-testid="blast-rings-notes" className="flex flex-col gap-0.5" style={{ color: 'var(--ink-muted)' }}>
              {notes.map((n) => <p key={n}>{n}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
