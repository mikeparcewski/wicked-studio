import { useState } from 'react';
import { listThemes, type LearnKind, type ThemeSummary } from '../api/interactive.js';
import {
  attachSourceFromThread, learnReady, learnThemeFromThread, LEARN_KINDS, LEARN_LABEL,
} from '../interactive/themeWire.js';
import { contextKey, useDocContextStore } from '../store/docContext.js';

// The composer's context row (DES-MERGE-001 §4.6, §4.9, §6.4 slice 16).
//
// Three actions and the chips they produce, in the footer beside the composer, because
// what they change is what the NEXT message generates:
//
//   Style   — teach the agent a theme from a website, a PDF or an image (§4.6). The
//             submission is a message (§2.3) and the learning narrates in the thread.
//   Theme   — the library (built-ins + everything learned). Picking one is a chip, and
//             the chip rides with the next generation as `theme_id`.
//   Sources — attach a folder or file the service reads IN PLACE (§4.9). The chip is a
//             path, never a payload: this component has no file input and builds no
//             FormData, so attaching context uploads nothing.
//
// The two thread actions require an open document, for the same reason the storyboard's
// Record button does: they render as messages, and a message needs a thread to land in.
// Picking a theme does not — it is context for a generation that has not started yet.

const S = {
  ink:    '#e6edf3',
  faint:  'rgba(230,237,243,0.35)',
  muted:  'rgba(230,237,243,0.55)',
  accent: '#ffda19',
  card:   '#1b222e',
  border: 'rgba(230,237,243,0.1)',
  danger: '#f85149',
};

const CHIP: React.CSSProperties = {
  background: 'rgba(255,218,25,0.1)', color: S.accent, border: '1px solid rgba(255,218,25,0.25)',
};
const ACTION: React.CSSProperties = {
  background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, cursor: 'pointer',
};
const FIELD: React.CSSProperties = {
  background: 'transparent', color: S.ink, border: `1px solid ${S.border}`,
  borderRadius: '8px', outline: 'none',
};
const SUBMIT: React.CSSProperties = {
  background: S.accent, color: '#0d1117', border: 'none', cursor: 'pointer',
};
const BOX: React.CSSProperties = { background: S.card, border: `1px solid ${S.border}` };
const PANEL = 'flex flex-col gap-1.5 rounded-xl px-2.5 py-2';
const PILL = 'rounded-full px-2.5 py-0.5 text-[10px] font-mono';
const INPUT = 'px-2 py-1 text-[11px] font-mono';
const GO = 'self-start rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40';
const NOTE = 'text-[10px] font-mono';

type Panel = 'learn' | 'library' | 'sources';

/** The three actions, in §4.6/§4.9's order. `needsDoc` marks the ones that render as
 *  MESSAGES: a message needs a transcript, so they wait for a document to exist. */
const ACTIONS: ReadonlyArray<{ panel: Panel; testId: string; label: string; title: string; needsDoc: boolean }> = [
  { panel: 'learn', testId: 'context-learn', label: 'learn a theme', needsDoc: true,
    title: 'Teach the agent a theme from a website, a PDF or an image' },
  { panel: 'library', testId: 'context-library', label: 'theme library', needsDoc: false,
    title: 'Pick a theme for the next generation' },
  { panel: 'sources', testId: 'context-sources', label: 'attach sources', needsDoc: true,
    title: 'Point at a folder or file the service reads in place — nothing uploads' },
];

/** One context chip: what is in effect, and the control that takes it back out. */
function Chip({
  kind, value, label, onRemove,
}: { kind: string; value: string; label: string; onRemove: () => void }): React.ReactElement {
  return (
    <span data-testid="context-chip" data-chip-kind={kind} data-chip-value={value}
          className={`flex items-center gap-1 max-w-full ${PILL}`} style={CHIP}>
      <span className="truncate">{label}</span>
      <button type="button" data-testid="context-chip-remove" aria-label={`Remove ${label}`}
              onClick={onRemove} className="shrink-0 leading-none"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
        ×
      </button>
    </span>
  );
}

export interface ComposerContextProps {
  projectId: string;
  /** `null` on the doc-less composer — the theme picker still works; the two thread
   *  actions do not, because there is no transcript for their message yet. */
  docId: string | null;
}

