import { seatStandingWord } from './HealthRailSection.js';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client.js';
import type { BaseSkillPosture, RosterSeat, SystemSettings as Settings } from '../api/types.js';
import { getDiagnostics } from '../api/diagnostics.js';
import { readErrorKind } from '../api/errors.js';
import { PageFrame, SectionTitle } from './ui/PageFrame.js';
import { StateBanner, Skeleton, EmptyState } from './ui/StateBanner.js';
import { Switch } from './ui/Switch.js';
import { OverflowMenu } from './ui/OverflowMenu.js';
import { TechDetails } from './ui/TechDetails.js';
import { seatLabel } from '../board/seatNames.js';
import { useComposerPrefsStore } from '../store/composerPrefs.js';
import { useViewPrefsStore } from '../store/viewPrefs.js';
import { setCachedRoster } from '../store/rosterCache.js';
import { Modal } from './Modal.js';
import { NotificationSettings } from './NotificationSettings.js';
import { Terminal } from './Terminal.js';
import { AgentModal } from './agents/AgentModal.js';
import { getCachedRoster } from '../store/rosterCache.js';
import { homeDirsIn } from '../board/homePath.js';
import { PAGE_NAMES } from '../board/pageNames.js';
import { Segmented } from './ui/Segmented.js';
import { scrollBehavior } from './ui/motion.js';
import { QE_SETTING_ANCHOR } from '../board/qeRefusal.js';

const CLI_DEFAULTS_KEY = 'wicked_default_clis';

/**
 * Client-side mirror of the daemon's worker_config_root rule (empty or absolute).
 * The daemon stays authoritative — this only pre-warns; a 400 still renders inline.
 */
function isAbsolutePathLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
}

