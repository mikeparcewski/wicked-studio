import { seatStandingWord } from './HealthRailSection.js';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client.js';
import type { BaseSkillPosture, RosterSeat, SystemSettings as Settings } from '../api/types.js';
import { getDiagnostics } from '../api/diagnostics.js';
import { describeBaseSkill } from '../board/launchModel.js';
import { useComposerPrefsStore } from '../store/composerPrefs.js';
import { useViewPrefsStore } from '../store/viewPrefs.js';
import { setCachedRoster } from '../store/rosterCache.js';
import { Modal } from './Modal.js';
import { NotificationSettings } from './NotificationSettings.js';
import { Terminal } from './Terminal.js';
import { SignInPanel } from './SignInPanel.js';
import { testingPath } from '../api/testing.js';
import { useDisplayPath, useDisplayText } from '../hooks/useHomePath.js';
import { homeDirsIn } from '../board/homePath.js';

const CLI_DEFAULTS_KEY = 'wicked_default_clis';

/**
 * Client-side mirror of the daemon's worker_config_root rule (empty or absolute).
 * The daemon stays authoritative — this only pre-warns; a 400 still renders inline.
 */
function isAbsolutePathLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * The daemon's settings plus the keys studio's pinned `wicked-crew-api-types` does not carry yet
 * (crew#549 `deliverIdentityLogin`, in api-types 0.67.0). Delete the extension the moment studio
 * bumps its pin — the same TODO shape `api/types.ts` uses for the delivery wire.
 */
type LocalSettings = Settings & { deliverIdentityLogin?: string };

/**
 * Client-side mirror of the daemon's deliver-identity rule (crew#549): a GitHub login — letters,
 * digits and single hyphens, up to 39 — or empty. The daemon stays authoritative (its 400 renders
 * inline); this only pre-warns, because a bad login there refuses EVERY delivery.
 */
function isGitHubLoginLike(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login);
}

