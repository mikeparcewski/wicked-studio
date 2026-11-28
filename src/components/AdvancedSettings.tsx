import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, SystemSettings as Settings } from '../api/types.js';
import { apiStatus, readErrorKind } from '../api/errors.js';
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
/** A lowercase host name, or `*.` + one, at most 253 characters (crew env-settings.ts `HOST`, `seatEgressHosts`). */
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const hostOk = (h: string): boolean => h.length <= 253 && HOST.test(h);
const HOSTS_MAX = 100;
/** One trailer line, "Token: value", no control characters (crew deliver-text.ts `TRAILER_LINE`, env-settings.ts). */
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S.*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const trailerOk = (t: string): boolean => t.length <= 200 && !CONTROL.test(t) && TRAILER.test(t);
const TRAILERS_MAX = 10;
/** crew env-settings.ts `HOST_NAME` and deliver-text.ts `isLoopbackHost`: the origin a person elsewhere can open. */
const HOST_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
function isPublicOrigin(v: string): boolean {
  let url: URL;
  try { url = new URL(v); } catch { return false; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== v || !HOST_NAME.test(url.hostname)) return false;
  const h = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return !(h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::' || h === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h));
}
/** A sent value and the daemon's answer agree (an empty list or map is the same as none). */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => {
    if (v === undefined || v === null) return 'null';
    if (Array.isArray(v) && v.length === 0) return 'null';
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) return 'null';
    return JSON.stringify(v);
  };
  return norm(a) === norm(b);
}

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
  const id = useId();
  return (
    <div className="wk-pg-set-row" data-testid={testId} data-pinned={pin !== undefined ? 'true' : 'false'}>
      <div className="min-w-0">
        <p className="wk-pg-set-label" id={`${id}-l`}>{label}</p>
        <p className="wk-field-note" id={`${id}-d`}>{description}</p>
        <p className="wk-field-note" id={`${id}-v`}>Default: {def}</p>
      </div>
      {/* The control's group carries the row's name, sentence and default for a screen reader (round 1). */}
      <div className="wk-pg-set-control" role="group" aria-labelledby={`${id}-l`} aria-describedby={`${id}-d ${id}-v${pin !== undefined ? ` ${id}-p` : ''}`}>
        {children}
        {pin !== undefined ? (
          <p className="wk-field-note" id={`${id}-p`} data-testid={`${testId}-pinned`}>
            Set by this computer&apos;s environment ({pin.env.join(', ')}), so it can&apos;t be changed here: {pin.value}
          </p>
        ) : onDefault !== undefined ? (
          <button type="button" className="wk-link wk-adv-default" data-testid={`${testId}-default`} aria-label={`Use default: ${label}`} onClick={onDefault}>Use default</button>
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
  /** The text is not a number in range: the row's change is withdrawn and Save waits. */
  onInvalid: () => void;
  testId: string;
}

/** A whole number in the row's unit; empty means the default. Only a value in range reaches the patch. */
function NumberField({ label, value, scale = 1, min, max, unit, disabled, onChange, onInvalid, testId }: NumberProps): React.ReactElement {
  const id = useId();
  // Seeded once: a save, a reload, a pin or "Use default" remounts the field (its key), so typing is
  // never overwritten mid-edit (round 1: an emptied older field snapped back to its default).
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value / scale));
  const [bad, setBad] = useState(false);
  return (
    <div>
      <div className="wk-adv-number">
        <input type="number" inputMode="numeric" className="wk-field" aria-label={label} data-testid={testId} min={min} max={max} step={1}
          value={text} disabled={disabled} placeholder={disabled ? '' : 'Default'}
          aria-invalid={bad} aria-describedby={`${id}-u${bad ? ` ${id}-e` : ''}`}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === '') { setBad(false); onChange(null); return; }
            const n = Number(t);
            const ok = Number.isInteger(n) && n >= min && n <= max;
            setBad(!ok);
            if (ok) onChange(n * scale);
            else onInvalid();
          }} />
        <span className="wk-field-note wk-adv-unit" id={`${id}-u`}>{unit}</span>
      </div>
      {bad && <p className="wk-field-note wk-field-note--bad" id={`${id}-e`} data-testid={`${testId}-invalid`}>Enter a whole number from {min} to {max}.</p>}
    </div>
  );
}

