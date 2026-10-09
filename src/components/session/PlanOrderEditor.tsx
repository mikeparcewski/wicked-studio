import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import type { ChainModel } from '../../board/chainModel.js';
import { draftLine, draftSteps, draftTarget, heldPoolsOf, slashItems, wordOf, type DraftRunState } from '../../board/planDraft.js';
import { FIXED_WORD, gateRows, midRunRows, moveStep, plannedRun, orderContext, poolCeilings, poolChoices, poolRefusal, type Fixed, type OrderRow } from '../../board/planOrder.js';
import { gateInstance } from '../../board/proposalCard.js';
import { useGateStore } from '../../store/gates.js';
import { loadCatalog, usePlanCatalog } from '../../store/planCatalog.js';
import { addGateDraftStep, gateDraftFor, queueMidRunStep, reorderGateDraft, setGateDraftPool, usePlanDrafts } from '../../store/planDrafts.js';
import { usePlanGate } from '../../store/planGates.js';
import { humanTitle } from '../runIdentity.js';

/**
 * S10 — the ordered plan editor in the run's artifact slot (DES-STUDIO-REBUILD-001 §5.7, §11 S10;
 * §6 Q-R5: order only). The plan as a numbered list: at a `plan_approval` gate a step moves up or
 * down (a draft on the gate card — "Approve with these changes" sends the order as the gate's answer,
 * through the one decision path and its undo window), and a step can be added (the same draft). Steps
 * the engine will not let move say why and offer no move. Mid-run the order is set — a running plan
 * only grows — and a step added here goes through the 10 s undo window, as `/` does (S7).
 * Words and moves are {@link gateRows} / {@link moveStep}; this component only renders them.
 */

/** The one word on a fixed row; the reason is its title. */
const FIXED_SHORT: Readonly<Record<Fixed, string>> = { scope: 'first', deliver: 'last', done: 'ran', floor: 'required', set: 'set' };

