import { seatStandingWord } from './HealthRailSection.js';
import type { EntityMode, RepoEntry, RosterSeat } from '../api/types.js';

export type ConfirmMode = 'none' | 'all' | 'before';

interface Props {
  roster: RosterSeat[];
  selectedClis: Set<string>;
  onToggleCli: (key: string) => void;
  confirmMode: ConfirmMode;
  onConfirmModeChange: (mode: ConfirmMode) => void;
  beforeOrd: number;
  onBeforeOrdChange: (ord: number) => void;
  entityMode: EntityMode;
  onEntityModeChange: (mode: EntityMode) => void;
  repos: RepoEntry[];
  repoRefs: string[];
  onRepoRefsChange: (refs: string[]) => void;
}

function SectionHead({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p
      className="text-[10px] uppercase tracking-widest font-semibold mb-2"
      style={{ color: 'var(--ink-dim)' }}
    >
      {children}
    </p>
  );
}

function Divider(): React.ReactElement {
  return <div style={{ height: '1px', background: 'var(--surface-raised)' }} />;
}

/**
 * Options popover for the chat input launch form. The workflow is not chosen here (S19b): a leading
 * `/` in the problem box opens the workflow menu.
 * Rendered absolutely above the + button by ChatInput; close logic lives there.
 */
export function ContextPopover({
  roster,
  selectedClis,
  onToggleCli,
  confirmMode,
  onConfirmModeChange,
  beforeOrd,
  onBeforeOrdChange,
  entityMode,
  onEntityModeChange,
  repos,
  repoRefs,
  onRepoRefsChange,
}: Props): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-label="Launch options"
      className="flex flex-col text-xs font-mono overflow-y-auto rounded-2xl"
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--surface-raised)',
        boxShadow: 'var(--shadow-overlay)',
        width: '300px',
        maxHeight: '460px',
      }}
    >
      {/* D15: no "Upload files" here. A launch has no way to carry files to its run (POST /runs
          takes none), so a picker that showed "N files attached" and dropped them is gone. */}
      {/* ── CLIs on/off ──────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>CLIs on/off</SectionHead>
        {roster.length === 0 ? (
          <span style={{ color: 'var(--ink-dim)' }}>No roster loaded</span>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {roster.map((seat) => (
              <label
                key={seat.key}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ color: 'var(--ink-muted)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedClis.has(seat.key)}
                  onChange={() => onToggleCli(seat.key)}
                  data-testid={`launch-seat-${seat.key}`}
                />
                <span>{seat.key}</span>
                {seat.health?.status === 'inactive' && (
                  <span
                    className="rounded-full border px-1.5 text-[10px] font-mono"
                    style={{ color: 'var(--status-fail)', borderColor: 'var(--status-fail-dim)' }}
                    title={seat.health.message ?? 'marked inactive by the platform'}
                    data-testid={`seat-health-${seat.key}`}
                  >
                    inactive
                  </span>
                )}
                {/* D3: the roster's own word (`auth`, `council_eligible`) — the Health rail's fold, so
                    a seat the daemon marks `auth: not_required` never reads "sign in needed". */}
                {seatStandingWord(seat).kind === 'signed-out' && (
                  <span
                    className="rounded-full border px-1.5 text-[10px] font-mono"
                    style={{ color: 'var(--status-fail)', borderColor: 'var(--status-fail-dim)' }}
                    title={`${seat.key} isn't signed in — runs routed there will fall back or fail. Sign in in Settings.`}
                    data-testid={`seat-signin-${seat.key}`}
                  >
                    sign in needed
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* ── Gate ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Set gate</SectionHead>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            data-testid="launch-gate"
            className="rounded-lg px-2 py-1"
            style={{
              background: 'var(--surface-base)',
              border: '1px solid var(--surface-raised)',
              color: 'var(--ink-high)',
            }}
            value={confirmMode}
            onChange={(e) => onConfirmModeChange(e.target.value as ConfirmMode)}
          >
            <option value="none">None</option>
            <option value="all">Every unit</option>
            <option value="before">Before unit #</option>
          </select>
          {confirmMode === 'before' && (
            <input
              type="number"
              data-testid="launch-before-ord"
              aria-label="Before unit number"
              min={1}
              value={beforeOrd}
              onChange={(e) => onBeforeOrdChange(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 rounded-lg px-2 py-1"
              style={{
                background: 'var(--surface-base)',
                border: '1px solid var(--surface-raised)',
                color: 'var(--ink-high)',
              }}
            />
          )}
        </div>
      </div>

      <Divider />

      {/* ── Mode ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Set mode</SectionHead>
        <div className="flex items-center gap-1.5">
          {(['shared', 'isolated'] as EntityMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`launch-entity-${m}`}
              onClick={() => onEntityModeChange(m)}
              className="rounded-lg px-3 py-1 capitalize font-medium transition-colors"
              style={
                entityMode === m
                  ? { background: 'var(--surface-raised)', color: 'var(--ink-high)' }
                  : { color: 'var(--ink-dim)' }
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <Divider />

      {/* S19b: no "Choose workflow" here — the problem box names one with `/workflow-<key>`. */}
      {/* ── Repos ────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Add repos</SectionHead>
        {repos.length === 0 ? (
          <p className="text-[11px] font-mono italic" style={{ color: 'var(--ink-dim)' }}>No repos registered.</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
            {repos.map((r) => {
              const checked = repoRefs.includes(r.id);
              return (
                <label
                  key={r.id}
                  className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--surface-raised)]"
                >
                  <input
                    type="checkbox"
                    data-testid={`launch-repo-${r.id}`}
                    checked={checked}
                    onChange={() => {
                      if (checked) onRepoRefsChange(repoRefs.filter((id) => id !== r.id));
                      else onRepoRefsChange([...repoRefs, r.id]);
                    }}
                    className="w-3.5 h-3.5 shrink-0" style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="text-[11px] font-mono truncate" style={{ color: 'var(--ink-high)' }}>
                    {r.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