interface SettingRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps): React.ReactElement {
  return (
    <div
      className="flex items-start justify-between gap-6 py-4 border-b last:border-b-0"
      style={{ borderColor: 'var(--surface-raised)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--ink-high)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function loadDefaultClis(roster: RosterSeat[]): Set<string> {
  try {
    const stored = localStorage.getItem(CLI_DEFAULTS_KEY);
    if (stored) return new Set(JSON.parse(stored) as string[]);
  } catch { /* ignore */ }
  return new Set(roster.filter((s) => s.enabled_for_council).map((s) => s.key));
}

interface SystemSettingsProps {
  navigate?: (path: string) => void;
}

export function SystemSettings({ navigate = (p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); } }: SystemSettingsProps): React.ReactElement {
  const showPath = useDisplayPath();
  const showText = useDisplayText();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState<Partial<LocalSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [defaultClis, setDefaultClis] = useState<Set<string>>(new Set());
  const [clisSaved, setClisSaved] = useState(false);
  const clisSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The seat whose log-out terminal is open, or null (crew#615: the daemon runs the seat's logout). */
  const [logoutSeat, setLogoutSeat] = useState<RosterSeat | null>(null);
  /** Seats the daemon answered 404 for — no documented logout: their button is hidden. */
  const [noLogout, setNoLogout] = useState<ReadonlySet<string>>(new Set());
  /** The seat whose sign-in panel is open (Amendment 5: plain words, the one command, Copy, check again). */
  const [signInSeat, setSignInSeat] = useState<RosterSeat | null>(null);
  /** Daemon 400 from a save whose patch included worker_config_root — rendered inline at the field. */
  const [workerRootError, setWorkerRootError] = useState<string | null>(null);
  const [deliverIdentityError, setDeliverIdentityError] = useState<string | null>(null);

  // Runs (studio#123): `studio.composer` on the crew settings wire — the
  // `useNotifPrefsStore` pattern, self-saving, outside the `dirty` patch.
  const deliverPr = useComposerPrefsStore((s) => s.prefs.deliverPr);
  const composerPersist = useComposerPrefsStore((s) => s.persist);
  const updateComposerPrefs = useComposerPrefsStore((s) => s.update);

  // S3 (DESIGN-simple §4): "Show technical details" — `studio.view` on the same settings wire,
  // self-saving like the Runs row, off by default.
  const techDetails = useViewPrefsStore((s) => s.prefs.technical_details);
  const viewPersist = useViewPrefsStore((s) => s.persist);
  const updateViewPrefs = useViewPrefsStore((s) => s.update);

  /** Where the daemon says its settings file lives (`GET /settings.path`, crew 0.7.36); `null` =
   *  the daemon predates the field — the page then says so instead of naming a path it made up. */
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  /** studio#275: the discipline (base) skill posture (`GET /diagnostics.skills.baseSkill`); `undefined`
   *  until read, and when the daemon predates the field or has no diagnostics route. */
  const [baseSkill, setBaseSkill] = useState<BaseSkillPosture | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => getDiagnostics())
      .then((d) => { if (!cancelled) setBaseSkill(d.skills === undefined ? undefined : (d.skills.baseSkill ?? null)); })
      .catch(() => { /* no diagnostics: the row says "not reported", never a guessed posture */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    api.getSettings()
      .then((res) => {
        setSettings(res.settings);
        // api-types 0.38.0 `SettingsResponse.path?` (crew 0.7.36); absent/empty on an older daemon.
        setSettingsPath(typeof res.path === 'string' && res.path !== '' ? res.path : null);
      })
      // EC33: the translated message, never `String(Error)`'s "Error: …" framing.
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    api.getRoster()
      .then(({ roster: seats }) => {
        // Deposit for Chat's default chips (DES-FEEDBACK-001 §6.1).
        setCachedRoster(seats);
        setRoster(seats);
        setDefaultClis(loadDefaultClis(seats));
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (clisSavedTimerRef.current) clearTimeout(clisSavedTimerRef.current);
  }, []);

  function toggleDefaultCli(key: string): void {
    setDefaultClis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function saveDefaultClis(): void {
    setError(null);
    try {
      localStorage.setItem(CLI_DEFAULTS_KEY, JSON.stringify([...defaultClis]));
    } catch (e: unknown) {
      setError(String(e));
      return;
    }
    setClisSaved(true);
    if (clisSavedTimerRef.current) clearTimeout(clisSavedTimerRef.current);
    clisSavedTimerRef.current = setTimeout(() => setClisSaved(false), 2500);
  }

  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  function patch<K extends keyof LocalSettings>(key: K, value: LocalSettings[K]): void {
    setDirty((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    setError(null);
    setWorkerRootError(null);
    setDeliverIdentityError(null);
    try {
      const { settings: next } = await api.updateSettings(dirty as Partial<Settings>);
      setSettings(next);
      setDirty({});
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      // A rejected patch that touched worker_config_root (the daemon 400s a
      // non-absolute path) belongs at the field, not the page banner.
      const msg = e instanceof Error ? e.message : String(e);
      if ('worker_config_root' in dirty) setWorkerRootError(msg);
      else if ('deliverIdentityLogin' in dirty) setDeliverIdentityError(msg);
      else setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const merged: LocalSettings = { graphNodeLimit: 150, ...settings, ...dirty };
  const hasDirty = Object.keys(dirty).length > 0;
  const workerRoot = merged.worker_config_root ?? '';
  const workerRootInvalid = workerRoot !== '' && !isAbsolutePathLike(workerRoot);
  const deliverIdentity = merged.deliverIdentityLogin ?? '';
  const deliverIdentityInvalid = deliverIdentity !== '' && !isGitHubLoginLike(deliverIdentity.trim());

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="wk-page-title">System</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>
          Settings are saved to{' '}
          {/* studio#458: the default layer never prints the home directory (`~/…`); "Show technical
              details" shows the full path. Plain type, not monospace (the desk type rule, studio#425). */}
          <span data-testid="settings-path">
            {settingsPath === null ? "the daemon's settings file" : showPath(settingsPath)}
          </span>
          {settingsPath === null && ' (this daemon does not report the path — crew 0.7.36 does)'}.
        </p>
      </div>

      {error && (
        <div
          className="mb-4 px-3 py-2 rounded text-xs"
          style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)', color: 'var(--status-fail)' }}
        >
          {error}
        </div>
      )}

      {/* Theming lives at /theme — link, not a duplicate surface. */}
      <div
        className="rounded-xl px-5 mb-6 flex items-center justify-between py-4"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--ink-high)' }}>Theme</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Appearance, accent, logo, and brand identity.
          </p>
        </div>
        <a
          href="/theme"
          data-testid="theme-page-link"
          onClick={(e) => { e.preventDefault(); navigate('/theme'); }}
          className="text-xs font-mono transition-opacity hover:opacity-80"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          Theme ›
        </a>
      </div>

      {/* Slice L (DES-FEEDBACK-002 §8.2): the desktop-notification opt-in —
          crew-persisted (`studio.notifications`), permission asked only on
          the toggle's own gesture (EC25). */}
      <NotificationSettings />

      {/* ── Testing (Amendment 5 §4): the campaigns page has no rail entry; it is reached from here and ⌘K. */}
      <p data-testid="settings-testing-link" className="text-xs mb-6" style={{ color: 'var(--ink-muted)' }}>
        Looking for test campaigns? They have their own page:{' '}
        <a href={testingPath('campaigns')} onClick={(e) => { e.preventDefault(); navigate(testingPath('campaigns')); }} style={{ color: 'var(--accent)' }}>Testing campaigns →</a>
        {' '}(also in ⌘K).
      </p>

      {/* ── View (DES-studio-rebuild S3) ───────────────────────────────────────
          "Show technical details": one preference, off by default. Crew-persisted under
          `studio.view`; it saves itself, outside the Save button below. */}
      <section
        data-testid="view-settings"
        className="rounded-xl px-5 mb-6"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'var(--ink-dim)' }}
        >
          View
        </h2>

        <SettingRow
          label="Show technical details"
          description="Adds ids, versions and helper names in small grey type: run ids, commit shas and seat names on the run header, the run rows and the gate card — and the full path of anything under your home folder, which otherwise reads as ~/. Same screens; nothing else changes."
        >
          <div className="flex flex-col items-end gap-1">
            <input
              type="checkbox"
              aria-label="Show technical details"
              data-testid="tech-details-toggle"
              checked={techDetails}
              onChange={(e) => updateViewPrefs({ technical_details: e.target.checked })}
              className="w-3.5 h-3.5 shrink-0"
              style={{ accentColor: 'var(--accent)' }}
            />
            {viewPersist === 'dropped' && (
              <p
                className="text-xs text-right"
                style={{ color: 'var(--status-gate)' }}
                data-testid="tech-details-unsaved"
              >
                Not stored by this daemon — applies to this session only.
              </p>
            )}
          </div>
        </SettingRow>
      </section>

      {/* ── Runs (studio#123) ─────────────────────────────────────────────────
          Crew-persisted under `studio.composer`, like Notifications above —
          it saves itself (debounced), so the Save button below governs only
          the daemon tunables, never this row. */}
      <section
        data-testid="runs-settings"
        className="rounded-xl px-5 mb-6"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'var(--ink-dim)' }}
        >
          Runs
        </h2>

        <SettingRow
          label="Discipline skill"
          description="The base skill every agent step is told to follow, by role (creator, evaluator, neutral), from the published skills generation. Set by baseSkillRef and baseSkillPolicy in the daemon settings."
        >
          <p
            data-testid="system-base-skill"
            data-present={baseSkill === undefined || baseSkill === null ? '' : String(baseSkill.present)}
            className="w-56 text-xs font-mono text-right break-words"
            style={{ color: baseSkill !== undefined && baseSkill !== null && !baseSkill.present ? 'var(--status-gate)' : 'var(--ink-high)', overflowWrap: 'anywhere' }}
          >
            {baseSkill === undefined
              ? 'not reported by this daemon'
              : describeBaseSkill(baseSkill) ?? 'discipline skill: off'}
            {baseSkill !== undefined && baseSkill !== null && !baseSkill.present && (
              <span data-testid="system-base-skill-fix" className="block" style={{ color: 'var(--ink-muted)' }}>
                {baseSkill.inCatalog
                  ? 'the catalog holds it — the next skills publish hands it'
                  : 'not in the skills catalog — add and publish it'}
              </span>
            )}
          </p>
        </SettingRow>

        <SettingRow
          label="Open a PR when a build run finishes"
          description="On a finished build run the daemon pushes the run's branch, rebases it onto the default branch, and opens a pull request. Merging stays human — nothing lands without you. Runs with no workflow or no attached repository launch without delivery; the composer says so before you send."
        >
          <div className="flex flex-col items-end gap-1">
            <input
              type="checkbox"
              aria-label="Open a PR when a build run finishes"
              data-testid="deliver-pr-toggle"
              checked={deliverPr}
              onChange={(e) => updateComposerPrefs({ deliverPr: e.target.checked })}
              className="w-3.5 h-3.5 shrink-0"
              style={{ accentColor: 'var(--accent)' }}
            />
            {/* wicked-crew#323: an unfixed daemon answers 200 and drops
                `studio.*` keys. The read-back is the only proof the write
                landed, so an unverified write says so rather than sitting
                there looking saved. */}
            {composerPersist === 'dropped' && (
              <p
                className="text-xs text-right"
                style={{ color: 'var(--status-gate)' }}
                data-testid="deliver-pr-unsaved"
              >
                Not stored by this daemon — applies to this session only.
              </p>
            )}
          </div>
        </SettingRow>

        {/* crew#549 — the identity the deliver phase pushes as. A LOGIN, never a token: the
            credential stays in the daemon's gh keyring or its GH_TOKEN, and the daemon serves this
            login and no secret. The phase refuses before it stages anything when gh's active
            login, or the credential git would use for the remote, differs from this one. */}
        <SettingRow
          label="Deliver identity (GitHub login)"
          description="The account the deliver phase must push as. Before anything is staged, the phase checks gh's active login AND the credential git would use for the remote's host, and refuses — naming both — if either disagrees. Empty = the daemon's GH_ACCOUNT environment variable, and if that is unset too it pushes as whatever login gh holds. A login, never a token: the credential stays in gh's keyring or GH_TOKEN."
        >
          <div className="flex w-56 flex-col items-end gap-1">
            <input
              type="text"
              aria-label="Deliver identity (GitHub login)"
              placeholder="not pinned"
              data-testid="deliver-identity"
              value={deliverIdentity}
              onChange={(e) => {
                setDeliverIdentityError(null);
                patch('deliverIdentityLogin', e.target.value);
              }}
              className="w-56 rounded px-2 py-1 text-sm font-mono focus:outline-none"
              style={{
                background: 'var(--surface-rail)',
                border: `1px solid ${deliverIdentityInvalid || deliverIdentityError ? 'var(--status-fail-dim)' : 'var(--surface-raised)'}`,
                color: 'var(--ink-high)',
              }}
            />
            {deliverIdentityInvalid && (
              <p className="w-56 text-xs break-words" style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }} data-testid="deliver-identity-invalid">
                Must be empty or a GitHub login (letters, digits and single hyphens).
              </p>
            )}
            {deliverIdentityError !== null && (
              <p className="w-56 text-xs break-words" style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }} data-testid="deliver-identity-error">
                {deliverIdentityError}
              </p>
            )}
          </div>
        </SettingRow>
      </section>

      <section
        className="rounded-xl px-5 mb-6"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'var(--ink-dim)' }}
        >
          Code Graph
        </h2>

        <SettingRow
          label="Graph node limit"
          description="Maximum number of symbols returned by wicked-estate graph-view per repo. Higher values show more of the graph but take longer to render. Requires reopening the graph modal to take effect."
        >
          <input
            type="number"
            min={20}
            max={500}
            step={10}
            value={merged.graphNodeLimit}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) patch('graphNodeLimit', Math.max(20, Math.min(500, n)));
            }}
            className="w-24 rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none"
            style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </SettingRow>
      </section>

      <section
        className="rounded-xl px-5 mb-6"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'var(--ink-dim)' }}
        >
          Workers
        </h2>

        <SettingRow
          label="Worker config root"
          description="Base directory for the engine-owned worker CLI config homes (e.g. the claude worker home is <root>/claude). Empty = the engine default ~/.wicked-worker. Must be an absolute path; takes effect on the next worker spawn."
        >
          <div className="flex w-56 flex-col items-end gap-1">
            <input
              type="text"
              aria-label="Worker config root"
              placeholder="~/.wicked-worker"
              value={workerRoot}
              onChange={(e) => {
                setWorkerRootError(null);
                patch('worker_config_root', e.target.value);
              }}
              className="w-56 rounded px-2 py-1 text-sm font-mono focus:outline-none"
              style={{
                background: 'var(--surface-rail)',
                border: `1px solid ${workerRootInvalid || workerRootError ? 'var(--status-fail-dim)' : 'var(--surface-raised)'}`,
                color: 'var(--ink-high)',
              }}
            />
            {workerRootInvalid && (
              <p className="w-56 text-xs break-words" style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }} data-testid="worker-root-invalid">
                Must be empty or an absolute path.
              </p>
            )}
            {workerRootError && (
              <p className="w-56 text-xs break-words" style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }} data-testid="worker-root-error">
                {workerRootError}
              </p>
            )}
          </div>
        </SettingRow>
      </section>

      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={save}
          disabled={!hasDirty || saving}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
          style={hasDirty && !saving
            ? { background: 'var(--status-run)', color: 'var(--surface-base)' }
            : { background: 'var(--surface-raised)', color: 'var(--ink-dim)', cursor: 'not-allowed' }
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs font-medium" style={{ color: 'var(--status-run)' }}>Saved</span>}
      </div>

      {/* ── CLI seats & sign-in ───────────────────────────────────────────── */}
      <section
        className="rounded-xl px-5 mb-6"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'var(--ink-dim)' }}
        >
          CLI seats &amp; sign-in
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-dim)' }}>
          Checked CLIs are pre-selected when you open the launch form (takes effect on the next new
          session). The status shows whether each seat looks signed in; Sign in shows the one command
          that signs that CLI in (you run it in a terminal), and Log out has the daemon run that CLI's own logout so you can re-authenticate.
        </p>
        {roster.length === 0 ? (
          <p className="text-xs italic pb-4 font-mono" style={{ color: 'var(--ink-dim)' }}>Loading roster…</p>
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {roster.map((seat) => {
              // The free tier a `not_required` seat answers on (opencode: "OpenCode Zen …").
              // #1: it moves to a small line BELOW the row — like the other cards — instead of
              // standing in for the seat's sign-in action.
              const freeTier = typeof seat.free_tier === 'string' ? seat.free_tier : '';
              return (
                <div key={seat.key} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    {/* The label wraps ONLY the checkbox + name so the status/sign-in
                        controls on the row never toggle the default-CLI checkbox. */}
                    <label className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={defaultClis.has(seat.key)}
                        onChange={() => toggleDefaultCli(seat.key)}
                        className="w-3.5 h-3.5 shrink-0" style={{ accentColor: 'var(--accent)' }}
                      />
                      <span className="text-sm font-mono truncate" style={{ color: 'var(--ink-high)' }}>
                        {seat.display_name}
                      </span>
                    </label>
                    <span className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
                      {seat.key}
                    </span>
                    {(() => {
                      // F-E2E-040 = F-RC2-043: the seat's standing is read off the roster's `auth`
                      // (`seatStandingWord`, the same fold the health rail applies), not the legacy
                      // `signed_in` boolean alone — and when the seat's OWN stderr reported the failure
                      // (`auth_source: 'seat-stderr'`) the row says so and offers Re-authenticate.
                      const standing = seatStandingWord(seat);
                      const bag = seat as Record<string, unknown>;
                      const stderrFailed = bag['auth_source'] === 'seat-stderr';
                      const evidence = typeof bag['auth_evidence'] === 'string' ? (bag['auth_evidence'] as string) : '';
                      const word =
                        stderrFailed
                          ? `sign-in failed${evidence !== '' ? `: ${evidence}` : ''}`
                          : standing.kind === 'signed-in'
                            ? '✓ signed in'
                            : standing.kind === 'signed-out'
                              ? 'sign in needed'
                              : standing.kind === 'no-sign-in-needed'
                                // #1: the free-tier detail moves BELOW the row; the status word stays terse.
                                ? 'no sign-in needed'
                                : standing.kind === 'ineligible'
                                  ? standing.detail
                                  : standing.auth === 'unknown'
                                    ? 'auth unknown'
                                    : null; // nothing on the wire — say nothing, never a fabricated state
                      const color =
                        stderrFailed || standing.kind === 'signed-out' || standing.kind === 'ineligible'
                          ? 'var(--status-fail)'
                          : standing.kind === 'signed-in' || standing.kind === 'no-sign-in-needed'
                            ? 'var(--status-run)'
                            : 'var(--ink-dim)';
                      const hasLogin = seat.login_invocation !== undefined && seat.login_invocation !== '';
                      // #1: a `not_required` seat (opencode) now OFFERS its provider login like the
                      // others — the only seat we never offer it to is one already signed in.
                      const offerLogin = hasLogin && standing.kind !== 'signed-in';
                      // Log out runs the DAEMON's route (crew 0.8.9 `POST /seats/:cli/logout`, the engine
                      // roster's own `logout_invocation`) — offered where the roster names one and there
                      // is a session to end; a 404 (no logout for that seat) hides it.
                      const hasLogout = typeof seat.logout_invocation === 'string' && seat.logout_invocation.trim() !== '';
                      const offerLogout =
                        hasLogout && !noLogout.has(seat.key) &&
                        (standing.kind === 'signed-in' || standing.kind === 'no-sign-in-needed');
                      const verb = stderrFailed ? 'Re-authenticate' : 'Sign in';
                      return (
                        <>
                          {word !== null && (
                            <span
                              className="text-xs font-mono"
                              style={{ color }}
                              data-testid={`seat-signin-${seat.key}`}
                              data-auth={standing.auth ?? ''}
                              data-auth-source={stderrFailed ? 'seat-stderr' : ''}
                              title={standing.title ?? undefined}
                            >
                              {word}
                            </span>
                          )}
                          {offerLogin && (
                            <button
                              type="button"
                              onClick={() => setSignInSeat(seat)}
                              aria-label={`${verb} ${seat.display_name}`}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium shrink-0"
                              style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)', border: '1px solid var(--status-gate-dim)' }}
                            >
                              {verb}
                            </button>
                          )}
                          {offerLogout && (
                            <button
                              type="button"
                              data-testid={`seat-logout-${seat.key}`}
                              onClick={() => setLogoutSeat(seat)}
                              aria-label={`Log out ${seat.display_name}`}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium shrink-0"
                              style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
                            >
                              Log out
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {/* #1: the free-tier note — small, secondary, below the actions (aligned under the
                      seat name), so a `not_required` card matches the shape of the others. */}
                  {freeTier !== '' && (
                    <p
                      className="text-xs font-mono ml-[1.625rem]"
                      style={{ color: 'var(--ink-dim)' }}
                      data-testid={`seat-freetier-${seat.key}`}
                    >
                      {freeTier}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {roster.length > 0 && (
          <div
            className="flex items-center gap-3 pb-4 pt-2 border-t"
            style={{ borderColor: 'var(--surface-raised)' }}
          >
            <button
              type="button"
              onClick={saveDefaultClis}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Save CLI defaults
            </button>
            {clisSaved && <span className="text-xs font-medium" style={{ color: 'var(--status-run)' }}>Saved</span>}
          </div>
        )}
      </section>

      {/* ── Seat log-out terminal ──────────────────────────────────────────────
          crew#615: the daemon opens the PTY running the seat's own documented logout
          (`POST /seats/:cli/logout`) and answers its terminal id; Terminal drives it over
          the terminal WS like any other. Studio builds no command of its own. A 404 means
          the seat has no logout: the panel closes and that seat's button is hidden. */}
      {signInSeat !== null && (
        <SignInPanel seat={signInSeat} onClose={() => setSignInSeat(null)} onChecked={(r) => setRoster(r)} />
      )}
      {logoutSeat !== null && (
        <Modal
          title={`Log out — ${logoutSeat.display_name}`}
          onClose={() => setLogoutSeat(null)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }} data-testid="seat-logout-line">
              The daemon runs{' '}
              <code
                className="rounded px-1 py-0.5"
                style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)' }}
              >
                {showText(logoutSeat.logout_invocation ?? '')}
              </code>{' '}
              — complete any prompt below, then close this panel.
            </p>
            <Terminal
              key={logoutSeat.key}
              cwd="."
              open={(cols, rows) => api.seatLogout(logoutSeat.key, { cols, rows }).then((r) => ({ id: r.terminalId }))}
              onOpenError={(err) => {
                if (err instanceof ApiError && err.status === 404) {
                  const key = logoutSeat.key;
                  setNoLogout((s) => new Set([...s, key]));
                  setLogoutSeat(null);
                }
              }}
              concealHome={techDetails ? [] : homeDirsIn(logoutSeat.logout_invocation ?? '')}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
