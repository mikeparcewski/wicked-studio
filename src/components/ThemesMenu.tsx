import { useState } from 'react';
import { type LearnKind } from '../api/interactive.js';
import {
  learnReady, learnThemeFromThread, LEARN_KINDS, LEARN_LABEL,
} from '../interactive/themeWire.js';

// The Themes control (DES-UXFIX-001 §2.6 rule 4, V19), CORRECTED by issue #65.
//
// Slice 16 built this menu on an invented wire: `GET /api/themes` listed a "theme
// library" and picking a row rode a `theme_id` with the next generation. The real
// wicked-interactive bridge serves NO theme registry — no list route, no theme ids,
// and nothing that consumed `theme_id` (verified against src/service/server.js and
// the assist skill). What the bridge CAN do is learn a look FOR THIS DOCUMENT:
// `wicked.interactive.theme.requested {document_id, url|path}` grabs the source,
// the agent reads its design, and every subsequent version of the document wears it
// (theme-source.js applies <doc>/theme/learned.theme.json at each version creation).
//
// So the control keeps its V19 duties — it reads "Themes", sits on the strip beside
// Export, and explains itself in one line on open — but the popover now offers the
// capability that exists: teach this document a look from a site, a PDF or an image.
// There is no picking, because there is nothing to pick from; the learned look sticks
// server-side, and the submission narrates in the thread (§2.3: it is a message).

const S = {
  ink:    'var(--ink-high)',
  body:   'var(--ink-body)',
  faint:  'var(--ink-dim)',
  muted:  'var(--ink-muted)',
  accent: 'var(--accent)',
  picked: 'var(--accent-subtle)',
  card:   'var(--surface-raised)',
  border: 'var(--surface-raised)',
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

export interface ThemesMenuProps {
  projectId: string;
  docId: string;
}

export function ThemesMenu({ projectId, docId }: ThemesMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LearnKind>('url');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy || !learnReady(kind, value)) return;
    setBusy(true);
    // Both outcomes are already IN the thread (informative, or actionable with the
    // service's own reason) — the popover's job is only to stop offering the same submit.
    const outcome = await learnThemeFromThread({ projectId, docId, kind, value });
    setBusy(false);
    if (outcome.ok) { setValue(''); setOpen(false); }
  }

  return (
    <div style={{ alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
      <button
        type="button"
        data-testid="themes-open"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={`${THEMES_EXPLAINER} ${THEMES_STICKS}`}
        style={BUTTON}
      >
        Themes
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
                      aria-pressed={kind === k} onClick={() => setKind(k)}
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
            onChange={(e) => setValue(e.target.value)}
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
          <button
            type="button"
            data-testid="themes-submit"
            className="self-start rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: S.accent, color: 'var(--accent-fg)', border: 'none', cursor: 'pointer' }}
            disabled={busy || !learnReady(kind, value)}
            onClick={() => void submit()}
          >
            {busy ? 'Submitting…' : `Learn from this ${LEARN_LABEL[kind].noun}`}
          </button>
        </div>
      )}
    </div>
  );
}
