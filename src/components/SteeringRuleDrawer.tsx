import { useState } from 'react';
import { steeringTypeOf, type SteeringRule } from '../api/steering.js';
import type { SessionView } from '../api/types.js';
import { ruleSentence } from '../board/ruleOrigin.js';
import { fmtWeight } from './SteeringGrid.js';
import { parseProvenanceRef } from '../api/wiki.js';
import { useModalEscape } from './Modal.js';
import { EffectBadge, SeverityChip } from './SteeringChips.js';
import { SteeringRetireModal } from './SteeringRetireModal.js';
import { RuleOrigin } from './decisions/RuleOrigin.js';
import { useProjectsStore } from '../store/projects.js';
import { api } from '../api/client.js';
import { advisoryRule, heldRule, HOLD_VOCAB, holdWords, isHeld, isHoldable, knownObligations } from '../board/holdRule.js';
import { Tech } from './Tech.js';

/**
 * The rule DRAWER — opened from a grid row's ID CELL; everything richer than the grid's common
 * columns lives here: the full statement, provenance (path@sha for doc-ingested, ui/chat
 * first-class), the ADVANCED fields (effect+trigger, obligations, criteria), evidence, and the
 * retire/edit actions. The retire kill switch (typed confirmation + required reason over the
 * shipping DELETE wire) is the SHARED modal (SteeringRetireModal) — the grid's remove opens
 * the same one.
 */

function DetailRow({ label, testid, children }: {
  label: string;
  testid: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span data-testid={testid} className="min-w-0 break-words" style={{ color: 'var(--ink-muted)' }}>{children}</span>
    </div>
  );
}

function ChipList({ values }: { values: string[] }): React.ReactElement {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className="rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {v}
        </span>
      ))}
    </span>
  );
}

/** Provenance, honestly per source: doc-ingested refs render `path@sha` (flagging a digest-less
 *  legacy ref), while `ui`/`chat` authorship is FIRST-CLASS — named, never a dash. */
function provenanceText(rule: SteeringRule): React.ReactNode {
  const src = rule.provenance.source;
  const ref = rule.provenance.ref;
  if (ref !== undefined && ref !== '') {
    const parsed = parseProvenanceRef(ref);
    if (parsed.sha === null) {
      return (
        <span className="font-mono" title="legacy ref without a blob digest — re-ingest to stamp one">
          {parsed.path} <span style={{ color: 'var(--status-gate)' }}>(no digest — re-ingest)</span>
        </span>
      );
    }
    return <span className="font-mono">{parsed.path}@{parsed.sha.slice(0, 12)}</span>;
  }
  if (src === 'ui') return <span data-testid="steering-provenance-ui">authored in studio (ui)</span>;
  if (src === 'chat') return <span data-testid="steering-provenance-chat">authored by the chat run (chat)</span>;
  if (src !== '') return <span className="font-mono">{src}</span>;
  return <span title="this rule carries no provenance">—</span>;
}

// ── "Hold work to it" (WT-U2) ─────────────────────────────────────────────────────────────────

/**
 * Off = advisory (no `effect`; the trigger and obligations stay, inert). On = `allow_with_conditions`
 * + obligations from the closed vocabulary (WT §4.12): the engine inserts them as floor steps when
 * the rule fires. A rule that carries known obligations is held to those with one click; one that
 * carries none asks what to hold it to first. Every write is ONE `POST /governance/rules` (the
 * shipping upsert); the drawer never shows a state the server has not confirmed.
 */
