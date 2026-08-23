import { useEffect, useRef, useState } from 'react';
import { getLearnedTheme, type LearnKind } from '../api/interactive.js';
import {
  learnReady, learnThemeFromThread, LEARN_KINDS, LEARN_LABEL,
} from '../interactive/themeWire.js';
import { pollLearnedTheme } from '../theming/learnPoll.js';
import { threadKey, useDocThreadStore } from '../store/docThread.js';

// The Themes control (DES-UXFIX-001 §2.6 rule 4, V19), CORRECTED by issue #65,
// grown an honest lifecycle by DES-UX-001 §7.2 (B5, EC37).
//
// Slice 16 built this menu on an invented wire: `GET /api/themes` listed a "theme
// library" and picking a row rode a `theme_id` with the next generation. The real
// wicked-interactive bridge serves NO theme registry — what it CAN do is learn a look
// FOR THIS DOCUMENT: `wicked.interactive.theme.requested {document_id, url|path}`
// grabs the source, the agent reads its design, and every subsequent version of the
// document wears it (theme-source.js applies <doc>/theme/learned.theme.json).
//
// §7.2's repair: the brief's theme-learn "narrated 'Grabbing the page…' then hung
// 10+ minutes". The ack is an EventAck — fire-and-forget — so the popover used to
// close on submit and the user was left watching narration with no end. Now the
// popover ITSELF answers (EC37):
//   - IN-FLIGHT: `learn-inflight` renders in the popover, carrying the bridge's own
//     newest status line (staged progress — the announce stream, no new wires);
//   - DONE: the readback (`GET /d/:doc/api/theme/learned`, interactive#181) turning
//     200 is the one completion truth — the same bounded, cancellable poll the
//     /theme page rides (learnPoll.ts, hard-capped ~66s);
//   - FAILED: a failed learn emits exactly ONE doc-scoped `status.posted
//     {state:"error", message}` (verified at slice time against handlers.js
//     materializeThemeRequested — §8.4.1 probe 4's lifecycle finding), which the
//     thread index (`lastError`) surfaces here VERBATIM, with a retry;
//   - TIMEOUT: past the poll's hard cap with neither tokens nor an error frame, the
//     wait resolves to the honest copy — the bridge may still be working, it has
//     just said nothing — with a retry. Never an unresolved "Grabbing…" past it.

const S = {
  ink:    'var(--ink-high)',
  body:   'var(--ink-body)',
  faint:  'var(--ink-dim)',
  muted:  'var(--ink-muted)',
  accent: 'var(--accent)',
  picked: 'var(--accent-subtle)',
  card:   'var(--surface-raised)',
  border: 'var(--surface-raised)',
  fail:   'var(--status-fail)',
  done:   'var(--status-done)',
};

const BUTTON: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: 'var(--radius-sm)',
  color: S.muted, cursor: 'pointer', fontSize: 'var(--text-2xs)',
  fontFamily: 'var(--font-sans)', lineHeight: 1.6, padding: '1px 6px',
};

const KIND_ON: React.CSSProperties = {
  background: S.picked, color: S.accent, border: '1px solid var(--accent-subtle)',
};
const KIND_OFF: React.CSSProperties = {
  background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, cursor: 'pointer',
};

/** V19's one-line explanation, shown every time the menu opens — never tooltip-only. */
export const THEMES_EXPLAINER = 'Borrow a look from a site, PDF, or image.';

/** The real model, said where the user acts on it (§3.3: informative, in the UI). */
export const THEMES_STICKS = 'The learned look sticks to this document — every new version wears it.';

/** §7.2's honest timeout copy — shaped to the probe-4 truth: a FAILED learn reports
 *  itself (one doc-scoped error frame, rendered above verbatim), so a timeout means
 *  the bridge has simply said nothing yet — not that the learn is known dead. */
export const LEARN_TIMEOUT_COPY =
  'The learn did not report back — the bridge may still be working; retry, or check the thread for progress.';

export const LEARN_DONE_COPY = 'Learned — every new version of this document wears it.';

