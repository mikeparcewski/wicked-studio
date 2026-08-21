import { useState } from 'react';
import { listThemes, type ThemeSummary } from '../api/interactive.js';
import { contextKey, useDocContextStore } from '../store/docContext.js';

// The Themes control (DES-UXFIX-001 §2.6 rule 4, V19; the library itself is DES-MERGE-001
// §4.6). The audit's "theme library" pill floated unexplained in the composer context
// (F9): a newcomer could not say what a theme was or what picking one did. The redesign
// renames it to the one word "Themes", moves it into the canvas toolbar beside Export —
// where it acts on the document — and opens with ONE line saying what it is:
// "Borrow a look from a site, PDF, or image."
//
// Picking is unchanged underneath: the choice lands in the docContext store keyed to this
// composer, renders as the composer's context chip, and rides with the NEXT generation as
// `theme_id` — a theme is context for what the conversation makes, not an edit of what
// the canvas already shows. Learning a new theme stays in the composer's "learn a theme"
// action, because that submission is a thread message (§2.3).

const S = {
  ink:    '#e6edf3',
  faint:  'rgba(230,237,243,0.35)',
  muted:  'rgba(230,237,243,0.55)',
  accent: '#ffda19',
  card:   '#1b222e',
  border: 'rgba(230,237,243,0.1)',
  danger: '#f85149',
};

const BUTTON: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '5px',
  color: S.muted, cursor: 'pointer', fontSize: '10px', lineHeight: 1.6, padding: '1px 6px',
};

/** V19's one-line explanation, shown every time the menu opens — never tooltip-only. */
export const THEMES_EXPLAINER = 'Borrow a look from a site, PDF, or image.';

export interface ThemesMenuProps {
  projectId: string;
  docId: string;
}

export function ThemesMenu({ projectId, docId }: ThemesMenuProps): React.ReactElement {
  const key = contextKey(projectId, docId);
  const picked = useDocContextStore((s) => s.theme[key]);
  const [open, setOpen] = useState(false);
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(): void {
    const opening = !open;
    setOpen(opening);
    if (!opening) return;
    setError(null);
    listThemes(projectId)
      .then(setThemes)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  // §3.3: the menu says what it is doing or why it cannot, and a list that failed to
  // load picks nothing rather than silently offering the default as if it were chosen.
  const status = error !== null
    ? { testId: 'themes-error', danger: true,
        text: `${error} — no theme was picked; the next generation uses the default.` }
    : themes === null
      ? { testId: 'themes-loading', danger: false, text: 'Loading the themes…' }
      : themes.length === 0
        ? { testId: 'themes-empty', danger: false,
            text: 'No themes yet — learn one from a website, a PDF or an image.' }
        : null;

  return (
    <div style={{ alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
      <button
        type="button"
        data-testid="themes-open"
        aria-expanded={open}
        onClick={toggle}
        title={`${THEMES_EXPLAINER} The pick rides with the next generation.`}
        style={{ ...BUTTON, ...(picked !== undefined ? { color: S.accent } : {}) }}
      >
        Themes{picked !== undefined ? `: ${picked}` : ''}
      </button>

      {open && (
        <div
          data-testid="themes-panel"
          className="flex flex-col gap-1 overflow-y-auto"
          style={{
            background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px',
            bottom: 'calc(100% + 6px)', maxHeight: '200px', padding: '8px 10px',
            position: 'absolute', right: 0, width: '250px', zIndex: 30,
          }}
        >
          <p
            data-testid="themes-explain"
            style={{ color: S.muted, fontSize: '11px', lineHeight: 1.4, margin: 0 }}
          >
            {THEMES_EXPLAINER}
          </p>
          {status !== null && (
            <p
              data-testid={status.testId}
              className="text-[10px] font-mono"
              style={{ color: status.danger ? S.danger : S.faint, margin: 0 }}
            >
              {status.text}
            </p>
          )}
          {(themes ?? []).map((t) => (
            <button
              key={t.name}
              type="button"
              data-testid="theme-row"
              data-theme={t.name}
              aria-pressed={picked === t.name}
              onClick={() => {
                useDocContextStore.getState().pickTheme(key, t.name);
                setOpen(false);
              }}
              className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-mono"
              style={{ background: picked === t.name ? 'rgba(255,218,25,0.1)' : 'transparent',
                       color: S.ink, border: 'none', cursor: 'pointer' }}
            >
              <span className="truncate">{t.name}</span>
              <span className="shrink-0 text-[10px]" style={{ color: S.faint }}>
                {t.source ?? 'built-in'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
