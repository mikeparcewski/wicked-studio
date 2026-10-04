import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import type { ChainModel } from '../../board/chainModel.js';
import { draftLine, draftSteps, draftTarget, slashItems, wordOf, type DraftRunState } from '../../board/planDraft.js';
import { FIXED_WORD, gateRows, midRunRows, moveStep, orderContext, type Fixed, type OrderRow } from '../../board/planOrder.js';
import { gateInstance } from '../../board/proposalCard.js';
import { useGateStore } from '../../store/gates.js';
import { loadCatalog, usePlanCatalog } from '../../store/planCatalog.js';
import { addGateDraftStep, gateDraftFor, queueMidRunStep, reorderGateDraft, usePlanDrafts } from '../../store/planDrafts.js';
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

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function plannedRun(v: SessionView): boolean {
  const id = (v.session as unknown as { run_identity?: { kind?: unknown } }).run_identity;
  return typeof id === 'object' && id !== null && (id.kind === 'preset' || id.kind === 'user_plan');
}

/** Whether a run gets the plan artifact at all: a planned run that is still going. */
export function hasPlanEditor(v: SessionView, chain: ChainModel | undefined): boolean {
  return chain !== undefined && chain.source === 'team' && plannedRun(v) && !TERMINAL.has(v.session.status);
}

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
  const [note, setNote] = useState<string | null>(null);

  const state: DraftRunState = {
    runId,
    status,
    planned: plannedRun(view),
    planGate: planGate.isPlanGate && planGate.view !== null ? { seed: planGate.view.editSeed } : null,
    gatePending: planGate.pending,
  };
  const target = draftTarget([state]);
  const title = humanTitle(view.session.problem || runId);

  if (target.kind === 'none') {
    return <p data-testid="plan-order-none" className="wk-plan-line wk-plan-pad">{target.reason}</p>;
  }

  const atGate = target.kind === 'gate-amend' && planGate.view !== null && gateKey !== null;
  const g = planGate.view;
  const draft = atGate && g !== null ? gateDraftFor(drafts, runId, gateKey) : null;
  const rows: OrderRow[] = atGate && g !== null ? gateRows(g, draft) : midRunRows(chain);
  const mode = atGate ? 'gate' : 'mid-run';

  const move = (index: number, dir: -1 | 1): void => {
    if (!atGate || g === null || gateKey === null) return;
    const steps = draft !== null ? draftSteps(draft) : g.editSeed.map((c) => ({ catalog: c, added: false }));
    const r = moveStep(steps, index, dir, orderContext(g));
    if ('refused' in r) { setNote(r.refused); return; }
    reorderGateDraft(runId, gateKey, g.editSeed, r.steps);
    setNote(null);
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
      ? `${draftLine(draft)} Approve on the card to send it; nothing has been sent.`
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
            {r.fixed !== null ? (
              <span data-testid="plan-step-fixed" className="wk-plan-fixed" title={`${r.label} ${FIXED_WORD[r.fixed]}.`} aria-label={`${r.label} stays where it is: it ${FIXED_WORD[r.fixed]}.`}>{FIXED_SHORT[r.fixed]}</span>
            ) : r.index !== null ? (
              <span className="wk-plan-moves">
                <button type="button" data-testid="plan-step-up" aria-label={`Move ${r.label} up`} title="Move up" onClick={() => move(r.index!, -1)} className="wk-plan-btn">↑</button>
                <button type="button" data-testid="plan-step-down" aria-label={`Move ${r.label} down`} title="Move down" onClick={() => move(r.index!, 1)} className="wk-plan-btn">↓</button>
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
