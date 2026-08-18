import { MODES, type Mode } from '../hooks/useRoute.js';

const S = {
  bar:      '#161c26',
  border:   'rgba(230,237,243,0.1)',
  ink:      '#e6edf3',
  muted:    'rgba(230,237,243,0.55)',
  faint:    'rgba(230,237,243,0.3)',
  accent:   '#ffda19',
};

export interface ModeSpec {
  label: string;
  /** What this mode is, with its subject — never a bare "coming soon" (§3.3). */
  summary: string;
}

/**
 * Slice 13 landed Video's surface, which retired `available`/`enables` and the
 * placeholder they fed: every mode now has a real surface, and each one states its own
 * missing dependency where that dependency actually bites (a missing ffmpeg leaves the
 * storyboard standing with the install command beside the player, §4.5) rather than
 * greying out the whole verb. §1.3 rule 3 still stands for a mode that genuinely cannot
 * open — that is slice 17's preflight gate, which knows what is installed; this switcher
 * never did.
 */
export const MODE_SPECS: Record<Mode, ModeSpec> = {
  chat: {
    label: 'Chat',
    summary: 'Talk to an agent with no artifact committed yet — and choose a mode by conversation.',
  },
  build: {
    label: 'Build',
    summary: 'Governed code work: units, phases, gates and evidence, on a crew run.',
  },
  document: {
    label: 'Document',
    summary:
      'Document mode is where the interactive canvas lands: an HTML doc, deck or report, '
      + 'its version strip, and point-and-comment feedback — all against this project’s one thread.',
  },
  video: {
    label: 'Video',
    summary:
      'Video mode is the demo storyboard and player: chapters derived from the spec’s steps, '
      + 'recorded and re-recorded from the same thread.',
  },
};

interface Props {
  mode: Mode;
  onSelect: (mode: Mode) => void;
}

/**
 * The four-mode switcher (DES-MERGE-001 §1.3) — rendered on every `/p/*` route.
 *
 * Each mode is a verb on the current project, not a document type, and each is
 * peer-level: Document is deliberately NOT a tab under Build (§1.3 rule 4).
 */
export function ModeSwitcher({ mode, onSelect }: Props): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Project mode"
      data-testid="mode-switcher"
      style={{
        display: 'flex', gap: '2px', padding: '0 12px', flexShrink: 0,
        background: S.bar, borderBottom: `1px solid ${S.border}`,
      }}
    >
      {MODES.map((m) => {
        const spec = MODE_SPECS[m];
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`mode-tab-${m}`}
            data-mode={m}
            title={spec.summary}
            onClick={() => onSelect(m)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? S.accent : 'transparent'}`,
              color: active ? S.ink : S.muted,
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: active ? 700 : 500,
              padding: '10px 14px',
            }}
          >
            {spec.label}
          </button>
        );
      })}
    </div>
  );
}
