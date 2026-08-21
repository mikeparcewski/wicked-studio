import { MODES, type Mode } from '../hooks/useRoute.js';

const S = {
  bar:      '#161c26',
  border:   'rgba(230,237,243,0.1)',
  ink:      '#e6edf3',
  muted:    'rgba(230,237,243,0.55)',
  faint:    'rgba(230,237,243,0.3)',
  accent:   '#ffda19',
  /** Text on a filled accent segment — the house pairing for accent-filled controls. */
  accentInk: '#0d1117',
  /** An unfilled segment's resting surface — present enough to read as a control. */
  segment:  'rgba(230,237,243,0.04)',
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
  return (
    <div
      data-testid="mode-switcher"
      style={{ flexShrink: 0, background: S.bar, borderBottom: `1px solid ${S.border}` }}
    >
      <div
        role="tablist"
        aria-label="Project mode"
        style={{ display: 'flex', gap: '6px', padding: '10px 12px 0' }}
      >
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
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                // The F8 fix in one property: the active segment is FILLED, not underlined.
                background: active ? S.accent : S.segment,
                border: `1px solid ${active ? S.accent : S.border}`,
                borderRadius: '8px',
                color: active ? S.accentInk : S.muted,
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: active ? 700 : 500,
                opacity: action !== null && !active ? 0.45 : 1,
                padding: '7px 14px',
              }}
            >
              {/* The SAME four glyphs as the board quick actions and doc tiles (§2.5 rule 4). */}
              <span aria-hidden style={{ flexShrink: 0 }}>{spec.glyph}</span>
              {spec.label}
            </button>
          );
        })}
      </div>
      {/* §2.5 rule 2: the active mode's summary is ON SCREEN, not tooltip-only. */}
      <p
        data-testid="mode-summary"
        style={{ color: S.muted, fontSize: '11px', margin: 0, padding: '7px 14px 9px' }}
      >
        {MODE_SPECS[mode].summary}
      </p>
    </div>
  );
}
