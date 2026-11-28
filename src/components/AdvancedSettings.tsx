import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, SystemSettings as Settings } from '../api/types.js';
import { readErrorKind } from '../api/errors.js';
import { SectionTitle } from './ui/PageFrame.js';
import { Segmented } from './ui/Segmented.js';
import { Skeleton, StateBanner } from './ui/StateBanner.js';
import { Switch } from './ui/Switch.js';
import { TechDetails } from './ui/TechDetails.js';

/**
 * SETTINGS → ADVANCED (crew#2013, DES-2013 §5): the settings that used to be environment variables
 * only, plus the crew-side settings the General tab never showed. Same pieces and the same dirty
 * patch + Save as the General tab. Each row: a label, one plain sentence, its default, the control
 * with its unit. A row the host environment pins (`GET /settings.environment`) is read-only and says
 * so; "Use default" clears the key (`null`).
 */

/** The crew#2013 keys (api-types `next`; spelled here until studio's pin carries them, the
 *  `LocalSettings` precedent in SystemSettings.tsx). `null` in a PUT clears a key. */
type NetworkMode = 'open' | 'allowlist' | 'none';
type LearningsMode = 'off' | 'extract' | 'distill';
interface AdvancedWire {
  inheritOperatorCliConfig?: boolean | null;
  unitTimeoutSecs?: number | null;
  askTimeoutSecs?: number | null;
  deliverChecksTimeoutSecs?: number | null;
  deliverChecksPollSecs?: number | null;
  chatTurnSecs?: number | null;
  seatMemory?: string | null;
  floorMemory?: string | null;
  checkCacheRepoCapGb?: number | null;
  checkCacheTotalCapGb?: number | null;
  floorMinFreeGb?: number | null;
  completedWorktreeKeepDays?: number | null;
  seatNetwork?: NetworkMode | null;
  seatEgressHosts?: string[] | null;
  deliverTrailers?: string[] | null;
  publicOrigin?: string | null;
  runLearnings?: LearningsMode | null;
  /** (crew#1471, api-types after studio's pin) GitHub deliveries require noreply commit emails. */
  deliverAuthorNoreply?: boolean;
}
type LocalSettings = Settings & AdvancedWire;
type Key = keyof LocalSettings;
/** A pinned key as `GET /settings.environment` reports it (api-types `EnvSettingPin`). */
interface EnvPin { env: string[]; value: string }
type Pins = Partial<Record<string, EnvPin>>;

const INHERIT_WARNING =
  "When on, helpers use this computer's own CLI settings, MCP servers and signed-in accounts instead of their own separate copies. Turn it on only to test your own hooks or skills.";

/** `<n>g` / `<n>m`, the daemon's own size rule (env-settings.ts `size`). */
function sizeMb(v: string): number | null {
  const m = /^([1-9][0-9]{0,5})([mg])$/.exec(v.trim());
  return m === null ? null : Number(m[1]) * (m[2] === 'g' ? 1024 : 1);
}
/** A lowercase host name, or `*.` + one (env-settings.ts `HOST`). */
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** One trailer line, "Token: value" (deliver-text.ts `TRAILER_LINE`, approximated; the daemon decides). */
const TRAILER = /^[A-Za-z0-9][A-Za-z0-9-]*: \S.*$/;

const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '');

interface RowProps {
  label: string;
  description: string;
  /** The default, as a person reads it ("2 hours", "Off"). */
  def: string;
  pin?: EnvPin | undefined;
  /** "Use default" — absent when the row is already at its default. */
  onDefault?: (() => void) | undefined;
  testId: string;
  children: React.ReactNode;
}

