import {
  SKILL_KIND_LABELS,
  SKILL_PROVENANCE_LABELS,
  type SkillKind,
  type SkillProvenance,
  type SkillRow,
} from '../api/skills.js';

/** The Skills surface's shared chip grammar — kind, provenance, the core / Claude-only / upgrade /
 *  conflict / unpublished badges and the enabled switch: one spelling for the catalog rows and the
 *  drawer. Every word here is the contract's (api-types 0.27.0 `SkillEntry`). */

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

/** Not portable: the skill's files resolve `${CLAUDE_PLUGIN_ROOT}`, invoke a cwd-relative script or
 *  link `../` — Claude-only by nature; excluded from the snapshot's `views/copilot/` and from the
 *  per-launch skill lists core builds for the other CLIs (design v3.2). */
export function ClaudeOnlyBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-claude-only-badge"
      title="not portable — depends on the plugin root, cwd-relative scripts or sibling links; Claude-only, excluded from the snapshot's copilot view and the other CLIs' per-launch skill lists"
      className={BADGE}
      style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}
    >
      claude-only
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
      {!skill.portable && <ClaudeOnlyBadge />}
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