/** What a save that failed tells the person: a refusal changed nothing; anything else is unknown. */
interface SaveFailure { text: string; refused: boolean }

const pinsOf = (res: unknown): Pins => ((res as { environment?: Pins }).environment) ?? {};

export function AdvancedSettings(): React.ReactElement {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [pins, setPins] = useState<Pins>({});
  const [repos, setRepos] = useState<RepoEntry[] | null>(null);
  const [reposFailed, setReposFailed] = useState(false);
  const [dirty, setDirty] = useState<Partial<Record<Key, unknown>>>({});
  /** Rows whose text is not a value the daemon takes: their change is withdrawn and Save waits. */
  const [invalid, setInvalid] = useState<Partial<Record<Key, true>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<unknown>(null);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  /** Keys a 200 answer did not keep (a daemon older than these settings drops them). */
  const [notKept, setNotKept] = useState<string[]>([]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Free-text drafts (host list, trailers, sizes, origin): kept as typed, patched only when valid.
  const [drafts, setDrafts] = useState<Partial<Record<Key, string>>>({});
  /** Remount counters for the number fields: all of them (`*`) after a load or save, one after its "Use default". */
  const [gens, setGens] = useState<Record<string, number>>({});
  const bump = (k: string): void => setGens((g) => ({ ...g, [k]: (g[k] ?? 0) + 1 }));

  const omit = <T extends object>(o: T, keys: readonly string[]): T => {
    const n = { ...o } as Record<string, unknown>;
    for (const k of keys) delete n[k];
    return n as T;
  };
  /** New pins: a pinned row can't be changed, so a pending change to it is dropped (round 1: a key pinned
   *  after the page loaded kept being resent and refused). */
  function takePins(next: Pins): void {
    const keys = Object.keys(next);
    setPins(next);
    setDirty((d) => omit(d, keys));
    setDrafts((d) => omit(d, keys));
    setInvalid((v) => omit(v, keys));
    bump('*');
  }

  function loadRepos(): void {
    setReposFailed(false);
    api.listRepos().then((r) => setRepos(r.repos)).catch(() => { setRepos(null); setReposFailed(true); });
  }
  function load(): void {
    setError(null);
    setErrorSource(null);
    api.getSettings()
      .then((res) => {
        setSettings(res.settings as LocalSettings);
        // api-types next `SettingsResponse.environment`; absent on an older daemon (no pins shown).
        setPins(pinsOf(res));
        setDrafts({});
        bump('*');
      })
      .catch((e: unknown) => { setErrorSource(e); setError(e instanceof Error ? e.message : String(e)); });
    loadRepos();
  }
  // Read once on mount; a retry calls load() itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  function touched(): void {
    setSaved(false);
    setSaveFailure(null);
    setNotKept([]);
  }
  function patch(key: Key, value: unknown): void {
    setDirty((d) => ({ ...d, [key]: value }));
    setInvalid((v) => omit(v, [key]));
    touched();
  }
  /** The row's text is not valid: withdraw its pending change so Save never sends an earlier keystroke. */
  function invalidate(key: Key): void {
    setDirty((d) => omit(d, [key]));
    setInvalid((v) => ({ ...v, [key]: true }));
    touched();
  }
  function draft(key: Key, text: string): void {
    setDrafts((d) => ({ ...d, [key]: text }));
  }

  async function save(): Promise<void> {
    // A pinned key is never sent: the daemon refuses it (409 env_pinned) and the whole save with it.
    const body = omit(dirty, Object.keys(pins)) as Record<string, unknown>;
    if (Object.keys(body).length === 0 || Object.keys(invalid).length > 0) return;
    setSaving(true);
    touched();
    try {
      // Keys api-types 0.216.0 does not carry yet ride the same PUT (no excess-property check on a variable).
      const res = await api.updateSettings(body as Partial<Settings>);
      const kept = res.settings as LocalSettings;
      setSettings(kept);
      setDirty({});
      setDrafts({});
      setInvalid({});
      bump('*');
      const dropped = Object.keys(body).filter((k) => !same(body[k], (kept as unknown as Record<string, unknown>)[k]));
      if (dropped.length > 0) {
        setNotKept(dropped);
      } else {
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2500);
      }
    } catch (e: unknown) {
      const status = apiStatus(e);
      // A 4xx is the daemon refusing: nothing was written. Anything else (no answer, a 5xx) is unknown.
      const refused = status !== null && status >= 400 && status < 500;
      setSaveFailure({ text: e instanceof Error ? e.message : String(e), refused });
      if (!refused) {
        // Read what the daemon has now; the pending changes stay for another try.
        api.getSettings().then((r) => setSettings(r.settings as LocalSettings)).catch(() => undefined);
      }
    } finally {
      setSaving(false);
      // A save can meet a pin set since the page loaded (the 409 names it): read the pins again either way.
      api.getSettings().then((r) => takePins(pinsOf(r))).catch(() => undefined);
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
  const genOf = (k: string): string => `${k}:${gens['*'] ?? 0}:${gens[k] ?? 0}`;
  /** "Use default" for a crew#2013 key: send null (the daemon deletes the variable). */
  const clear = (k: Key) => (has(k) ? () => { patch(k, null); setDrafts((d) => omit(d, [k])); bump(k); } : undefined);
  /** For an older key the daemon takes no null for: write its default value. */
  const reset = (k: Key, def: unknown) => (has(k) && merged[k] !== def ? () => { patch(k, def); bump(k); } : undefined);
  /** A pinned row shows the value in force (the environment's), not the one saved beside it (round 1). */
  const num = (k: Key, scale = 1): number | null | undefined => {
    const p = pin(k);
    if (p === undefined) return merged[k] as number | null | undefined;
    const n = Number(p.value);
    return Number.isFinite(n) && n % scale === 0 ? n : null;
  };
  const numRow = (k: Key, label: string, description: string, def: string, field: Omit<NumberProps, 'label' | 'value' | 'disabled' | 'onChange' | 'onInvalid' | 'testId'>, older?: number) => (
    <Row label={label} description={description} def={def} pin={pin(k)} testId={`adv-${k}`}
      onDefault={pin(k) !== undefined ? undefined : older !== undefined ? reset(k, older) : clear(k)}>
      <NumberField key={genOf(k)} label={label} value={num(k, field.scale)} disabled={pin(k) !== undefined} testId={`adv-${k}-input`} {...field}
        onChange={(v) => patch(k, v === null && older !== undefined ? older : v)} onInvalid={() => invalidate(k)} />
    </Row>
  );
  const sizeRow = (k: 'seatMemory' | 'floorMemory', label: string, description: string, def: string, minMb: number) => {
    const p = pin(k);
    const text = p !== undefined ? p.value : drafts[k] ?? merged[k] ?? '';
    const mb = text.trim() === '' ? null : sizeMb(text);
    const bad = p === undefined && text.trim() !== '' && (mb === null || mb < minMb || mb > 64 * 1024);
    return (
      <Row label={label} description={description} def={def} pin={p} testId={`adv-${k}`} onDefault={p !== undefined ? undefined : clear(k)}>
        <input type="text" className="wk-field" aria-label={label} data-testid={`adv-${k}-input`} placeholder={p !== undefined ? '' : 'Default'} value={text}
          disabled={p !== undefined} aria-invalid={bad}
          onChange={(e) => {
            const t = e.target.value;
            draft(k, t);
            const v = sizeMb(t);
            if (t.trim() === '') patch(k, null);
            else if (v !== null && v >= minMb && v <= 64 * 1024) patch(k, t.trim());
            else invalidate(k);
          }} />
        {bad && <p className="wk-field-note wk-field-note--bad" data-testid={`adv-${k}-invalid`}>Enter a size like 4g or 4096m, from {minMb / 1024}g to 64g.</p>}
      </Row>
    );
  };

  const network: NetworkMode = merged.seatNetwork ?? 'open';
  const hostsText = drafts.seatEgressHosts ?? (merged.seatEgressHosts ?? []).join('\n');
  const hostLines = lines(hostsText);
  const badHosts = hostLines.filter((h) => !hostOk(h));
  const networkPin = pin('seatNetwork');
  const trailersPin = pin('deliverTrailers');
  const trailersText = trailersPin !== undefined ? trailersPin.value : drafts.deliverTrailers ?? (merged.deliverTrailers ?? []).join('\n');
  const trailerLines = trailersPin !== undefined ? [] : lines(trailersText);
  const badTrailers = trailerLines.filter((t) => !trailerOk(t));
  const originPin = pin('publicOrigin');
  const originText = originPin !== undefined ? originPin.value : drafts.publicOrigin ?? merged.publicOrigin ?? '';
  const originBad = originPin === undefined && originText.trim() !== '' && !isPublicOrigin(originText.trim());
  const inheritPin = pin('inheritOperatorCliConfig');
  // The engine treats the variable being set at all as on (crew seat-signin.ts, core acp_runner.rs).
  const inheritOn = inheritPin !== undefined || merged.inheritOperatorCliConfig === true;
  const identities = merged.deliverIdentityByRepo ?? {};
  const hasDirty = Object.keys(omit(dirty, Object.keys(pins))).length > 0;
  const hasInvalid = Object.keys(invalid).length > 0;

  return (
    <div className="wk-pg-set-content wk-adv" data-testid="advanced-settings">
      {/* Nothing is editable while a save is in flight: an edit then would be cleared by its answer (round 1). */}
      <fieldset className="wk-adv-form" disabled={saving}>
      {/* Helper isolation */}
      <section className="wk-card" data-testid="adv-isolation">
        <SectionTitle>Helper isolation</SectionTitle>
        <div data-testid="adv-inheritOperatorCliConfig" data-pinned={inheritPin !== undefined ? 'true' : 'false'}>
          <Switch label="Use this computer's CLI settings in helpers" data-testid="adv-inheritOperatorCliConfig-toggle"
            checked={inheritOn}
            onChange={(checked) => patch('inheritOperatorCliConfig', checked ? true : null)}
            disabled={inheritPin !== undefined ? `On: set by this computer's environment (${inheritPin.env.join(', ')}), so it can't be changed here.` : null} />
          <p className={`wk-field-note wk-adv-warning${inheritOn ? ' wk-adv-warning--on' : ''}`} data-testid="adv-inherit-warning" role={inheritOn ? 'alert' : undefined}>
            {INHERIT_WARNING}
          </p>
          <p className="wk-field-note">Default: Off. Applies when the next helper starts.</p>
        </div>
      </section>

      {/* Stalled helpers (crew-side settings; their own clamps). The watchdog reads them on every sweep. */}
      <section className="wk-card" data-testid="adv-stall">
        <SectionTitle>Stalled helpers</SectionTitle>
        <p className="wk-field-note" data-testid="adv-stall-note">These apply to jobs already running, from the next check.</p>
        {numRow('workerStallMinutes', 'Quiet before a stall is reported', 'How long a running job can go without any word from its helper before Studio says it has stalled.', '15 minutes', { min: 1, max: 1440, unit: 'minutes' }, 15)}
        {numRow('workerStallEscalateMinutes', 'Quiet before Studio acts', 'How long a helper can go without any word, counted from its last word, before Studio acts on it. Never before the stall is reported. 0 turns this off.', '30 minutes', { min: 0, max: 1440, unit: 'minutes' }, 30)}
        <Row label="What Studio does" description="Hand the step to another helper, or only tell you." def="Reassign" testId="adv-workerStallEscalateAction"
          onDefault={reset('workerStallEscalateAction', 'reassign')}>
          <Segmented label="What Studio does" data-testid="adv-workerStallEscalateAction-input" value={merged.workerStallEscalateAction ?? 'reassign'}
            options={[{ value: 'reassign', label: 'Reassign' }, { value: 'notify', label: 'Tell me' }]}
            onChange={(v) => patch('workerStallEscalateAction', v)} />
        </Row>
        {numRow('workerStallMaxEscalations', 'Most reassigns per job', 'How many times one job may be handed to another helper.', '2', { min: 1, max: 10, unit: 'times' }, 2)}
        {numRow('workerSilentTurnMinutes', 'Silent turn limit', 'A helper turn with no output at all since it started is treated as stalled after this long, and Studio acts on it as set above. 0 turns this off.', '8 minutes', { min: 0, max: 1440, unit: 'minutes' }, 8)}
      </section>

      {/* Time limits */}
      <section className="wk-card" data-testid="adv-time">
        <SectionTitle>Time limits</SectionTitle>
        {numRow('unitTimeoutSecs', 'Longest helper turn', 'How long one helper turn may run before it is stopped. Applies from the next turn.', '2 hours', { min: 5, max: 1440, unit: 'minutes', scale: 60 })}
        {numRow('askTimeoutSecs', 'Wait for an answer to a question', 'How long a helper waits for you to answer a question it asked.', '600 seconds (10 minutes)', { min: 10, max: 3600, unit: 'seconds' })}
        {numRow('chatTurnSecs', 'Longest chat answer', 'How long a chat answer may run. Applies from the next message.', '600 seconds (10 minutes)', { min: 60, max: 3600, unit: 'seconds' })}
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

      {/* Network. "None" is the daemon's empty allowlist (gateway only); WICKED_SEAT_NETWORK stays env-only. */}
      <section className="wk-card" data-testid="adv-network">
        <SectionTitle>Network</SectionTitle>
        <Row label="Helper internet access" description="What helpers can reach besides the model service. Every choice only narrows the default."
          def="Open" pin={networkPin} testId="adv-seatNetwork" onDefault={networkPin !== undefined ? undefined : clear('seatNetwork')}>
          {networkPin === undefined ? (
            <Segmented label="Helper internet access" data-testid="adv-seatNetwork-input" value={network}
              options={[{ value: 'open', label: 'Open' }, { value: 'allowlist', label: 'Only these sites' }, { value: 'none', label: 'None' }]}
              onChange={(v) => {
                patch('seatNetwork', v === 'open' ? null : v);
                // Leaving "Only these sites" withdraws a host list that was being typed.
                if (v !== 'allowlist') setInvalid((x) => omit(x, ['seatEgressHosts']));
              }} />
          ) : null}
          {network === 'none' && networkPin === undefined && <p className="wk-field-note" data-testid="adv-network-none-note">Helpers reach only the model service.</p>}
        </Row>
        {network === 'allowlist' && networkPin === undefined && (
          <Row label="Allowed sites" description="One host per line. *.example.com allows every name under it. An empty list reaches nothing." def="None" testId="adv-seatEgressHosts">
            <textarea className="wk-field" aria-label="Allowed sites" data-testid="adv-seatEgressHosts-input" rows={4} value={hostsText} placeholder={'index.crates.io\n*.npmjs.org'}
              aria-invalid={badHosts.length > 0 || hostLines.length > HOSTS_MAX}
              onChange={(e) => {
                draft('seatEgressHosts', e.target.value);
                const list = lines(e.target.value);
                if (list.length <= HOSTS_MAX && list.every(hostOk)) patch('seatEgressHosts', list);
                else invalidate('seatEgressHosts');
              }} />
            {badHosts.length > 0 && <p className="wk-field-note wk-field-note--bad" data-testid="adv-seatEgressHosts-invalid">Not a host name: {badHosts.join(', ')}</p>}
            {hostLines.length > HOSTS_MAX && <p className="wk-field-note wk-field-note--bad" data-testid="adv-seatEgressHosts-toomany">At most {HOSTS_MAX} sites; this list has {hostLines.length}.</p>}
          </Row>
        )}
      </section>

      {/* Delivery */}
      <section className="wk-card" data-testid="adv-delivery">
        <SectionTitle>Delivery</SectionTitle>
        <Row label="Commit trailers" description="Lines added to the end of every delivered commit message, one per line, like Co-Authored-By: Name <address>." def="None"
          pin={trailersPin} testId="adv-deliverTrailers" onDefault={trailersPin !== undefined ? undefined : clear('deliverTrailers')}>
          <textarea className="wk-field" aria-label="Commit trailers" data-testid="adv-deliverTrailers-input" rows={3} value={trailersText} disabled={trailersPin !== undefined}
            aria-invalid={badTrailers.length > 0 || trailerLines.length > TRAILERS_MAX}
            onChange={(e) => {
              draft('deliverTrailers', e.target.value);
              const list = lines(e.target.value);
              if (list.length === 0) patch('deliverTrailers', null);
              else if (list.length <= TRAILERS_MAX && list.every(trailerOk)) patch('deliverTrailers', list);
              else invalidate('deliverTrailers');
            }} />
          {badTrailers.length > 0 && <p className="wk-field-note wk-field-note--bad" data-testid="adv-deliverTrailers-invalid">Each line must read Token: value, the token starting with a letter.</p>}
          {trailerLines.length > TRAILERS_MAX && <p className="wk-field-note wk-field-note--bad" data-testid="adv-deliverTrailers-toomany">At most {TRAILERS_MAX} lines; this has {trailerLines.length}.</p>}
        </Row>
        <Row label="Public Studio address" description="The address pull requests link their job to. Leave empty for no link." def="No link"
          pin={originPin} testId="adv-publicOrigin" onDefault={originPin !== undefined ? undefined : clear('publicOrigin')}>
          <input type="url" className="wk-field" aria-label="Public Studio address" data-testid="adv-publicOrigin-input" placeholder="https://studio.example.com" value={originText}
            disabled={originPin !== undefined} aria-invalid={originBad}
            onChange={(e) => {
              const t = e.target.value.trim();
              draft('publicOrigin', e.target.value);
              if (t === '') patch('publicOrigin', null);
              else if (isPublicOrigin(t)) patch('publicOrigin', t);
              else invalidate('publicOrigin');
            }} />
          {originBad && <p className="wk-field-note wk-field-note--bad" data-testid="adv-publicOrigin-invalid">Enter an address others can open, like https://studio.example.com, with no path (not localhost).</p>}
        </Row>
        <div className="wk-pg-set-row" data-testid="adv-deliverAuthorNoreply">
          <Switch label="Require GitHub noreply commit emails" data-testid="adv-deliverAuthorNoreply-toggle" checked={merged.deliverAuthorNoreply === true}
            onChange={(checked) => patch('deliverAuthorNoreply', checked)}
            hint="Default: Off. When on, a GitHub delivery stops before it is staged unless both commit emails are the push account's noreply address." />
        </div>
        <div data-testid="adv-identities">
          <p className="wk-pg-set-label">Push account per repository</p>
          <p className="wk-field-note">The GitHub account each repository&apos;s deliveries push as. Leave a row empty to use the account on the General tab.</p>
          {reposFailed ? (
            <div data-testid="adv-identities-failed">
              <p className="wk-field-note wk-field-note--bad">Studio could not load the repositories, so their push accounts are not shown.</p>
              <button type="button" className="wk-link wk-adv-default" onClick={loadRepos}>Try again</button>
            </div>
          ) : repos === null ? <Skeleton rows={1} /> : repos.length === 0 ? <p className="wk-field-note">No repositories are registered.</p> : repos.map((r) => (
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
              onChange={(v) => patch('runLearnings', v === 'distill' ? null : v)} />
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
      </fieldset>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={!hasDirty || hasInvalid || saving} className="wk-btn wk-btn--primary" data-testid="adv-save">{saving ? 'Saving…' : 'Save'}</button>
          {saved && <span role="status">Saved</span>}
        </div>
        {saveFailure !== null && (
          <div data-testid="adv-save-error" role="alert">
            <p className="wk-field-note wk-field-note--bad">
              {saveFailure.refused
                ? 'Studio could not save these settings. Nothing was changed.'
                : 'Studio could not confirm the save. Your changes are still here: save again, or reload the page to see what the daemon has.'}
            </p>
            <TechDetails text={saveFailure.text} />
          </div>
        )}
        {notKept.length > 0 && (
          <div data-testid="adv-not-kept" role="alert">
            <p className="wk-field-note wk-field-note--bad">The daemon did not keep {notKept.length === 1 ? 'one of these settings' : `${notKept.length} of these settings`}. It may be older than this Studio: update wicked-crew to change them here.</p>
            <TechDetails text={notKept.join(', ')} />
          </div>
        )}
        {hasInvalid && !saving && <p className="wk-field-note" data-testid="adv-save-blocked">Fix the settings marked above before saving.</p>}
        {(!hasDirty || saving) && !hasInvalid && saveFailure === null && notKept.length === 0 && <p className="wk-field-note">{saving ? 'Wait for these changes to finish saving.' : 'Change a setting before saving.'}</p>}
      </div>
    </div>
  );
}