export function PlanOrderEditor({ view, chain, size }: { view: SessionView; chain: ChainModel; size: ArtifactSize }): React.ReactElement {
  const runId = view.session.id;
  const status = view.session.status;
  const waiting = status === 'awaiting_human';
  const planGate = usePlanGate(runId, waiting);
  const gate = useGateStore((s) => s.gates[runId]);
  const gateKey = gateInstance(gate);
  const drafts = usePlanDrafts((s) => s.gate);
  const catalogState = usePlanCatalog((s) => s.catalog);
  const entries = usePlanCatalog((s) => s.entries);
  useEffect(() => { loadCatalog(); }, []);
  const catalog = useMemo(() => (catalogState === 'ready' ? entries.map((e) => e.id) : null), [catalogState, entries]);
  // studio#617: the entries whose worker pool a step may lower (an entry's pool above 1).
  const ceilings = useMemo(() => (catalogState === 'ready' ? poolCeilings(entries) : new Map<string, number>()), [catalogState, entries]);
  const [note, setNote] = useState<string | null>(null);

  const state: DraftRunState = {
    runId,
    status,
    planned: plannedRun(view),
    // Seeded only from a view read for THIS gate instance (codex r1/r2), as the composer does.
    planGate: planGate.isPlanGate && planGate.view !== null && planGate.fresh ? { seed: planGate.view.editSeed } : null,
    gatePending: planGate.pending || planGate.reading,
  };
  const target = draftTarget([state]);
  const title = humanTitle(view.session.problem || runId);

  if (target.kind === 'none') {
    return <p data-testid="plan-order-none" className="wk-plan-line wk-plan-pad">{target.reason}</p>;
  }

  const atGate = target.kind === 'gate-amend' && planGate.view !== null && gateKey !== null;
  const g = planGate.view;
  const draft = atGate && g !== null ? gateDraftFor(drafts, runId, gateKey) : null;
  // The raw draft (not `gateDraftFor`'s changed-only view) holds a pool set back to the held value.
  const rawDraft = atGate && drafts[runId]?.gateKey === gateKey ? drafts[runId]! : null;
  const rows: OrderRow[] = atGate && g !== null ? gateRows(g, rawDraft, ceilings) : midRunRows(chain);
  const mode = atGate ? 'gate' : 'mid-run';

  const move = (index: number, dir: -1 | 1): void => {
    if (!atGate || g === null || gateKey === null) return;
    const steps = draftSteps(draft ?? { seed: g.editSeed, added: [], order: null });
    const r = moveStep(steps, index, dir, orderContext(g));
    if ('refused' in r) { setNote(r.refused); return; }
    reorderGateDraft(runId, gateKey, g.editSeed, r.steps);
    setNote(null);
  };
  const setPool = (r: OrderRow, value: number): void => {
    if (!atGate || g === null || gateKey === null || r.pool === null) return;
    const refused = poolRefusal(r.label, value, r.pool.ceiling);
    if (refused !== null) { setNote(refused); return; }
    setGateDraftPool(runId, gateKey, g.editSeed, heldPoolsOf(g.editSeed, g.editPools), r.key, value);
    setNote(value < r.pool.ceiling
      ? `${r.label} runs with ${value} of its ${r.pool.ceiling} seats — approve on the card to send it. Nothing has been sent.`
      : `${r.label} runs with its full pool of ${r.pool.ceiling}.`);
  };
  const add = (catalogId: string): void => {
    const word = wordOf(catalogId);
    if (atGate && g !== null && gateKey !== null) {
      addGateDraftStep(runId, gateKey, g.editSeed, catalogId);
      setNote(`${word} is on the plan’s card: approve it there to send it. Nothing has been sent.`);
    } else if (target.kind === 'mid-run') {
      queueMidRunStep(runId, catalogId, title);
      setNote(`Adding ${word} — Undo within 10 s. After that it stays: a running plan only grows.`);
    }
  };

  const line = mode === 'gate'
    ? (draft !== null
      ? `${draftLine(draft, g !== null ? orderContext(g).words : undefined)} Approve on the card to send it; nothing has been sent.`
      : 'Move a step up or down, or add one. The card sends your order when you approve.')
    : 'A running plan only grows: its order is set. A step you add joins at the run’s next step.';
  const addable = slashItems('', target, catalog);

  return (
    <div data-testid="plan-order" data-mode={mode} data-run-id={runId} className={`wk-plan wk-plan--${size}`}>
      <ol data-testid="plan-order-steps" aria-label="The plan, in order" className="wk-plan-steps">
        {rows.map((r, i) => (
          <li key={r.key} data-testid="plan-step" data-catalog={r.catalog} data-fixed={r.fixed ?? 'no'} data-added={r.added ? 'true' : 'false'} className={`wk-plan-step${r.fixed !== null ? ' wk-plan-step--fixed' : ''}`}>
            <span aria-hidden className="wk-plan-n">{i + 1}</span>
            <span className="wk-plan-label">{r.label}</span>
            {r.added && <span data-testid="plan-step-added" className="wk-plan-tag">added</span>}
            {r.pool !== null && (
              <label data-testid="plan-step-pool" className="wk-plan-pool" title={`One builder plus monitors. A step can lower its pool, never raise it above ${r.pool.ceiling}.`}>
                <span className="wk-plan-pool-word">pool</span>
                <select
                  data-testid="plan-step-pool-select"
                  aria-label={`${r.label} (step ${i + 1}) worker pool, at most ${r.pool.ceiling}`}
                  value={r.pool.value}
                  onChange={(e) => setPool(r, Number(e.target.value))}
                  className="wk-plan-pool-select"
                >
                  {poolChoices(r.pool.ceiling).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {r.fixed !== null ? (
              <span data-testid="plan-step-fixed" className="wk-plan-fixed" title={`${r.label} ${FIXED_WORD[r.fixed]}.`} aria-label={`${r.label} stays where it is: it ${FIXED_WORD[r.fixed]}.`}>{FIXED_SHORT[r.fixed]}</span>
            ) : r.index !== null ? (
              <span className="wk-plan-moves">
                <button type="button" data-testid="plan-step-up" aria-label={`Move ${r.label} (step ${i + 1}) up`} title="Move up" onClick={() => move(r.index!, -1)} className="wk-plan-btn">↑</button>
                <button type="button" data-testid="plan-step-down" aria-label={`Move ${r.label} (step ${i + 1}) down`} title="Move down" onClick={() => move(r.index!, 1)} className="wk-plan-btn">↓</button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p data-testid="plan-order-line" className="wk-plan-line">{line}</p>
      {note !== null && <p data-testid="plan-order-note" role="status" className="wk-plan-note">{note}</p>}
      <div data-testid="plan-add" className="wk-plan-add">
        <span className="wk-plan-add-word">Add a step:</span>
        {addable.map((it) => (
          <button
            key={it.command.cmd}
            type="button"
            data-testid="plan-add-item"
            data-catalog={it.command.catalog ?? ''}
            data-refused={it.refused !== null ? 'true' : 'false'}
            aria-disabled={it.refused !== null}
            title={it.refused ?? it.command.line}
            onClick={() => { if (it.refused !== null) setNote(it.refused); else if (it.command.catalog !== null) add(it.command.catalog); }}
            className={`wk-plan-btn wk-plan-btn--add${it.refused !== null ? ' wk-plan-btn--refused' : ''}`}
          >
            + {it.command.word}
          </button>
        ))}
      </div>
    </div>
  );
}
