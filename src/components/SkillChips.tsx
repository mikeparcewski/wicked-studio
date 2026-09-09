import {
  isUnpublished,
  SKILL_KIND_LABELS,
  SKILL_PROVENANCE_LABELS,
  type SkillKind,
  type SkillProvenance,
  type SkillRow,
} from '../api/skills.js';

/** The Skills surface's shared chip grammar — kind, provenance, the core / Claude-only / conflict /
 *  unpublished badges and the enabled switch: one spelling for the catalog rows and the drawer. */

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

export function ProvenanceChip({ provenance }: { provenance: SkillProvenance }): React.ReactElement {
  return (
    <span
      data-testid="skills-provenance-chip"
      data-provenance={provenance}
      className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold font-mono uppercase"
      style={{ color: PROVENANCE_COLOR[provenance], border: `1px solid ${PROVENANCE_COLOR[provenance]}` }}
    >
      {SKILL_PROVENANCE_LABELS[provenance]}
    </span>
  );
}

const BADGE = 'inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold font-mono uppercase';

/** Core-by-reference: a registered workflow's `skill_ref` (or a referenced skill's `mandates`)
 *  names this skill — disabling or renaming it is BLOCKING at the guards, so the badge says why
 *  the switch will refuse. */
export function CoreBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-core-badge"
      title="core — in the registered-reference closure (a workflow's skill_ref or a mandate); disabling or renaming it is blocked"
      className={BADGE}
      style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
    >
      core
    </span>
  );
}

/** Not portable: leans on `${CLAUDE_PLUGIN_ROOT}`, cwd-relative scripts or `../` links —
 *  Claude-only by nature; excluded from the codex / pi / opencode / copilot mirrors. */
export function ClaudeOnlyBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-claude-only-badge"
      title="not portable — depends on the plugin root, cwd-relative scripts or sibling links; Claude-only, excluded from the other CLIs' mirrors"
      className={BADGE}
      style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}
    >
      claude-only
    </span>
  );
}

/** The three-way refresh kept a user edit AND upstream changed the same skill. */
export function ConflictBadge(): React.ReactElement {
  return (
    <span
      data-testid="skills-conflict-badge"
      title="refresh conflict — your edit was kept and the new upstream side is stored for diff; reset takes the new baseline"
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
      title="unpublished — the current snapshot carries an older version (or none); Publish to hand this content to workers"
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
      {skill.conflict && <ConflictBadge />}
      {isUnpublished(skill) && <UnpublishedBadge />}
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
        ? 'enabled — click to disable: the next publish leaves this skill out of the snapshot'
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
