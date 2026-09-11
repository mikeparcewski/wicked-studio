import {
  HARNESS_REASON,
  SKILL_KIND_LABELS,
  SKILL_PROVENANCE_LABELS,
  SKILL_REACH_LABELS,
  portabilityReasonCopy,
  skillPortability,
  type SkillKind,
  type SkillPortability,
  type SkillPortabilityView,
  type SkillProvenance,
  type SkillRow,
} from '../api/skills.js';

/** The Skills surface's shared chip grammar — kind, provenance, the core / portability / upgrade /
 *  conflict / unpublished badges and the enabled switch: one spelling for the catalog rows and the
 *  drawer. Every word here is the contract's (api-types 0.34.0 `SkillEntry`). */

export const KIND_COLOR: Record<SkillKind, string> = {
  router: 'var(--accent)',
  'fork-worker': 'var(--status-run)',
  module: 'var(--ink-muted)',
};

export const PROVENANCE_COLOR: Record<SkillProvenance, string> = {
  shipped: 'var(--ink-muted)',
  override: 'var(--status-gate)',
  'user-added': 'var(--status-done)',
};

export function KindChip({ kind }: { kind: SkillKind }): React.ReactElement {
  return (
    <span
      data-testid="skills-kind-chip"
      data-kind={kind}
      className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
      style={{ background: 'var(--surface-raised)', color: KIND_COLOR[kind] }}
    >
      {SKILL_KIND_LABELS[kind]}
    </span>
  );
}

/** `shipped` = every own file byte-identical to the baseline; `override` = edited/replaced files;
 *  `user-added` = no baseline (added through the API, or upstream dropped it while the edits were kept). */
export function ProvenanceChip({ provenance }: { provenance: SkillProvenance }): React.ReactElement {
  return (
    <span
      data-testid="skills-provenance-chip"
      data-provenance={provenance}
      title={provenance === 'shipped'
        ? 'shipped — every file byte-identical to the baseline'
        : provenance === 'override'
          ? 'overridden — a shipped skill with edited or replaced files (reset restores the baseline)'
          : 'user-added — no baseline: added through the API, or upstream dropped it while your edits were kept'}
      className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold font-mono uppercase"
      style={{ color: PROVENANCE_COLOR[provenance], border: `1px solid ${PROVENANCE_COLOR[provenance]}` }}
    >
      {SKILL_PROVENANCE_LABELS[provenance]}
    </span>
  );
}

const BADGE = 'inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold font-mono uppercase';

/** Core-by-reference: in the registered-reference closure — a `skill_ref` of a workflow the daemon
 *  knows, or a skill one of those names in its SKILL.md — disabling or renaming it is BLOCKING at
 *  the guards, so the badge says why the switch will refuse. */
export function CoreBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-core-badge"
      title="core — in the registered-reference closure (a workflow's skill_ref, or named by one of those skills); disabling or renaming it is blocked"
      className={BADGE}
      style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
    >
      core
    </span>
  );
}

/** The pre-0.34.0 sentence — what the badge says when the daemon reports `portable: false` and no
 *  reasons (it predates `portability`, or sent an empty verdict). */
export const GENERIC_NOT_PORTABLE_TITLE =
  'not portable — depends on the plugin root, cwd-relative scripts or sibling links; Claude-only, excluded from the snapshot\'s copilot view and the other CLIs\' per-launch skill lists';

const EXCLUDED = 'excluded from the snapshot\'s copilot view and the other CLIs\' per-launch skill lists';

/** The hover / accessible sentence for one non-portable row: the reasons joined, the first evidence
 *  anchor, and what the exclusion means — or the generic sentence when the daemon sent no reasons. */
export function portabilityTitle(view: SkillPortabilityView): string {
  if (!view.detailed) return GENERIC_NOT_PORTABLE_TITLE;
  const first = view.evidence[0];
  const where = first === undefined ? '' : ` (first at ${first})`;
  if (view.reach === 'needs-claude') {
    return `${SKILL_REACH_LABELS['needs-claude']} — ${view.reasons.join(', ')}${where}: ${portabilityReasonCopy('requires-harness:claude')}; ${EXCLUDED} by design`;
  }
  if (view.reasons.includes(HARNESS_REASON)) {
    // Mixed case: fixing the text is necessary but not sufficient — the harness reason keeps it out.
    return `${SKILL_REACH_LABELS['not-portable']} — ${view.reasons.join(', ')}${where}; an authoring defect AND a harness requirement: fix the skill text; it also needs the Claude harness, so it stays ${EXCLUDED} after the fix`;
  }
  return `${SKILL_REACH_LABELS['not-portable']} — ${view.reasons.join(', ')}${where}; an authoring defect: ${EXCLUDED} until the skill text is fixed`;
}

