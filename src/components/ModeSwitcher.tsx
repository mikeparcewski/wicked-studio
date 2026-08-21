import { useLayoutEffect, useRef, useState } from 'react';
import { MODES, type Mode } from '../hooks/useRoute.js';
import { prefersReducedMotion } from './LiveEdge.js';

// DES-VISION-001 §5.2: the switcher's visual language is the token contract's
// (§2.11 — no raw colors). Active segment: accent fill + accent-fg ink; inactive:
// transparent + ink-muted; hover: surface-raised + ink-body.
const S = {
  bar:    'var(--surface-rail)',
  border: 'var(--surface-raised)',
  muted:  'var(--ink-muted)',
  dim:    'var(--ink-dim)',
  hover:  'var(--surface-raised)',
  hoverInk: 'var(--ink-body)',
  accent: 'var(--accent)',
  accentInk: 'var(--accent-fg)',
};

export interface ModeSpec {
  label: string;
  /** The mode's glyph — the SAME four symbols everywhere (switcher, board quick
   *  actions, doc tiles), so the spine reads as one vocabulary (DES-UXFIX-001 §2.5). */
  glyph: string;
  /** What this mode is, with its subject — never a bare "coming soon" (§3.3). */
  summary: string;
  /** What the verb PRODUCES, in a phrase (DES-UXFIX-001 §2.2) — shown on
   *  first-run and on hover so the four actions never read as synonyms (F2). */
  sublabel: string;
}

/**
 * Slice 13 landed Video's surface, which retired `available`/`enables` and the
 * placeholder they fed: every mode now has a real surface, and each one states its own
 * missing dependency where that dependency actually bites (a missing ffmpeg leaves the
 * storyboard standing with the install command beside the player, §4.5) rather than
 * greying out the whole verb. §1.3 rule 3 stands for a mode that genuinely cannot open,
 * and slice 17's merged preflight is what finally knows: `unavailable` below is that
 * model's word, never an ad-hoc check made here.
 */
export const MODE_SPECS: Record<Mode, ModeSpec> = {
  chat: {
    label: 'Chat',
    glyph: '💬',
    summary: 'Talk to an agent with no artifact committed yet — and choose a mode by conversation.',
    sublabel: 'think out loud with an agent',
  },
  build: {
    label: 'Build',
    glyph: '⚙',
    summary: 'Governed code work: units, phases, gates and evidence, on a crew run.',
    sublabel: 'ship code, with checks',
  },
  document: {
    label: 'Document',
    glyph: '▤',
    summary:
      'Document mode is where the interactive canvas lands: an HTML doc, deck or report, '
      + 'its version strip, and point-and-comment feedback — all against this project’s one thread.',
    sublabel: 'a deck, page, or report',
  },
  video: {
    label: 'Video',
    glyph: '▶',
    summary:
      'Video mode is the demo storyboard and player: chapters derived from the spec’s steps, '
      + 'recorded and re-recorded from the same thread.',
    sublabel: 'record a demo',
  },
};

interface Props {
  mode: Mode;
  onSelect: (mode: Mode) => void;
  /**
   * Per mode, the ONE action that would enable it — from the merged readiness model
   * (slice 17). A mode with an action here reads as unavailable and states that action
   * in its title (§1.3 rule 3).
   *
   * It stays ACTIONABLE, and deliberately carries no `aria-disabled`: the surface it
   * routes to is where the install command and the "Continue anyway" escape live (§4.9,
   * interactive #159), so the mode is never truly un-enterable and marking it disabled
   * would be a lie that costs assistive-tech users the escape hatch. Unavailable here
   * means "greyed, and it tells you why" — never hidden, never inert (§1.3 rule 3).
   */
  unavailable?: Partial<Record<Mode, string | null>>;
}

