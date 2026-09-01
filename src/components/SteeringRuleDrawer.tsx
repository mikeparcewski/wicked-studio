import { useState } from 'react';
import { steeringTypeOf, type SteeringRule } from '../api/steering.js';
import { parseProvenanceRef } from '../api/wiki.js';
import { useModalEscape } from './Modal.js';
import { EffectBadge, SeverityChip } from './SteeringChips.js';
import { SteeringRetireModal } from './SteeringRetireModal.js';

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

// ── The drawer ────────────────────────────────────────────────────────────────────────────────

export function SteeringRuleDrawer({ rule, evidence, onClose, onEdit, onRetired }: {
  rule: SteeringRule;
  /** From the scoreboard's per-rule evidence join, when the scoreboard is served. */
  evidence: { denial_claims: number; governs_evidence: number } | null;
  onClose: () => void;
  onEdit: (rule: SteeringRule) => void;
  /** Fires after the retire wire succeeded — the shell reloads for the server's state. */
  onRetired: (rule: SteeringRule, reason: string) => void;
}): React.ReactElement {
  const [retiring, setRetiring] = useState(false);
  useModalEscape(onClose);

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
          {rule.weight !== undefined ? <span className="font-mono">{rule.weight}</span> : (
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
        <DetailRow label="Confidence" testid="steering-rule-confidence">{rule.confidence}</DetailRow>
        {rule.compliance !== undefined && (
          <DetailRow label="Compliance" testid="steering-rule-compliance">
            <span className="font-mono">{rule.compliance.framework} / {rule.compliance.control_id}</span>
          </DetailRow>
        )}
      </div>

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