/**
 * WHY a skill does not reach the non-Claude seats — one badge per KIND of reason (F-079, api-types
 * 0.34.0): any AUTHORING reason (`plugin-root`, `skill-dir-var`, `cwd-script`, `relative-link`,
 * `cross-skill-path`) → **not portable** — the text is fixable, the title lists the reasons and the
 * first `file:line`; `requires-harness:claude` alone → **needs Claude harness** — by design, the
 * title is the reason. `portable` (the admission key core reads) decides whether anything renders;
 * a daemon without `portability` (or a verdict with no reasons) gets the generic **not portable**
 * badge with the pre-0.34.0 sentence. The wrapper keeps `skills-claude-only-badge` for one release
 * so existing selectors keep resolving; the inner badge carries the per-kind testid, the reach and
 * the reasons as data attributes, and its sentence as the accessible name.
 */
export function PortabilityBadge({ portability, portable }: {
  portability: SkillPortability | undefined;
  portable: boolean;
}): React.ReactElement | null {
  const view = skillPortability({ portable, portability });
  if (view.reach === 'portable') return null;
  const title = portabilityTitle(view);
  const needsClaude = view.reach === 'needs-claude';
  return (
    <span data-testid="skills-claude-only-badge" data-reach={view.reach} data-contradiction={view.contradiction ?? undefined} className="inline-flex shrink-0">
      <span
        data-testid={needsClaude ? 'skills-needs-claude-badge' : 'skills-not-portable-badge'}
        data-reasons={view.reasons.join(' ')}
        data-detailed={view.detailed}
        role="note"
        aria-label={title}
        title={title}
        className={BADGE}
        // Amber = actionable (the text is fixable); the ink stays `--ink-high` so the badge reads in
        // BOTH themes (the light theme keeps `--status-gate` pale — only its `-dim` fill is re-tuned).
        style={needsClaude
          ? { background: 'var(--surface-raised)', color: 'var(--ink-muted)' }
          : { background: 'var(--status-gate-dim)', color: 'var(--ink-high)', border: '1px solid var(--status-gate)' }}
      >
        {SKILL_REACH_LABELS[view.reach]}
      </span>
    </span>
  );
}

/** A refreshed baseline changed a file this skill overrides — the new side is readable as the
 *  baseline copy for diffing; the operator's content is kept. */
export function UpgradeBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-upgrade-badge"
      title="upgrade available — the refreshed baseline changed a file you override; your content is kept, the new side is readable from the drawer (Baseline side)"
      className={BADGE}
      style={{ color: 'var(--status-run)', border: '1px solid var(--status-run)' }}
    >
      upgrade
    </span>
  );
}

/** `upgradeAvailable`, or the last refresh found a name collision (upstream now ships a skill
 *  under this user-added name at another dir — `upstreamDir`). Cleared by reset / a later refresh. */
export function ConflictBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-conflict-badge"
      title="refresh conflict — your edit was kept while upstream changed the same file, or upstream now ships a skill under this name at another dir; the baseline side is readable from the drawer, reset takes it"
      className={BADGE}
      style={{ color: 'var(--status-gate)', border: '1px solid var(--status-gate)' }}
    >
      conflict
    </span>
  );
}

/** The current snapshot does not carry this skill's effective content — publish to hand it to
 *  workers. */
export function UnpublishedBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-unpublished-badge"
      title="unpublished — the current snapshot carries an older version of a file this skill owns (or none); Publish to hand this content to workers"
      className={BADGE}
      style={{ color: 'var(--status-run)', border: '1px solid var(--status-run)' }}
    >
      unpublished
    </span>
  );
}

/** The flag badges one catalog row (and the drawer header) wears — one spelling for both. */
export function SkillFlags({ skill }: { skill: SkillRow }): React.ReactElement {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {skill.core && <CoreBadge />}
      <PortabilityBadge portability={skill.portability} portable={skill.portable} />
      {skill.upgradeAvailable && <UpgradeBadge />}
      {skill.conflict && <ConflictBadge />}
      {skill.unpublished && <UnpublishedBadge />}
    </span>
  );
}

/** The enabled switch — a real `role="switch"`; the daemon's guards decide the flip, so the
 *  control shows the MANIFEST state, never an optimistic one. */
export function EnabledToggle({ name, enabled, busy, onToggle, testId }: {
  name: string;
  enabled: boolean;
  /** A write is in flight for this skill (or the catalog is frozen on a conflict) — the switch waits. */
  busy: boolean;
  onToggle: () => void;
  testId: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
      title={enabled
        ? 'enabled — click to disable: the next publish leaves this skill out of the snapshot (its files stay)'
        : 'disabled — click to enable: the next publish carries this skill in the snapshot'}
      disabled={busy}
      onClick={onToggle}
      className="inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-1"
      style={{
        background: enabled ? 'var(--accent)' : 'var(--surface-raised)',
        border: '1px solid var(--surface-raised)',
        justifyContent: enabled ? 'flex-end' : 'flex-start',
        padding: '0 1px',
      }}
    >
      <span
        aria-hidden
        className="block h-3 w-3 rounded-full"
        style={{ background: enabled ? 'var(--accent-fg)' : 'var(--ink-dim)' }}
      />
    </button>
  );
}