/** The daemon's settings (`deliverIdentityLogin`, `councilSize` and `qeAcceptance` are all typed by api-types 0.120.0). */
type LocalSettings = Settings;

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
    <div className="wk-pg-set-row">
      <div className="min-w-0">
        <p className="wk-pg-set-label">{label}</p>
        <p className="wk-field-note">{description}</p>
      </div>
      <div className="wk-pg-set-control">{children}</div>
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
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [dirty, setDirty] = useState<Partial<LocalSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<unknown>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [rosterLoading, setRosterLoading] = useState(true);
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
  // A QE refusal's warning links here (`/system#qe-acceptance`): once the settings are read, the page
  // brings the switch into view, focuses it and rings it until focus leaves. Re-checked on every
  // in-app navigation, which arrives as popstate.
  const qeRef = useRef<HTMLDivElement | null>(null);
  const [qeTargeted, setQeTargeted] = useState(false);
  const [addressTick, setAddressTick] = useState(0);
  useEffect(() => {
    const on = (): void => setAddressTick((n) => n + 1);
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, []);
  const settingsRead = settings !== null;
  useEffect(() => {
    if (!settingsRead || window.location.hash !== `#${QE_SETTING_ANCHOR}`) return;
    const timer = setTimeout(() => {
      const el = qeRef.current;
      if (el === null) return;
      el.scrollIntoView?.({ block: 'center', behavior: scrollBehavior() });
      // The switch takes focus; a disabled one (a service without the setting) cannot, so the row does.
      const sw = el.querySelector<HTMLButtonElement>('[role="switch"]');
      (sw !== null && !sw.disabled ? sw : el).focus({ preventScroll: true });
      setQeTargeted(true);
    }, 100);
    return () => clearTimeout(timer);
  }, [settingsRead, addressTick]);
  function load(): void {
    setError(null);
    setErrorSource(null);
    setRosterLoading(true);
    api.getSettings()
      .then((res) => {
        setSettings(res.settings);
        // api-types 0.38.0 `SettingsResponse.path?` (crew 0.7.36); absent/empty on an older daemon.
        setSettingsPath(typeof res.path === 'string' && res.path !== '' ? res.path : null);
      })
      // EC33: the translated message, never `String(Error)`'s "Error: …" framing.
      .catch((e: unknown) => { setErrorSource((previous: unknown) => readErrorKind(previous) === 'offline' ? previous : e); setError(e instanceof Error ? e.message : String(e)); });
    api.getRoster()
      .then(({ roster: seats }) => {
        // Deposit for Chat's default chips (DES-FEEDBACK-001 §6.1).
        setCachedRoster(seats);
        setRoster(seats);
        setDefaultClis(loadDefaultClis(seats));
      })
      .catch((e: unknown) => { setErrorSource((previous: unknown) => readErrorKind(previous) === 'offline' ? previous : e); setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => setRosterLoading(false));
  }
  useEffect(() => { load(); }, []);

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
      else { setErrorSource(e); setError(msg); }
    } finally {
      setSaving(false);
    }
  }

  const merged: LocalSettings = { graphNodeLimit: 150, ...settings, ...dirty };
  const councilSizeOptions = ['1', '2', '3', '4', '5'];
  if (settings?.councilSize !== undefined && !councilSizeOptions.includes(String(settings.councilSize))) {
    councilSizeOptions.push(String(settings.councilSize));
  }
  const hasDirty = Object.keys(dirty).length > 0;
  const workerRoot = merged.worker_config_root ?? '';
  const workerRootInvalid = workerRoot !== '' && !isAbsolutePathLike(workerRoot);
  const deliverIdentity = merged.deliverIdentityLogin ?? '';
  const deliverIdentityInvalid = deliverIdentity !== '' && !isGitHubLoginLike(deliverIdentity.trim());

  return (
    <PageFrame title={PAGE_NAMES.system} intro="Choose how Studio displays your work and uses your helpers.">
      <div className="wk-pg-set-content">
      {error && <StateBanner kind={readErrorKind(errorSource ?? error)} what="system settings" error={error} onRetry={load} />}
      {settings === null && error === null && <Skeleton rows={3} variant="card" />}
      <TechDetails data-testid="settings-path" summary="Settings file" text={settingsPath ?? "Studio's service does not report its settings file location."} />

      {/* Theme section */}
      <section className="wk-card">
        <SectionTitle>Theme</SectionTitle>
        <p>Choose your workspace colors, logo, and branding.</p>
        <a href="/theme" data-testid="theme-page-link" className="wk-link" onClick={(e) => { e.preventDefault(); navigate('/theme'); }}>Open Theme</a>
      </section>

      {/* Notification section: owned by NotificationSettings. */}
      <NotificationSettings />

      {/* View section */}
      <section data-testid="view-settings" className="wk-card">
        <SectionTitle>View</SectionTitle>
        <Switch label="Show technical details" data-testid="tech-details-toggle" checked={techDetails}
          onChange={(checked) => updateViewPrefs({ technical_details: checked })}
          hint="Shows full file locations in technical details and additional references beside your work." />
        {viewPersist === 'dropped' && <p className="wk-field-note" data-testid="tech-details-unsaved">Not stored by Studio's service — applies to this session only.</p>}
      </section>

      {/* Work section */}
      <section data-testid="runs-settings" className="wk-card">
        <SectionTitle>Work</SectionTitle>
        {/* studio#724: plain words; the skill's identifier is Technical details. */}
        <SettingRow label="Helper guidance" description="The shared guidance helpers follow at each step.">
          <div data-testid="system-base-skill" data-present={baseSkill == null ? '' : String(baseSkill.present)}>
            {baseSkill === undefined ? "Not reported by Studio's service"
              : baseSkill === null ? 'Off'
              : baseSkill.present ? 'On — every helper is given it'
              : `Missing — ${baseSkill.policy === 'require' ? 'work cannot start without it' : 'work can continue without it'}`}
            {baseSkill != null && !baseSkill.present && <p data-testid="system-base-skill-fix" className="wk-field-note">
              {baseSkill.inCatalog ? 'Publish the skills again to make it available.' : 'Add the skill and publish it.'}
            </p>}
            {baseSkill != null && <TechDetails text={JSON.stringify(baseSkill, null, 2)} />}
          </div>
        </SettingRow>
        {/* api-types 0.120.0: off = studio's service skips QE acceptance for every job that would wait
            for it, and labels each one; a daemon before the setting sends no key and keeps it required. */}
        <div id={QE_SETTING_ANCHOR} ref={qeRef} tabIndex={-1} data-testid="qe-acceptance-setting" data-targeted={qeTargeted ? 'true' : 'false'} className="wk-setting-target"
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setQeTargeted(false); }}>
        <Switch label="Require QE acceptance before delivery" data-testid="qe-acceptance-toggle" checked={merged.qeAcceptance !== 'off'}
          onChange={(checked) => patch('qeAcceptance', checked ? 'required' : 'off')}
          disabled={settings === null ? 'Reading this setting…'
            : settings.qeAcceptance === undefined ? 'Studio’s service doesn’t have this setting yet, so QE acceptance stays required.' : null}
          hint={merged.qeAcceptance === 'off'
            ? 'Off: jobs that change the application deliver without waiting for a QE check. Each job, its gates and its delivery say it was skipped. A job already started keeps the setting it started with.'
            : 'Jobs that change the application wait for a QE acceptance pass before they deliver.'} />
        </div>
        <Switch label="Open a PR when a build run finishes" data-testid="deliver-pr-toggle" checked={deliverPr}
          onChange={(checked) => updateComposerPrefs({ deliverPr: checked })}
          hint="Push the finished branch and open a pull request when a workflow and repository are selected; you decide when to merge." />
        {composerPersist === 'dropped' && <p className="wk-field-note" data-testid="deliver-pr-unsaved">Not stored by Studio's service — applies to this session only.</p>}
        <SettingRow label="Deliver identity (GitHub login)" description="The GitHub account used to push finished work. Leave blank to use the service's account.">
          <input type="text" className="wk-field" aria-label="Deliver identity (GitHub login)" placeholder="GitHub username"
            data-testid="deliver-identity" value={deliverIdentity}
            onChange={(e) => { setDeliverIdentityError(null); patch('deliverIdentityLogin', e.target.value); }} />
          {deliverIdentityInvalid && <p className="wk-field-note" data-testid="deliver-identity-invalid">Must be empty or a GitHub login (letters, digits and single hyphens).</p>}
          {deliverIdentityError !== null && <div data-testid="deliver-identity-error"><p className="wk-field-note">Studio could not save this account. Check it and try again.</p><TechDetails text={deliverIdentityError} /></div>}
        </SettingRow>
      </section>

      {/* Code graph section */}
      <section className="wk-card">
        <SectionTitle>Code graph</SectionTitle>
        <SettingRow label="Graph node limit" description="The most symbols shown in a repository's code graph. Reopen the graph after changing this.">
          <input type="number" className="wk-field" aria-label="Graph node limit" min={20} max={500} step={10} value={merged.graphNodeLimit}
            onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) patch('graphNodeLimit', Math.max(20, Math.min(500, n))); }} />
        </SettingRow>
      </section>

      {/* w9-council (UI-CONTRACT §6): the Council size setting — its label, hint, control and save are that lane's. */}
      <section className="wk-card">
        <SectionTitle>Reviews</SectionTitle>
        <SettingRow label="Council size" description="How many helpers review each decision; they are picked at random.">
          <Segmented
            label="Council size"
            data-testid="settings-council-size"
            value={String(merged.councilSize ?? 3)}
            options={councilSizeOptions.map((value) => ({ value, label: value }))}
            onChange={(value) => patch('councilSize', Number(value))}
          />
        </SettingRow>
      </section>

      {/* Helper configuration section */}
      <section className="wk-card">
        <SectionTitle>Helper configuration</SectionTitle>
        <SettingRow label="Worker config root" description="The folder for helper configuration. Leave blank to use the default; changes apply when the next helper starts.">
          <input type="text" className="wk-field" aria-label="Worker config root" placeholder="~/.wicked-worker" value={workerRoot}
            onChange={(e) => { setWorkerRootError(null); patch('worker_config_root', e.target.value); }} />
          {workerRootInvalid && <p className="wk-field-note" data-testid="worker-root-invalid">Must be empty or an absolute path.</p>}
          {workerRootError && <div data-testid="worker-root-error"><p className="wk-field-note">Studio could not save this location. Check it and try again.</p><TechDetails text={workerRootError} /></div>}
        </SettingRow>
      </section>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={!hasDirty || saving || settings === null} className="wk-btn wk-btn--primary">{saving ? 'Saving…' : 'Save'}</button>
          {saved && <span role="status">Saved</span>}
        </div>
        {(!hasDirty || saving || settings === null) && <p className="wk-field-note">{saving ? 'Wait for these changes to finish saving.' : settings === null ? 'Settings must load before changes can be saved.' : 'Change a setting before saving.'}</p>}
      </div>

      {/* Helpers and sign-in section */}
      <section className="wk-card">
        <SectionTitle>Helpers and sign-in</SectionTitle>
        <p className="wk-field-note">Choose the helpers selected for new work and manage their sign-in.</p>
        {rosterLoading ? <Skeleton rows={3} /> : roster.length === 0 ? <EmptyState title="No helpers are available." body="Refresh this page after adding a helper." /> : roster.map((seat) => {
          const standing = seatStandingWord(seat);
          const bag = seat as Record<string, unknown>;
          const stderrFailed = bag['auth_source'] === 'seat-stderr';
          const evidence = typeof bag['auth_evidence'] === 'string' ? bag['auth_evidence'] : '';
          const word = stderrFailed ? 'sign-in failed' : standing.kind === 'signed-in' ? '✓ signed in'
            : standing.kind === 'signed-out' ? 'sign in needed' : standing.kind === 'no-sign-in-needed' ? 'no sign-in needed'
            : standing.kind === 'ineligible' ? 'Unavailable for new work' : standing.auth === 'unknown' ? 'Sign-in unknown' : null;
          const offerLogin = seat.login_invocation !== undefined && seat.login_invocation !== '' && standing.kind !== 'signed-in';
          const offerLogout = typeof seat.logout_invocation === 'string' && seat.logout_invocation.trim() !== '' && !noLogout.has(seat.key)
            && (standing.kind === 'signed-in' || standing.kind === 'no-sign-in-needed');
          const verb = stderrFailed ? 'Re-authenticate' : 'Sign in';
          const name = seatLabel(seat).replace(/\s*\(judge\)/ig, '');
          return <div key={seat.key} className="wk-list-row wk-pg-set-helper">
            <div className="wk-list-row-title"><Switch label={name} checked={defaultClis.has(seat.key)} onChange={() => toggleDefaultCli(seat.key)} /></div>
            <div className="wk-list-row-meta">
              {word !== null && <span data-testid={`seat-signin-${seat.key}`} data-auth={standing.auth ?? ''} data-auth-source={stderrFailed ? 'seat-stderr' : ''}>{word}</span>}
              {typeof seat.free_tier === 'string' && seat.free_tier !== '' && <p data-testid={`seat-freetier-${seat.key}`} className="wk-field-note">{seat.free_tier}</p>}
              <TechDetails text={[seat.key, evidence, standing.title ?? '', standing.kind === 'ineligible' ? standing.detail : '']} />
            </div>
            <div className="wk-list-row-actions">
              {offerLogin && offerLogout ? <OverflowMenu label={`More actions for ${name}`} data-testid={`seat-logout-${seat.key}`} items={[
                { id: 'signin', label: `${verb} ${name}`, onSelect: () => setSignInSeat(seat) },
                { id: 'logout', label: `Log out ${name}`, onSelect: () => setLogoutSeat(seat) },
              ]} /> : <>
                {offerLogin && <button type="button" className="wk-btn wk-btn--secondary" aria-label={`${verb} ${name}`} onClick={() => setSignInSeat(seat)}>{verb}</button>}
                {offerLogout && <button type="button" className="wk-btn wk-btn--secondary" data-testid={`seat-logout-${seat.key}`} aria-label={`Log out ${name}`} onClick={() => setLogoutSeat(seat)}>Log out</button>}
              </>}

            </div>
          </div>;
        })}
        {roster.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={saveDefaultClis} className="wk-btn wk-btn--primary">Save CLI defaults</button>
          {clisSaved && <span role="status">Saved</span>}
        </div>}
      </section>

      {/* Editor plugins moved to their own Plugins page (`/plugins`, operator ruling 2026-10-12). */}
      </div>
      {signInSeat !== null && <AgentModal agentKey={signInSeat.key} intent="sign-in" onClose={() => { const r = getCachedRoster(); if (r !== null) setRoster(r); setSignInSeat(null); }} />}
      {logoutSeat !== null && <Modal title={`Log out — ${seatLabel(logoutSeat)}`} onClose={() => setLogoutSeat(null)}>
        <p data-testid="seat-logout-line">Complete any prompt below, then close this panel.</p>
        <TechDetails text={logoutSeat.logout_invocation ?? ''} />
        <Terminal key={logoutSeat.key} cwd="." open={(cols, rows) => api.seatLogout(logoutSeat.key, { cols, rows }).then((r) => ({ id: r.terminalId }))}
          onOpenError={(err) => { if (err instanceof ApiError && err.status === 404) { const key = logoutSeat.key; setNoLogout((s) => new Set([...s, key])); setLogoutSeat(null); } }}
          concealHome={techDetails ? [] : homeDirsIn(logoutSeat.logout_invocation ?? '')} />
      </Modal>}
    </PageFrame>
  );
}
