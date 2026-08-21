import { useState } from 'react';
import { type LearnKind } from '../api/interactive.js';
import {
  attachSourceFromThread, learnReady, learnThemeFromThread, LEARN_KINDS, LEARN_LABEL,
} from '../interactive/themeWire.js';
import { contextKey, useDocContextStore } from '../store/docContext.js';

// The composer's context row (DES-MERGE-001 §4.6, §4.9, §6.4 slice 16; narrowed by
// DES-UXFIX-001 §2.6 rule 4 / V19, slice 6).
//
// Two actions and the chips they produce, in the footer beside the composer, because
// what they change is what the NEXT message generates:
//
//   Learn   — teach the agent a theme from a website, a PDF or an image (§4.6). The
//             submission is a message (§2.3) and the learning narrates in the thread.
//   Sources — attach a folder or file the service reads IN PLACE (§4.9). The chip is a
//             path, never a payload: this component has no file input and builds no
//             FormData, so attaching context uploads nothing.
//
// PICKING a theme exists nowhere any more (issue #65): the "theme library" it picked
// from was an invented wire — the real bridge serves no theme registry and nothing
// consumed the `theme_id` that rode the next generation. The real capability is the
// Learn action below (and the strip's `ThemesMenu`, which offers the same form): the
// learned look sticks to THIS document server-side, so there is no pick to carry.
//
// Both actions require an open document, for the same reason the storyboard's
// Record button does: they render as messages, and a message needs a thread to land in.

const S = {
  ink:    'var(--ink-high)',
  faint:  'var(--ink-dim)',
  muted:  'var(--ink-muted)',
  accent: 'var(--accent)',
  card:   'var(--surface-card)',
  border: 'var(--surface-raised)',
  danger: 'var(--status-fail)',
};

const CHIP: React.CSSProperties = {
  background: 'var(--accent-subtle)', color: S.accent, border: '1px solid var(--accent-subtle)',
};
const ACTION: React.CSSProperties = {
  background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, cursor: 'pointer',
};
const FIELD: React.CSSProperties = {
  background: 'transparent', color: S.ink, border: `1px solid ${S.border}`,
  borderRadius: '8px', outline: 'none',
};
const SUBMIT: React.CSSProperties = {
  background: S.accent, color: 'var(--accent-fg)', border: 'none', cursor: 'pointer',
};
const BOX: React.CSSProperties = { background: S.card, border: `1px solid ${S.border}` };
const PANEL = 'flex flex-col gap-1.5 rounded-xl px-2.5 py-2';
const PILL = 'rounded-full px-2.5 py-0.5 text-[10px] font-mono';
const INPUT = 'px-2 py-1 text-[11px] font-mono';
const GO = 'self-start rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40';
const NOTE = 'text-[10px] font-mono';

type Panel = 'learn' | 'sources';

/** The two actions, in §4.6/§4.9's order. Both render as MESSAGES: a message needs a
 *  transcript, so they wait for a document to exist. */
const ACTIONS: ReadonlyArray<{ panel: Panel; testId: string; label: string; title: string; needsDoc: boolean }> = [
  { panel: 'learn', testId: 'context-learn', label: 'learn a theme', needsDoc: true,
    title: 'Teach the agent a theme from a website, a PDF or an image' },
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
  /** `null` on the doc-less composer — neither thread action works there, because
   *  there is no transcript for their message yet. */
  docId: string | null;
}

export function ComposerContext({ projectId, docId }: ComposerContextProps): React.ReactElement {
  const key = contextKey(projectId, docId);
  const sources = useDocContextStore((s) => s.sources[key] ?? EMPTY);

  const [panel, setPanel] = useState<Panel | null>(null);
  const [kind, setKind] = useState<LearnKind>('url');
  const [value, setValue] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(next: Panel): void {
    setPanel(panel !== next ? next : null);
  }

  async function submitLearn(): Promise<void> {
    if (docId === null || busy || !learnReady(kind, value)) return;
    setBusy(true);
    // Both outcomes are already IN the thread (informative, or actionable with the
    // service's own reason) — the panel's job is only to stop offering the same submit.
    const outcome = await learnThemeFromThread({ projectId, docId, kind, value });
    setBusy(false);
    if (outcome.ok) { setValue(''); setPanel(null); }
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

  return (
    <div data-testid="thread-context" className="flex flex-col gap-1.5">
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((p) => (
            <Chip key={p} kind="source" value={p} label={p}
                  onRemove={() => useDocContextStore.getState().removeSource(key, p)} />
          ))}
        </div>
      )}

      {/* Both actions render as messages, so a doc-less composer offers neither — an
          empty action row is omitted, not rendered blank (DES-UXFIX-001 §2.1.2's rule,
          applied at this altitude). */}
      {docId !== null && (
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.filter((a) => !a.needsDoc || docId !== null).map((a) => (
            <button key={a.panel} type="button" data-testid={a.testId} title={a.title}
                    aria-expanded={panel === a.panel} onClick={() => toggle(a.panel)}
                    className={PILL} style={ACTION}>
              {a.label}
            </button>
          ))}
        </div>
      )}

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
