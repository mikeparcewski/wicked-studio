import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { BaseSkillPosture, SystemSettings as Settings } from '../api/types.js';
import { getDiagnostics } from '../api/diagnostics.js';
import { readErrorKind } from '../api/errors.js';
import { SectionTitle } from './ui/PageFrame.js';
import { SETTINGS_THEME_PATH } from '../board/settingsTabs.js';
import { StateBanner, Skeleton } from './ui/StateBanner.js';
import { Switch } from './ui/Switch.js';
import { TechDetails } from './ui/TechDetails.js';
import { useComposerPrefsStore } from '../store/composerPrefs.js';
import { useViewPrefsStore } from '../store/viewPrefs.js';
import { NotificationSettings } from './NotificationSettings.js';
import { Segmented } from './ui/Segmented.js';
import { scrollBehavior } from './ui/motion.js';
import { QE_SETTING_ANCHOR } from '../board/qeRefusal.js';
import { useCapabilities } from '../store/capabilities.js';

/**
 * Client-side mirror of the daemon's worker_config_root rule (empty or absolute).
 * The daemon stays authoritative — this only pre-warns; a 400 still renders inline.
 */
function isAbsolutePathLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
}

/** The daemon's settings (`deliverIdentityLogin`, `councilSize` and `qeAcceptance` are all typed by api-types 0.120.0).
 *  `requirementsGraph` is api-types 0.159.0 (operator ruling 2026-10-31), read here ahead of the pin. */
type LocalSettings = Settings & {
  /** "Power mode for new jobs" (api-types 0.149.0, spelled here until studio's pin carries it): the default of a launch's
   *  `power`. ABSENT = on (the shipped default). */
  powerModeDefault?: boolean;
  requirementsGraph?: { minCoveragePct?: number };
};

/** The requirements graph's minimum coverage when the daemon has none set (crew and core default). */
const DEFAULT_MIN_COVERAGE_PCT = 80;

/** Mirror of the daemon's rule (a whole percentage 1..100); the daemon stays authoritative. */
function isMinCoveragePct(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 100;
}

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

interface SystemSettingsProps {
  navigate?: (path: string) => void;
}