/** Where one learn is, popover-side. `error.timeout` picks the §7.2 timeout rendering
 *  (retry with the honest silence copy) over the bridge's own verbatim reason. */
type LearnPhase =
  | { kind: 'form' }
  | { kind: 'inflight' }
  | { kind: 'learned' }
  | { kind: 'error'; reason: string; timeout: boolean };

export interface ThemesMenuProps {
  projectId: string;
  docId: string;
}

export function ThemesMenu({ projectId, docId }: ThemesMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LearnKind>('url');
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<LearnPhase>({ kind: 'form' });
  // Where the thread stood when this learn fired — everything after it is THIS
  // learn's narration, which is what the in-flight line stages (§7.2).
  const baseRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []); // unmount ends any poll

  const key = threadKey(projectId, docId);
  // Staged progress = the bridge's own status frames, as the thread already folds
  // them (no new wires): the newest narration since this learn was fired.
  const thread = useDocThreadStore((s) => s.messages[key]);
  const stage = (thread ?? [])
    .slice(baseRef.current)
    .filter((m) => m.kind === 'narration')
    .at(-1)?.text ?? null;

  const busy = phase.kind === 'inflight';

  async function submit(): Promise<void> {
    if (busy || !learnReady(kind, value)) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const store = useDocThreadStore.getState();
    baseRef.current = (store.messages[key] ?? []).length;
    // The bridge reports a failed learn ASYNC as ONE doc-scoped status.posted
    // {state:"error"} (§8.4.1 probe 4, re-verified at slice time); snapshot the
    // newest error so only a NEW arrival ends this learn (identity comparison).
    const errorBaseline = store.lastError[key];
    setPhase({ kind: 'inflight' });
    // The readback answers 200 for a PREVIOUS learn too, so snapshot what is
    // already there: only a learned_at that MOVED counts as THIS learn landing.
    // A failed baseline read is not a failed learn — the poll retries anyway.
    const before = await getLearnedTheme(projectId, docId).catch(() => null);
    if (ctl.signal.aborted) return;
    const outcome = await learnThemeFromThread({ projectId, docId, kind, value });
    if (ctl.signal.aborted) return;
    if (!outcome.ok) {
      // The SYNC refusals (unknown doc, 403, the typed 503) — the thread already
      // carries the actionable line; the click site answers too (EC37).
      setPhase({ kind: 'error', reason: outcome.reason, timeout: false });
      return;
    }
    const polled = await pollLearnedTheme({
      fetchLearned: async () => {
        const r = await getLearnedTheme(projectId, docId);
        if (r === null) return null;
        return before !== null && r.learned_at === before.learned_at ? null : r;
      },
      bridgeError: () => {
        const current = useDocThreadStore.getState().lastError[key];
        return current !== undefined && current !== errorBaseline ? current.text : null;
      },
      signal: ctl.signal,
    });
    if (ctl.signal.aborted || polled.kind === 'cancelled') return;
    if (polled.kind === 'learned') { setPhase({ kind: 'learned' }); setValue(''); return; }
    if (polled.kind === 'bridge-error') {
      setPhase({ kind: 'error', reason: polled.reason, timeout: false });
      return;
    }
    setPhase({ kind: 'error', reason: LEARN_TIMEOUT_COPY, timeout: true });
  }

  /** Editing the source starts a fresh ask — a stale verdict must not sit beside it. */
  function edit(next: string): void {
    setValue(next);
    if (phase.kind === 'learned' || phase.kind === 'error') setPhase({ kind: 'form' });
  }

  return (
    <div style={{ alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
      <button
        type="button"
        data-testid="themes-open"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={`${THEMES_EXPLAINER} ${THEMES_STICKS}`}
        style={{ ...BUTTON, ...(busy ? { color: S.accent } : {}) }}
      >
        {/* The in-flight state survives a closed popover — the control still answers. */}
        {busy ? <span className="animate-pulse">Themes…</span> : 'Themes'}
      </button>

      {open && (
        <div
          data-testid="themes-panel"
          className="flex flex-col gap-1.5"
          style={{
            background: S.card, border: '1px solid var(--surface-overlay)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-overlay)',
            bottom: 'calc(100% + 6px)', padding: '8px 10px',
            position: 'absolute', right: 0, width: '260px', zIndex: 30,
          }}
        >
          {/* §5.5: the one-line explanation opens WITH the popover, in
              --font-sans --ink-body --text-sm — prose, never tooltip-only. */}
          <p
            data-testid="themes-explanation"
            style={{
              color: S.body, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)',
              lineHeight: 1.4, margin: 0,
            }}
          >
            {THEMES_EXPLAINER}
          </p>
          <div className="flex gap-1.5">
            {LEARN_KINDS.map((k) => (
              <button key={k} type="button" data-testid="themes-kind" data-kind={k}
                      aria-pressed={kind === k} disabled={busy}
                      onClick={() => { setKind(k); if (phase.kind !== 'inflight') setPhase({ kind: 'form' }); }}
                      className="rounded-full px-2 py-0.5 text-[10px] font-mono"
                      style={kind === k ? KIND_ON : KIND_OFF}>
                {k}
              </button>
            ))}
          </div>
          <input
            data-testid="themes-input"
            className="px-2 py-1 text-[11px] font-mono rounded-lg"
            style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.ink, outline: 'none' }}
            aria-label={`Theme source ${LEARN_LABEL[kind].noun}`}
            placeholder={LEARN_LABEL[kind].placeholder}
            value={value}
            disabled={busy}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          />
          {/* §4.6 asks for this to be SAID in the UI, not only honoured on the wire. */}
          {kind !== 'url' && (
            <p data-testid="themes-no-upload" className="text-[10px] font-mono"
               style={{ color: S.faint, margin: 0 }}>
              Read in place — the file is not uploaded.
            </p>
          )}
          <p data-testid="themes-sticks" className="text-[10px] font-mono"
             style={{ color: S.faint, margin: 0 }}>
            {THEMES_STICKS}
          </p>

          {/* §7.2 IN-FLIGHT: the popover answers while the bridge works — the line is
              the bridge's own newest status frame, never rotating filler (§3.2). */}
          {phase.kind === 'inflight' && (
            <div data-testid="learn-inflight" className="flex flex-col gap-0.5">
              <span className="animate-pulse text-[10px] font-mono" style={{ color: S.accent }}>
                Learning…
              </span>
              {stage !== null && (
                <span data-testid="learn-stage" className="text-[10px] font-mono"
                      style={{ color: S.muted }}>
                  {stage}
                </span>
              )}
            </div>
          )}

          {/* §7.2 DONE: the readback landed — the popover says so where the click was. */}
          {phase.kind === 'learned' && (
            <p data-testid="learn-done" className="text-[10px] font-mono"
               style={{ color: S.done, margin: 0 }}>
              {LEARN_DONE_COPY}
            </p>
          )}

          {/* §7.2 FAILED / TIMEOUT: the bridge's own sentence verbatim, or the honest
              silence copy — either way with the retry beside it (§3.3: never a dead end). */}
          {phase.kind === 'error' && (
            <div data-testid={phase.timeout ? 'learn-timeout' : 'learn-error'}
                 className="flex flex-col gap-1">
              <p className="text-[10px] font-mono" style={{ color: S.fail, margin: 0 }}>
                {phase.reason}
              </p>
              <button
                type="button"
                data-testid="learn-retry"
                className="self-start rounded-lg px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'transparent', color: S.accent,
                         border: '1px solid var(--accent-subtle)', cursor: 'pointer' }}
                onClick={() => void submit()}
              >
                Retry
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="themes-submit"
            className="self-start rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: S.accent, color: 'var(--accent-fg)', border: 'none', cursor: 'pointer' }}
            disabled={busy || !learnReady(kind, value)}
            onClick={() => void submit()}
          >
            {busy ? 'Learning…' : `Learn from this ${LEARN_LABEL[kind].noun}`}
          </button>
        </div>
      )}
    </div>
  );
}