/** One setting: label, one sentence, its default, the control; a pinned row says where its value comes from. */
function Row({ label, description, def, pin, onDefault, testId, children }: RowProps): React.ReactElement {
  return (
    <div className="wk-pg-set-row" data-testid={testId} data-pinned={pin !== undefined ? 'true' : 'false'}>
      <div className="min-w-0">
        <p className="wk-pg-set-label">{label}</p>
        <p className="wk-field-note">{description}</p>
        <p className="wk-field-note">Default: {def}</p>
      </div>
      <div className="wk-pg-set-control">
        {children}
        {pin !== undefined ? (
          <p className="wk-field-note" data-testid={`${testId}-pinned`}>
            Set by this computer&apos;s environment ({pin.env.join(', ')}), so it can&apos;t be changed here: {pin.value}
          </p>
        ) : onDefault !== undefined ? (
          <button type="button" className="wk-link wk-adv-default" data-testid={`${testId}-default`} onClick={onDefault}>Use default</button>
        ) : null}
      </div>
    </div>
  );
}

interface NumberProps {
  label: string;
  /** The saved value in the wire unit (seconds, ms, GB…), or null/undefined for the default. */
  value: number | null | undefined;
  /** Wire value per UI unit (60 for minutes over seconds). */
  scale?: number;
  min: number;
  max: number;
  unit: string;
  disabled: boolean;
  onChange: (wire: number | null) => void;
  testId: string;
}

/** A whole number in the row's unit; empty means the default. Only a value in range reaches the patch. */
function NumberField({ label, value, scale = 1, min, max, unit, disabled, onChange, testId }: NumberProps): React.ReactElement {
  const shown = value === null || value === undefined ? '' : String(value / scale);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  // A save, a reload or "Use default" replaces the value from outside.
  useEffect(() => { setText(shown); setBad(false); }, [shown]);
  return (
    <div>
      <div className="wk-adv-number">
        <input type="number" inputMode="numeric" className="wk-field" aria-label={label} data-testid={testId} min={min} max={max} step={1}
          value={text} disabled={disabled} placeholder={disabled ? '' : 'Default'}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === '') { setBad(false); onChange(null); return; }
            const n = Number(t);
            const ok = Number.isInteger(n) && n >= min && n <= max;
            setBad(!ok);
            if (ok) onChange(n * scale);
          }} />
        <span className="wk-field-note wk-adv-unit">{unit}</span>
      </div>
      {bad && <p className="wk-field-note wk-field-note--bad" data-testid={`${testId}-invalid`}>Enter a whole number from {min} to {max}.</p>}
    </div>
  );
}