function HoldSwitch({ rule, onHeld }: { rule: SteeringRule; onHeld?: (rule: SteeringRule) => void }): React.ReactElement {
  const held = isHeld(rule);
  const known = knownObligations(rule);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>(known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = async (next: SteeringRule): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.upsertConformanceRule(next);
      setPicking(false);
      onHeld?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (): void => {
    if (busy) return;
    if (held) { void write(advisoryRule(rule)); return; }
    const ready = heldRule(rule, known);
    if (ready !== null) { void write(ready); return; }
    setPicked([]);
    setPicking(true);
  };
  const pick = heldRule(rule, picked);
  return (
    <DetailRow label="Hold work to it" testid="steering-rule-hold">
      <div className="flex flex-col gap-1">
        <label className="inline-flex items-start gap-2">
          <input
            type="checkbox"
            role="switch"
            data-testid="steering-rule-hold-switch"
            checked={held}
            aria-checked={held}
            disabled={busy}
            onChange={toggle}
          />
          <span data-testid="steering-rule-hold-words">{holdWords(rule)}</span>
        </label>
        {picking && !held && (
          <div data-testid="steering-rule-hold-pick" className="flex flex-col gap-1 pl-5">
            <p className="m-0">Hold it to what? When the rule fires, the plan gets:</p>
            {HOLD_VOCAB.map((v) => (
              <label key={v.token} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="steering-rule-hold-token"
                  data-token={v.token}
                  checked={picked.includes(v.token)}
                  disabled={busy}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, v.token] : p.filter((t) => t !== v.token)))}
                />
                <span>{v.label}</span>
                <code className="font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>{v.token}</code>
              </label>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="steering-rule-hold-confirm"
                disabled={pick === null || busy}
                onClick={() => { if (pick !== null) void write(pick); }}
                className="rounded px-2 py-1 text-[10px] font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)', opacity: pick === null || busy ? 0.5 : 1 }}
              >
                Hold
              </button>
              <button
                type="button"
                data-testid="steering-rule-hold-cancel"
                onClick={() => setPicking(false)}
                className="rounded px-2 py-1 text-[10px]"
                style={{ border: '1px solid var(--border)', color: 'var(--ink-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error !== null && (
          <p data-testid="steering-rule-hold-error" role="alert" className="m-0" style={{ color: 'var(--status-fail)' }}>
            Could not save the hold; the rule is as it was. <Tech data-testid="tech-rule-hold-error" parts={[error]} />
          </p>
        )}
      </div>
    </DetailRow>
  );
}

// ── The drawer ────────────────────────────────────────────────────────────────────────────────

export function SteeringRuleDrawer({ rule, evidence, onClose, onEdit, onRetired, runs = [], navigate, onHeld }: {
  rule: SteeringRule;
  /** From the scoreboard's per-rule evidence join, when the scoreboard is served. */
  evidence: { denial_claims: number; governs_evidence: number } | null;
  /** WT-U2: fires after a Hold switch write succeeded — the shell reloads for the server's state. */
  onHeld?: (rule: SteeringRule) => void;
  onClose: () => void;
  onEdit: (rule: SteeringRule) => void;
  /** Fires after the retire wire succeeded — the shell reloads for the server's state. */
  onRetired: (rule: SteeringRule, reason: string) => void;
  /** The app's runs — "Where it was considered" looks into the rule's project's recent steps (DC-S8). */
  runs?: readonly SessionView[];
  /** In-app navigation for the ORIGIN and where-considered links; absent = plain links. */
  navigate?: (path: string) => void;
}): React.ReactElement {
  const [retiring, setRetiring] = useState(false);
  useModalEscape(onClose);
  const projects = useProjectsStore((s) => s.projects);
  const projectName = rule.targets.project !== undefined ? projects.find((p) => p.id === rule.targets.project)?.name ?? null : null;
  const go = navigate ?? ((path: string): void => { window.location.assign(path); });

  return (
    <aside
      data-testid="steering-rule-drawer"
      role="complementary"
      aria-label={`Rule ${rule.id}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[26rem] max-w-[92vw] flex-col gap-3 overflow-y-auto p-4 shadow-2xl"
      style={{ background: 'var(--surface-card)', borderLeft: '1px solid var(--surface-raised)' }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>{rule.id}</span>
        <SeverityChip severity={rule.severity} />
        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{rule.rule_type}</span>
        <button
          data-testid="steering-drawer-close"
          type="button"
          aria-label="Close rule detail"
          onClick={onClose}
          className="ml-auto text-sm leading-none hover:opacity-70"
          style={{ color: 'var(--ink-dim)' }}
        >
          ✕
        </button>
      </div>

      {/* DC-S8 (B11): scope and effect as one sentence, before the field rows. */}
      <p data-testid="rule-sentence" className="m-0 text-[12px]" style={{ color: 'var(--ink-body)' }}>{ruleSentence(rule, projectName)}</p>

      <div data-testid="steering-rule-detail" className="flex flex-col gap-1.5">
        <DetailRow label="Statement" testid="steering-rule-statement">{rule.statement}</DetailRow>
        <DetailRow label="Steering type" testid="steering-rule-type-row">{steeringTypeOf(rule)}</DetailRow>
        <DetailRow label="Applies to" testid="steering-rule-applies">
          {(rule.applies_to?.length ?? 0) > 0 ? <ChipList values={rule.applies_to ?? []} /> : '—'}
        </DetailRow>
        <DetailRow label="Excludes" testid="steering-rule-excludes">
          {(rule.excludes?.length ?? 0) > 0 ? <ChipList values={rule.excludes ?? []} /> : '—'}
        </DetailRow>
        <DetailRow label="Weight" testid="steering-rule-weight">
          {rule.weight !== undefined ? <span className="font-mono">{fmtWeight(rule.weight)}</span> : (
            <span title="this wire predates weights — the engine defaults to 1.0">— (engine default 1.0)</span>
          )}
        </DetailRow>
        <DetailRow label="Effect" testid="steering-rule-effect">
          {rule.effect !== undefined ? (
            <span className="inline-flex items-center gap-2">
              <EffectBadge effect={rule.effect} />
              {rule.trigger?.contains != null && rule.trigger.contains !== '' && (
                <span className="font-mono text-[10px]" title="trigger.contains — the regex tested over the evaluated context">
                  when /{rule.trigger.contains}/
                </span>
              )}
            </span>
          ) : (
            <span title="no effect — this rule informs recall, it never decides a gate">recall-only</span>
          )}
        </DetailRow>
        {(rule.obligations?.length ?? 0) > 0 && (
          <DetailRow label="Obligations" testid="steering-rule-obligations">
            <ChipList values={rule.obligations ?? []} />
          </DetailRow>
        )}
        {/* WT-U2 (WT §4.12): the one explicit switch on a testing rule. A decision rule shows none (DC N7). */}
        {isHoldable(rule) && <HoldSwitch rule={rule} {...(onHeld !== undefined ? { onHeld } : {})} />}
        {rule.criteria !== undefined && rule.criteria !== '' && (
          <DetailRow label="Criteria" testid="steering-rule-criteria">{rule.criteria}</DetailRow>
        )}
        <DetailRow label="Provenance" testid="steering-rule-provenance">{provenanceText(rule)}</DetailRow>
        {rule.provenance.ref !== undefined && rule.provenance.ref !== '' && (
          <DetailRow label="Source URI" testid="steering-rule-source-uri">
            <span className="font-mono">{rule.provenance.ref}</span>
          </DetailRow>
        )}
        <DetailRow label="Evidence" testid="steering-rule-evidence">
          {evidence === null ? (
            <span title="evidence counts ride the governance scoreboard, which this daemon does not serve">—</span>
          ) : (
            `${evidence.denial_claims} denial claims · ${evidence.governs_evidence} governs evidence`
          )}
        </DetailRow>
        {rule.symbol_ref !== undefined && (
          <DetailRow label="Symbol ref" testid="steering-rule-symbol-ref">
            <span className="font-mono">{rule.symbol_ref}</span>
          </DetailRow>
        )}
        {/* Same f32 honesty as weight: 0.95 must never render as 0.949999988079071. */}
        <DetailRow label="Confidence" testid="steering-rule-confidence">{fmtWeight(rule.confidence)}</DetailRow>
        {rule.compliance !== undefined && (
          <DetailRow label="Compliance" testid="steering-rule-compliance">
            <span className="font-mono">{rule.compliance.framework} / {rule.compliance.control_id}</span>
          </DetailRow>
        )}
      </div>

      {/* DC-S8 (B11): ORIGIN from crew's ledger, history, and where it was considered. */}
      <RuleOrigin rule={rule} runs={runs} navigate={go} />

      <div className="flex items-center justify-end gap-2 pt-1">
        {rule.retired === true ? (
          <span data-testid="steering-rule-retired-note" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            retired — withdrawn from recall and enforcement; kept listed because past decisions cite it
          </span>
        ) : (
          <>
            <button
              data-testid="steering-edit-open"
              type="button"
              onClick={() => onEdit(rule)}
              className="rounded px-2 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
            >
              Edit…
            </button>
            <button
              data-testid="steering-retire-open"
              type="button"
              onClick={() => setRetiring(true)}
              className="rounded px-2 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
            >
              Retire…
            </button>
          </>
        )}
      </div>

      {retiring && (
        <SteeringRetireModal
          rule={rule}
          onClose={() => setRetiring(false)}
          onRetired={(reason) => { setRetiring(false); onRetired(rule, reason); }}
        />
      )}
    </aside>
  );
}