export function SystemSettings({ navigate = (p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); } }: SystemSettingsProps): React.ReactElement {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const powerCap = useCapabilities((s) => s.powerMode);
  useEffect(() => { void useCapabilities.getState().load(); }, []);
  const [dirty, setDirty] = useState<Partial<LocalSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<unknown>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Daemon 400 from a save whose patch included worker_config_root — rendered inline at the field. */
  const [workerRootError, setWorkerRootError] = useState<string | null>(null);
  const [deliverIdentityError, setDeliverIdentityError] = useState<string | null>(null);

  // Runs (studio#123): `studio.composer` on the crew settings wire — the
  // `useNotifPrefsStore` pattern, self-saving, outside the `dirty` patch.
  const deliverPr = useComposerPrefsStore((s) => s.prefs.deliverPr);
  const startInChat = useComposerPrefsStore((s) => s.prefs.startInChat);
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
    api.getSettings()
      .then((res) => {
        setSettings(res.settings);
        // api-types 0.38.0 `SettingsResponse.path?` (crew 0.7.36); absent/empty on an older daemon.
        setSettingsPath(typeof res.path === 'string' && res.path !== '' ? res.path : null);
      })
      // EC33: the translated message, never `String(Error)`'s "Error: …" framing.
      .catch((e: unknown) => { setErrorSource((previous: unknown) => readErrorKind(previous) === 'offline' ? previous : e); setError(e instanceof Error ? e.message : String(e)); });
  }
  useEffect(() => { load(); }, []);

  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [minCoverageText, setMinCoverageText] = useState<string | null>(null);

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
      const res = await api.updateSettings(dirty as Partial<Settings>);
      const next = res.settings;
      // A daemon from before a setting drops it and names it in `ignored` (crew#323): say so at the
      // field instead of showing a value that was never stored.
      const ignored = (res as { ignored?: unknown }).ignored;
      setUnsupported(Array.isArray(ignored) ? ignored.filter((k): k is string => typeof k === 'string') : []);
      setSettings(next);
      setDirty({});
      setMinCoverageText(null);
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
  const minCoverage = merged.requirementsGraph?.minCoveragePct ?? DEFAULT_MIN_COVERAGE_PCT;
  // The field holds what is typed (it may be empty mid-edit); only a whole 1..100 reaches the patch.
  const minCoverageShown = minCoverageText ?? String(minCoverage);
  const minCoverageInvalid = minCoverageText !== null && !isMinCoveragePct(Number(minCoverageText));
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
    // The General tab of the Settings page (`SettingsPage`, studio-settings-tabs): its frame, title and
    // intro are the page's; this is the tab's content, unchanged.
    <div className="wk-pg-set-content">
      {error && <StateBanner kind={readErrorKind(errorSource ?? error)} what="system settings" error={error} onRetry={load} />}
      {settings === null && error === null && <Skeleton rows={3} variant="card" />}
      <TechDetails data-testid="settings-path" summary="Settings file" text={settingsPath ?? "Studio's service does not report its settings file location."} />

      {/* Theme section */}
      <section className="wk-card">
        <SectionTitle>Theme</SectionTitle>
        <p>Choose your workspace colors, logo, and branding.</p>
        <a href={SETTINGS_THEME_PATH} data-testid="theme-page-link" className="wk-link" onClick={(e) => { e.preventDefault(); navigate(SETTINGS_THEME_PATH); }}>Open Theme</a>
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
        <Switch label="Show New job" data-testid="show-new-job-toggle" checked={!startInChat}
          onChange={(checked) => updateComposerPrefs({ startInChat: !checked })}
          hint={startInChat ? 'Off: New job starts a chat. Picking a specific job (Learn, a demo video, /workflow-…) still opens it.' : 'New job opens the job picker.'} />
        {composerPersist === 'dropped' && <p className="wk-field-note" data-testid="show-new-job-unsaved">Not stored by Studio's service — applies to this session only.</p>}
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
        {/* DES-POWER-MODE §2: the default of the New job switch; each job's header has the same switch. */}
        {powerCap && (
          <Switch label={`Power mode for new jobs: ${merged.powerModeDefault !== false ? 'On' : 'Off'}`} data-testid="power-mode-default-toggle" checked={merged.powerModeDefault !== false}
            onChange={(checked) => patch('powerModeDefault', checked)}
            disabled={settings === null ? 'Reading this setting…' : null}
            hint={merged.powerModeDefault !== false
              ? 'One orchestrator builds the change with you in its conversation, re-checked at every commit; rigor applies once, at hand-off. Each job\u2019s header and the New job form have the same switch.'
              : 'Off: new jobs run phased, step by step, with a gate after each phase. Each job\u2019s header and the New job form can still turn it on.'} />
        )}
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
        {/* Operator ruling 2026-10-31: a repository's requirements graph is built, and shown with its
            coverage, once this share of its code is mapped. Studio's service exports it to the engine. */}
        <SettingRow label="Requirements graph minimum coverage"
          description="A repository's requirements graph is built once this share of its behaviours is mapped, and shows how much it covers. Below it, the job says how far it got and the next one continues.">
          <span className="flex items-center gap-1.5">
            <input type="number" className="wk-field" aria-label="Requirements graph minimum coverage" data-testid="settings-min-coverage"
              min={1} max={100} step={5} value={minCoverageShown}
              onChange={(e) => {
                const text = e.target.value;
                setMinCoverageText(text);
                const n = Number(text);
                if (text.trim() !== '' && isMinCoveragePct(n)) patch('requirementsGraph', { minCoveragePct: n });
              }} />
            <span aria-hidden="true">%</span>
          </span>
          {minCoverageInvalid && <p className="wk-field-note" data-testid="settings-min-coverage-invalid">A whole percentage from 1 to 100.</p>}
          {unsupported.includes('requirementsGraph') && <p className="wk-field-note" data-testid="settings-min-coverage-unsupported">
            Studio’s service doesn’t have this setting yet, so the minimum stays {DEFAULT_MIN_COVERAGE_PCT}%.
          </p>}
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
          <button type="button" onClick={save} disabled={!hasDirty || saving || settings === null || minCoverageInvalid} className="wk-btn wk-btn--primary">{saving ? 'Saving…' : 'Save'}</button>
          {saved && <span role="status">Saved</span>}
        </div>
        {(!hasDirty || saving || settings === null) && <p className="wk-field-note">{saving ? 'Wait for these changes to finish saving.' : settings === null ? 'Settings must load before changes can be saved.' : 'Change a setting before saving.'}</p>}
      </div>

      {/* Editor plugins moved to their own Plugins page (`/plugins`, operator ruling 2026-10-12). */}
    </div>
  );
}