export function AdvancedSettings(): React.ReactElement {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [pins, setPins] = useState<Pins>({});
  const [repos, setRepos] = useState<RepoEntry[] | null>(null);
  const [dirty, setDirty] = useState<Partial<Record<Key, unknown>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Free-text drafts (host list, trailers, sizes, origin): kept as typed, patched only when valid.
  const [drafts, setDrafts] = useState<Partial<Record<Key, string>>>({});

  function load(): void {
    setError(null);
    setErrorSource(null);
    api.getSettings()
      .then((res) => {
        setSettings(res.settings as LocalSettings);
        // api-types next `SettingsResponse.environment`; absent on an older daemon (no pins shown).
        setPins(((res as { environment?: Pins }).environment) ?? {});
        setDrafts({});
      })
      .catch((e: unknown) => { setErrorSource(e); setError(e instanceof Error ? e.message : String(e)); });
    api.listRepos().then((r) => setRepos(r.repos)).catch(() => setRepos([]));
  }
  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  function patch(key: Key, value: unknown): void {
    setDirty((d) => ({ ...d, [key]: value }));
    setSaved(false);
    setSaveError(null);
  }
  function draft(key: Key, text: string): void {
    setDrafts((d) => ({ ...d, [key]: text }));
  }

  async function save(): Promise<void> {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Keys api-types 0.216.0 does not carry yet ride the same PUT (no excess-property check on a variable).
      const body = dirty as Partial<Settings>;
      const res = await api.updateSettings(body);
      setSettings(res.settings as LocalSettings);
      setDirty({});
      setDrafts({});
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      // A save can meet a pin set since the page loaded: read the pins again.
      api.getSettings().then((r) => setPins(((r as { environment?: Pins }).environment) ?? {})).catch(() => undefined);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (settings === null) {
    return (
      <div className="wk-pg-set-content wk-adv" data-testid="advanced-settings">
        {error !== null ? <StateBanner kind={readErrorKind(errorSource ?? error)} what="advanced settings" error={error} onRetry={load} /> : <Skeleton rows={4} variant="card" />}
      </div>
    );
  }

  const merged = { ...settings, ...dirty } as LocalSettings;
  const has = (k: Key): boolean => merged[k] !== undefined && merged[k] !== null;
  const pin = (k: string): EnvPin | undefined => pins[k];
  /** "Use default" for a crew#2013 key: send null (the daemon deletes the variable). */
  const clear = (k: Key) => (has(k) ? () => { patch(k, null); setDrafts((d) => { const n = { ...d }; delete n[k]; return n; }); } : undefined);
  /** For an older key the daemon takes no null for: write its default value. */
  const reset = (k: Key, def: unknown) => (has(k) && merged[k] !== def ? () => patch(k, def) : undefined);
  const num = (k: Key): number | null | undefined => merged[k] as number | null | undefined;
  const numRow = (k: Key, label: string, description: string, def: string, field: Omit<NumberProps, 'label' | 'value' | 'disabled' | 'onChange' | 'testId'>, older?: number) => (
    <Row label={label} description={description} def={def} pin={pin(k)} testId={`adv-${k}`}
      onDefault={pin(k) !== undefined ? undefined : older !== undefined ? reset(k, older) : clear(k)}>
      <NumberField label={label} value={num(k)} disabled={pin(k) !== undefined} testId={`adv-${k}-input`} {...field}
        onChange={(v) => patch(k, v === null && older !== undefined ? older : v)} />
    </Row>
  );
  const sizeRow = (k: 'seatMemory' | 'floorMemory', label: string, description: string, def: string, minMb: number) => {
    const text = drafts[k] ?? merged[k] ?? '';
    const mb = text === '' ? null : sizeMb(text);
    const bad = text !== '' && (mb === null || mb < minMb || mb > 64 * 1024);
    return (
      <Row label={label} description={description} def={def} pin={pin(k)} testId={`adv-${k}`} onDefault={pin(k) !== undefined ? undefined : clear(k)}>
        <input type="text" className="wk-field" aria-label={label} data-testid={`adv-${k}-input`} placeholder={pin(k) !== undefined ? '' : 'Default'} value={text}
          disabled={pin(k) !== undefined}
          onChange={(e) => {
            const t = e.target.value;
            draft(k, t);
            const v = sizeMb(t);
            if (t.trim() === '') patch(k, null);
            else if (v !== null && v >= minMb && v <= 64 * 1024) patch(k, t.trim());
          }} />
        {bad && <p className="wk-field-note wk-field-note--bad" data-testid={`adv-${k}-invalid`}>Enter a size like 4g or 4096m, from {minMb / 1024}g to 64g.</p>}
      </Row>
    );
  };

  const network: NetworkMode = merged.seatNetwork ?? 'open';
  const hostsText = drafts.seatEgressHosts ?? (merged.seatEgressHosts ?? []).join('\n');
  const badHosts = lines(hostsText).filter((h) => !HOST.test(h));
  const networkPin = pin('seatNetwork');
  const trailersText = drafts.deliverTrailers ?? (merged.deliverTrailers ?? []).join('\n');
  const badTrailers = lines(trailersText).filter((t) => !TRAILER.test(t) || t.length > 200);
  const originText = drafts.publicOrigin ?? merged.publicOrigin ?? '';
  const originBad = originText !== '' && !/^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(originText);
  const identities = merged.deliverIdentityByRepo ?? {};
  const hasDirty = Object.keys(dirty).length > 0;

  return (
    <div className="wk-pg-set-content wk-adv" data-testid="advanced-settings">
      {/* Helper isolation */}
      <section className="wk-card" data-testid="adv-isolation">
        <SectionTitle>Helper isolation</SectionTitle>
        <div data-testid="adv-inheritOperatorCliConfig" data-pinned={pin('inheritOperatorCliConfig') !== undefined ? 'true' : 'false'}>
          <Switch label="Use this computer's CLI settings in helpers" data-testid="adv-inheritOperatorCliConfig-toggle"
            checked={merged.inheritOperatorCliConfig === true}
            onChange={(checked) => patch('inheritOperatorCliConfig', checked ? true : null)}
            disabled={pin('inheritOperatorCliConfig') !== undefined ? `Set by this computer's environment (${pin('inheritOperatorCliConfig')!.env.join(', ')}), so it can't be changed here.` : null} />
          <p className={`wk-field-note wk-adv-warning${merged.inheritOperatorCliConfig === true ? ' wk-adv-warning--on' : ''}`} data-testid="adv-inherit-warning" role={merged.inheritOperatorCliConfig === true ? 'alert' : undefined}>
            {INHERIT_WARNING}
          </p>
          <p className="wk-field-note">Default: Off. Applies when the next helper starts.</p>
        </div>
      </section>

      {/* Stalled helpers (crew-side settings; their own clamps) */}
      <section className="wk-card" data-testid="adv-stall">
        <SectionTitle>Stalled helpers</SectionTitle>
        {numRow('workerStallMinutes', 'Quiet before a stall is reported', 'How long a running job can go without any word from its helper before Studio says it has stalled.', '15 minutes', { min: 1, max: 1440, unit: 'minutes' }, 15)}
        {numRow('workerStallEscalateMinutes', 'Quiet before Studio acts', 'How long a stalled helper is left before Studio acts on it. 0 turns this off.', '30 minutes', { min: 0, max: 1440, unit: 'minutes' }, 30)}
        <Row label="What Studio does" description="Hand the step to another helper, or only tell you." def="Reassign" testId="adv-workerStallEscalateAction"
          onDefault={reset('workerStallEscalateAction', 'reassign')}>
          <Segmented label="What Studio does" data-testid="adv-workerStallEscalateAction-input" value={merged.workerStallEscalateAction ?? 'reassign'}
            options={[{ value: 'reassign', label: 'Reassign' }, { value: 'notify', label: 'Tell me' }]}
            onChange={(v) => patch('workerStallEscalateAction', v)} />
        </Row>
        {numRow('workerStallMaxEscalations', 'Most reassigns per job', 'How many times one job may be handed to another helper.', '2', { min: 1, max: 10, unit: 'times' }, 2)}
        {numRow('workerSilentTurnMinutes', 'Quiet turn warning', 'How long one helper turn can run without output before it is flagged. 0 turns this off.', '8 minutes', { min: 0, max: 1440, unit: 'minutes' }, 8)}
      </section>

      {/* Time limits */}
      <section className="wk-card" data-testid="adv-time">
        <SectionTitle>Time limits</SectionTitle>
        {numRow('unitTimeoutSecs', 'Longest helper turn', 'How long one helper turn may run before it is stopped. Applies from the next turn.', '2 hours', { min: 5, max: 1440, unit: 'minutes', scale: 60 })}
        {numRow('askTimeoutSecs', 'Wait for an answer to a question', 'How long a helper waits for you to answer a question it asked.', '10 minutes', { min: 10, max: 3600, unit: 'seconds' })}
        {numRow('chatTurnSecs', 'Longest chat answer', 'How long a chat answer may run. Applies from the next message.', '10 minutes', { min: 60, max: 3600, unit: 'seconds' })}
      </section>

      {/* Resources and cleanup */}
      <section className="wk-card" data-testid="adv-resources">
        <SectionTitle>Resources and cleanup</SectionTitle>
        {sizeRow('seatMemory', 'Memory per helper', "The most memory one helper's container may use. A repository's own limit wins.", '3g', 1024)}
        {sizeRow('floorMemory', 'Memory for checks', 'The most memory a repository check run may use.', '6g', 2048)}
        {numRow('checkCacheRepoCapGb', 'Check cache per repository', 'Disk kept for one repository’s check caches.', '20 GB', { min: 1, max: 1000, unit: 'GB' })}
        {numRow('checkCacheTotalCapGb', 'Check cache in all', 'Disk kept for every repository’s check caches together.', '40 GB', { min: 1, max: 2000, unit: 'GB' })}
        {numRow('floorMinFreeGb', 'Free disk to keep', 'Checks do not start when less than this is free.', '15 GB', { min: 1, max: 500, unit: 'GB' })}
        {numRow('completedWorktreeKeepDays', 'Keep finished work folders', 'How long a finished job’s working folder is kept. 0 removes it when the job finishes.', '14 days', { min: 0, max: 365, unit: 'days' })}
      </section>

      {/* Network */}
      <section className="wk-card" data-testid="adv-network">
        <SectionTitle>Network</SectionTitle>
        <Row label="Helper internet access" description="What helpers can reach besides the model service. Every choice only narrows the default."
          def="Open" pin={networkPin} testId="adv-seatNetwork" onDefault={networkPin !== undefined ? undefined : clear('seatNetwork')}>
          {networkPin === undefined ? (
            <Segmented label="Helper internet access" data-testid="adv-seatNetwork-input" value={network}
              options={[{ value: 'open', label: 'Open' }, { value: 'allowlist', label: 'Only these sites' }, { value: 'none', label: 'None' }]}
              onChange={(v) => patch('seatNetwork', v === 'open' ? null : v)} />
          ) : null}
          {network === 'none' && networkPin === undefined && <p className="wk-field-note" data-testid="adv-network-none-note">Helpers reach only the model service.</p>}
        </Row>
        {network === 'allowlist' && networkPin === undefined && (
          <Row label="Allowed sites" description="One host per line. *.example.com allows every name under it. An empty list reaches nothing." def="None" testId="adv-seatEgressHosts">
            <textarea className="wk-field" aria-label="Allowed sites" data-testid="adv-seatEgressHosts-input" rows={4} value={hostsText} placeholder={'index.crates.io\n*.npmjs.org'}
              onChange={(e) => {
                draft('seatEgressHosts', e.target.value);
                const list = lines(e.target.value);
                if (list.length <= 100 && list.every((h) => HOST.test(h))) patch('seatEgressHosts', list);
              }} />
            {badHosts.length > 0 && <p className="wk-field-note wk-field-note--bad" data-testid="adv-seatEgressHosts-invalid">Not a host name: {badHosts.join(', ')}</p>}
          </Row>
        )}
      </section>

      {/* Delivery */}
      <section className="wk-card" data-testid="adv-delivery">
        <SectionTitle>Delivery</SectionTitle>
        <Row label="Commit trailers" description="Lines added to the end of every delivered commit message, one per line, like Co-Authored-By: Name <address>." def="None"
          pin={pin('deliverTrailers')} testId="adv-deliverTrailers" onDefault={pin('deliverTrailers') !== undefined ? undefined : clear('deliverTrailers')}>
          <textarea className="wk-field" aria-label="Commit trailers" data-testid="adv-deliverTrailers-input" rows={3} value={trailersText} disabled={pin('deliverTrailers') !== undefined}
            onChange={(e) => {
              draft('deliverTrailers', e.target.value);
              const list = lines(e.target.value);
              if (list.length === 0) patch('deliverTrailers', null);
              else if (list.length <= 10 && list.every((t) => TRAILER.test(t) && t.length <= 200)) patch('deliverTrailers', list);
            }} />
          {badTrailers.length > 0 && <p className="wk-field-note wk-field-note--bad" data-testid="adv-deliverTrailers-invalid">Each line must read Token: value.</p>}
        </Row>
        <Row label="Public Studio address" description="The address pull requests link their job to. Leave empty for no link." def="No link"
          pin={pin('publicOrigin')} testId="adv-publicOrigin" onDefault={pin('publicOrigin') !== undefined ? undefined : clear('publicOrigin')}>
          <input type="url" className="wk-field" aria-label="Public Studio address" data-testid="adv-publicOrigin-input" placeholder="https://studio.example.com" value={originText}
            disabled={pin('publicOrigin') !== undefined}
            onChange={(e) => {
              const t = e.target.value.trim();
              draft('publicOrigin', e.target.value);
              if (t === '') patch('publicOrigin', null);
              else if (/^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(t)) patch('publicOrigin', t);
            }} />
          {originBad && <p className="wk-field-note wk-field-note--bad" data-testid="adv-publicOrigin-invalid">Enter an address like https://studio.example.com, with no path.</p>}
        </Row>
        <div className="wk-pg-set-row" data-testid="adv-deliverAuthorNoreply">
          <Switch label="Require GitHub noreply commit emails" data-testid="adv-deliverAuthorNoreply-toggle" checked={merged.deliverAuthorNoreply === true}
            onChange={(checked) => patch('deliverAuthorNoreply', checked)}
            hint="Default: Off. When on, a GitHub delivery stops before it is staged unless both commit emails are the push account's noreply address." />
        </div>
        <div data-testid="adv-identities">
          <p className="wk-pg-set-label">Push account per repository</p>
          <p className="wk-field-note">The GitHub account each repository&apos;s deliveries push as. Leave a row empty to use the account on the General tab.</p>
          {repos === null ? <Skeleton rows={1} /> : repos.length === 0 ? <p className="wk-field-note">No repositories are registered.</p> : repos.map((r) => (
            <div key={r.id} className="wk-pg-set-row" data-testid={`adv-identity-${r.id}`}>
              <p className="wk-pg-set-label">{r.name}</p>
              <div className="wk-pg-set-control">
                <input type="text" className="wk-field" aria-label={`Push account for ${r.name}`} placeholder="GitHub username" value={identities[r.id] ?? ''}
                  onChange={(e) => {
                    const next = { ...identities };
                    const login = e.target.value.trim();
                    if (login === '') delete next[r.id];
                    else next[r.id] = login;
                    patch('deliverIdentityByRepo', next);
                  }} />
              </div>
            </div>
          ))}
        </div>
        {numRow('deliverChecksTimeoutSecs', 'Wait for pull request checks', "How long a delivery waits for the pull request's checks.", '45 minutes', { min: 1, max: 240, unit: 'minutes', scale: 60 })}
        {numRow('deliverChecksPollSecs', 'Check again every', 'How often a delivery looks at those checks again.', '20 seconds', { min: 5, max: 300, unit: 'seconds' })}
      </section>

      {/* Learning */}
      <section className="wk-card" data-testid="adv-learning">
        <SectionTitle>Learning</SectionTitle>
        <Row label="After-job learnings" description="What Studio keeps from a finished job for later work. Summarizing uses one helper per job." def="Collect and summarize"
          pin={pin('runLearnings')} testId="adv-runLearnings" onDefault={pin('runLearnings') !== undefined ? undefined : clear('runLearnings')}>
          {pin('runLearnings') === undefined && (
            <Segmented label="After-job learnings" data-testid="adv-runLearnings-input" value={merged.runLearnings ?? 'distill'}
              options={[{ value: 'off', label: 'Off' }, { value: 'extract', label: 'Collect' }, { value: 'distill', label: 'Collect and summarize' }]}
              onChange={(v) => patch('runLearnings', v)} />
          )}
        </Row>
        <div className="wk-pg-set-row" data-testid="adv-onboardingAutoCapture">
          <Switch label="Capture learnings after onboarding a repository" data-testid="adv-onboardingAutoCapture-toggle" checked={merged.onboardingAutoCapture !== false}
            onChange={(checked) => patch('onboardingAutoCapture', checked)}
            hint="Default: On. The proposals still wait for your approval." />
        </div>
      </section>

      {/* Councils */}
      <section className="wk-card" data-testid="adv-council">
        <SectionTitle>Councils</SectionTitle>
        {numRow('councilSpawnStaggerMs', 'Gap between council helpers starting', 'Spaces out the helpers of one council so they do not all start at once.', '3000 ms', { min: 0, max: 30_000, unit: 'ms' }, 3000)}
      </section>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={!hasDirty || saving} className="wk-btn wk-btn--primary" data-testid="adv-save">{saving ? 'Saving…' : 'Save'}</button>
          {saved && <span role="status">Saved</span>}
        </div>
        {saveError !== null && (
          <div data-testid="adv-save-error"><p className="wk-field-note wk-field-note--bad">Studio could not save these settings. Nothing was changed.</p><TechDetails text={saveError} /></div>
        )}
        {(!hasDirty || saving) && saveError === null && <p className="wk-field-note">{saving ? 'Wait for these changes to finish saving.' : 'Change a setting before saving.'}</p>}
      </div>
    </div>
  );
}