export function ComposerContext({ projectId, docId }: ComposerContextProps): React.ReactElement {
  const key = contextKey(projectId, docId);
  const theme = useDocContextStore((s) => s.theme[key]);
  const sources = useDocContextStore((s) => s.sources[key] ?? EMPTY);

  const [panel, setPanel] = useState<Panel | null>(null);
  const [kind, setKind] = useState<LearnKind>('url');
  const [value, setValue] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  function toggle(next: Panel): void {
    const opening = panel !== next;
    setPanel(opening ? next : null);
    if (!opening || next !== 'library') return;
    setLibraryError(null);
    listThemes(projectId)
      .then(setThemes)
      .catch((e: unknown) => setLibraryError(e instanceof Error ? e.message : String(e)));
  }

  async function submitLearn(): Promise<void> {
    if (docId === null || busy || !learnReady(kind, value)) return;
    setBusy(true);
    // Both outcomes are already IN the thread (informative, or actionable with the
    // service's own reason) — the panel's job is only to stop offering the same submit.
    const outcome = await learnThemeFromThread({ projectId, docId, kind, value });
    setBusy(false);
    if (outcome.ok) { setValue(''); setPanel(null); setThemes(null); }
  }

  async function submitSource(): Promise<void> {
    if (docId === null || busy || path.trim() === '') return;
    setBusy(true);
    const outcome = await attachSourceFromThread({ projectId, docId, path });
    setBusy(false);
    if (!outcome.ok) return;
    useDocContextStore.getState().addSource(key, outcome.entry.path);
    setPath(''); setPanel(null);
  }

  // §3.3: the library says what it is doing or why it cannot, and a library that failed
  // to load picks nothing rather than silently offering the default as if it were chosen.
  const status = libraryError !== null
    ? { testId: 'theme-library-error', danger: true,
        text: `${libraryError} — no theme was picked; the next generation uses the default.` }
    : themes === null
      ? { testId: 'theme-library-loading', danger: false, text: 'Loading the theme library…' }
      : themes.length === 0
        ? { testId: 'theme-library-empty', danger: false,
            text: 'No themes yet — learn one from a website, a PDF or an image.' }
        : null;

  return (
    <div data-testid="thread-context" className="flex flex-col gap-1.5">
      {(theme !== undefined || sources.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {theme !== undefined && (
            <Chip kind="theme" value={theme} label={`theme: ${theme}`}
                  onRemove={() => useDocContextStore.getState().pickTheme(key, null)} />
          )}
          {sources.map((p) => (
            <Chip key={p} kind="source" value={p} label={p}
                  onRemove={() => useDocContextStore.getState().removeSource(key, p)} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {ACTIONS.filter((a) => docId !== null || !a.needsDoc).map((a) => (
          <button key={a.panel} type="button" data-testid={a.testId} title={a.title}
                  aria-expanded={panel === a.panel} onClick={() => toggle(a.panel)}
                  className={PILL} style={ACTION}>
            {a.label}
          </button>
        ))}
      </div>

      {panel === 'learn' && docId !== null && (
        <div data-testid="learn-panel" className={PANEL} style={BOX}>
          <div className="flex gap-1.5">
            {LEARN_KINDS.map((k) => (
              <button key={k} type="button" data-testid="learn-kind" data-kind={k}
                      aria-pressed={kind === k} onClick={() => setKind(k)}
                      className="rounded-full px-2 py-0.5 text-[10px] font-mono"
                      style={kind === k ? CHIP : ACTION}>
                {k}
              </button>
            ))}
          </div>
          <input
            data-testid="learn-input" className={INPUT} style={FIELD}
            aria-label={`Theme source ${LEARN_LABEL[kind].noun}`}
            placeholder={LEARN_LABEL[kind].placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitLearn(); } }}
          />
          {/* §4.6 asks for this to be SAID in the UI, not only honoured on the wire. */}
          {kind !== 'url' && (
            <p data-testid="learn-no-upload" className={NOTE} style={{ color: S.faint, margin: 0 }}>
              Read in place — the file is not uploaded.
            </p>
          )}
          <button type="button" data-testid="learn-submit" className={GO} style={SUBMIT}
                  disabled={busy || !learnReady(kind, value)} onClick={() => void submitLearn()}>
            {busy ? 'Submitting…' : `Learn from this ${LEARN_LABEL[kind].noun}`}
          </button>
        </div>
      )}

      {panel === 'library' && (
        <div data-testid="theme-library" className={`${PANEL} gap-1 max-h-40 overflow-y-auto`} style={BOX}>
          {status !== null && (
            <p data-testid={status.testId} className={NOTE}
               style={{ color: status.danger ? S.danger : S.faint, margin: 0 }}>
              {status.text}
            </p>
          )}
          {(themes ?? []).map((t) => (
            <button
              key={t.name} type="button" data-testid="theme-row" data-theme={t.name}
              aria-pressed={theme === t.name}
              onClick={() => { useDocContextStore.getState().pickTheme(key, t.name); setPanel(null); }}
              className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-mono"
              style={{ background: theme === t.name ? 'rgba(255,218,25,0.1)' : 'transparent',
                       color: S.ink, border: 'none', cursor: 'pointer' }}
            >
              <span className="truncate">{t.name}</span>
              <span className="shrink-0 text-[10px]" style={{ color: S.faint }}>{t.source ?? 'built-in'}</span>
            </button>
          ))}
        </div>
      )}

      {panel === 'sources' && docId !== null && (
        <div data-testid="sources-panel" className={PANEL} style={BOX}>
          <input
            data-testid="source-input" className={INPUT} style={FIELD}
            aria-label="Reference folder or file path"
            placeholder="/path/to/reference-folder"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitSource(); } }}
          />
          <p data-testid="source-no-upload" className={NOTE} style={{ color: S.faint, margin: 0 }}>
            The service reads it where it is — nothing is uploaded from this page.
          </p>
          <button type="button" data-testid="source-attach" className={GO} style={SUBMIT}
                  disabled={busy || path.trim() === ''} onClick={() => void submitSource()}>
            {busy ? 'Attaching…' : 'Attach'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Stable identity for "no sources" so the selector never returns a fresh array. */
const EMPTY: string[] = [];
