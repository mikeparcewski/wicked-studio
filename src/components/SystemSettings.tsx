import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RosterSeat, SystemSettings as Settings } from '../api/types.js';

const CLI_DEFAULTS_KEY = 'wicked_default_clis';

interface SettingRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps): React.ReactElement {
  return (
    <div
      className="flex items-start justify-between gap-6 py-4 border-b last:border-b-0"
      style={{ borderColor: 'rgba(230,237,243,0.07)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: '#e6edf3' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(230,237,243,0.45)' }}>{description}</p>
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

export function SystemSettings(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState<Partial<Settings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [defaultClis, setDefaultClis] = useState<Set<string>>(new Set());
  const [clisSaved, setClisSaved] = useState(false);
  const clisSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getSettings()
      .then(({ settings: s }) => setSettings(s))
      .catch((e: unknown) => setError(String(e)));
    api.getRoster()
      .then(({ roster: seats }) => {
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

  function patch<K extends keyof Settings>(key: K, value: Settings[K]): void {
    setDirty((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const { settings: next } = await api.updateSettings(dirty);
      setSettings(next);
      setDirty({});
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const merged: Settings = { graphNodeLimit: 150, ...settings, ...dirty };
  const hasDirty = Object.keys(dirty).length > 0;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold" style={{ color: '#e6edf3' }}>System</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(230,237,243,0.45)' }}>
          Runtime tunables persisted to{' '}
          <code
            className="font-mono text-xs rounded px-1 py-0.5"
            style={{ background: 'rgba(230,237,243,0.06)', color: 'rgba(230,237,243,0.7)' }}
          >
            ~/.config/wicked-core/settings.json
          </code>.
        </p>
      </div>

      {error && (
        <div
          className="mb-4 px-3 py-2 rounded text-xs"
          style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149' }}
        >
          {error}
        </div>
      )}

      <section
        className="rounded-xl px-5 mb-6"
        style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'rgba(230,237,243,0.4)' }}
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
            style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.12)', color: '#e6edf3' }}
          />
        </SettingRow>
      </section>

      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={save}
          disabled={!hasDirty || saving}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
          style={hasDirty && !saving
            ? { background: '#3fb950', color: '#0d1117' }
            : { background: 'rgba(230,237,243,0.06)', color: 'rgba(230,237,243,0.35)', cursor: 'not-allowed' }
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs font-medium" style={{ color: '#3fb950' }}>Saved</span>}
      </div>

      {/* ── CLIs section ──────────────────────────────────────────────────── */}
      <section
        className="rounded-xl px-5 mb-6"
        style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
          style={{ color: 'rgba(230,237,243,0.4)' }}
        >
          Default CLIs
        </h2>
        <p className="text-xs mb-4" style={{ color: 'rgba(230,237,243,0.4)' }}>
          Which CLIs are pre-selected when you open the launch form. Changes take effect on the next new session.
        </p>
        {roster.length === 0 ? (
          <p className="text-xs italic pb-4 font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>Loading roster…</p>
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {roster.map((seat) => (
              <label key={seat.key} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={defaultClis.has(seat.key)}
                  onChange={() => toggleDefaultCli(seat.key)}
                  className="accent-[#ffda19] w-3.5 h-3.5 shrink-0"
                />
                <span className="text-sm font-mono flex-1" style={{ color: '#e6edf3' }}>
                  {seat.display_name}
                </span>
                <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
                  {seat.key}
                </span>
              </label>
            ))}
          </div>
        )}
        {roster.length > 0 && (
          <div
            className="flex items-center gap-3 pb-4 pt-2 border-t"
            style={{ borderColor: 'rgba(230,237,243,0.07)' }}
          >
            <button
              type="button"
              onClick={saveDefaultClis}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: '#ffda19', color: '#0d1117' }}
            >
              Save CLI defaults
            </button>
            {clisSaved && <span className="text-xs font-medium" style={{ color: '#3fb950' }}>Saved</span>}
          </div>
        )}
      </section>
    </div>
  );
}