/**
 * The four-mode switcher (DES-MERGE-001 §1.3) — rendered on every `/p/*` route.
 *
 * Each mode is a verb on the current project, not a document type, and each is
 * peer-level: Document is deliberately NOT a tab under Build (§1.3 rule 4).
 *
 * Slice 4 (DES-UXFIX-001 §2.5, F8) gives it the weight of the spine it is: a
 * SEGMENTED control — glyph + label per segment, the active segment FILLED
 * (accent background, dark ink), not a row of low-contrast text links — and the
 * active mode's one-line summary always on screen below the control, so a
 * newcomer reads what the current mode IS without hovering (W1). The readiness
 * model is untouched: an unavailable segment is greyed, never hidden, and its
 * title still names the one enabling action (§1.3 rule 3).
 */
export function ModeSwitcher({ mode, onSelect, unavailable }: Props): React.ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  // The active fill's rect, measured off the active segment. Null until the
  // first layout pass; the active button paints its own accent from frame one,
  // so the control is never fill-less.
  const [fill, setFill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const reduced = prefersReducedMotion();

  // §5.2: "the active fill slides between segments via a positioned <div> that
  // transitions its left and width" — measured, not derived, so font loading
  // and container resizes re-place it (the ResizeObserver below).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = (): void => {
      const btn = list.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
      if (btn) {
        setFill({ left: btn.offsetLeft, top: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [mode]);

  return (
    <div
      data-testid="mode-switcher"
      style={{ flexShrink: 0, background: S.bar, borderBottom: `1px solid ${S.border}` }}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Project mode"
        style={{ position: 'relative', display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3) 0' }}
      >
        {/* The active fill underlayer (§1.6: mode segment click → the fill slides,
            220ms, --ease-in-out; the labels do not move). One div, transitioned on
            left/width; prefers-reduced-motion snaps it. */}
        {fill !== null && (
          <div
            aria-hidden
            data-testid="mode-fill"
            style={{
              position: 'absolute',
              left: `${fill.left}px`,
              top: `${fill.top}px`,
              width: `${fill.width}px`,
              height: `${fill.height}px`,
              background: S.accent,
              borderRadius: 'var(--radius-md)',
              transition: reduced
                ? 'none'
                : 'left var(--dur-base) var(--ease-in-out), width var(--dur-base) var(--ease-in-out)',
              pointerEvents: 'none',
            }}
          />
        )}
        {MODES.map((m) => {
          const spec = MODE_SPECS[m];
          const active = m === mode;
          const action = unavailable?.[m] ?? null;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`mode-tab-${m}`}
              data-mode={m}
              data-unavailable={action !== null ? 'true' : undefined}
              // §1.3 rule 3: a mode that cannot open states the one action that enables it —
              // on its own line, under what the mode IS. Replacing the summary would answer
              // "how do I turn this on" to a user who is still asking "what is this".
              title={action !== null ? `${spec.summary}\n${spec.label} ${action}` : spec.summary}
              onClick={() => onSelect(m)}
              onMouseEnter={(e) => {
                if (!active) { e.currentTarget.style.background = S.hover; e.currentTarget.style.color = S.hoverInk; }
              }}
              onMouseLeave={(e) => {
                if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = S.muted; }
              }}
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                // The segment itself resolves the accent (EC15's computed-style AC);
                // its paint is DELAYED one slide so the traveling fill, not the
                // endpoint, carries the motion — accent lands on accent, seamlessly.
                background: active ? S.accent : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: active ? S.accentInk : S.muted,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                opacity: action !== null && !active ? 0.45 : 1,
                padding: '7px 14px',
                transition: active && !reduced
                  ? 'background-color var(--dur-fast) var(--ease-in-out) var(--dur-base), color var(--dur-fast) var(--ease-in-out)'
                  : 'none',
              }}
            >
              {/* The SAME four glyphs as the board quick actions and doc tiles (§2.5 rule 4). */}
              <span aria-hidden style={{ flexShrink: 0 }}>{spec.glyph}</span>
              {spec.label}
            </button>
          );
        })}
      </div>
      {/* §2.5 rule 2: the active mode's summary is ON SCREEN, not tooltip-only.
          §5.2: normal weight, --text-xs, sans, --ink-dim. */}
      <p
        data-testid="mode-summary"
        style={{
          color: S.dim, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-normal)', margin: 0, padding: '7px 14px 9px',
        }}
      >
        {MODE_SPECS[mode].summary}
      </p>
    </div>
  );
}
