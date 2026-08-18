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
  /**
   * THE ONE FLAG THIS SLICE IS ALLOWED (DES-MERGE-001 §6.0). An unavailable mode is
   * DISABLED, never hidden (§1.3 rule 3) — hiding it teaches the user the feature
   * does not exist. Document flips to `true` in slice 8, Video in slice 13; when both
   * are `true` this field and its branches delete cleanly.
   */
  available: boolean;
  /**
   * The ONE action that enables this mode, named as an action (§1.3 rule 3). Rendered
   * as the disabled tab's `title` and verbatim in the mode's placeholder.
   */
  enables: string;
  /** What this mode is, with its subject — never a bare "coming soon" (§3.3). */
  summary: string;
}

export const MODE_SPECS: Record<Mode, ModeSpec> = {
  chat: {
    label: 'Chat',
    available: true,
    enables: '',
    summary: 'Talk to an agent with no artifact committed yet — and choose a mode by conversation.',
  },
  build: {
    label: 'Build',
    available: true,
    enables: '',
    summary: 'Governed code work: units, phases, gates and evidence, on a crew run.',
  },
  document: {
    label: 'Document',
    available: false,
    enables:
      'Connect the interactive document service to this project (crew proxies it at '
      + '/api/v1/projects/:projectId/interactive) to create documents here.',
    summary:
      'Document mode is where the interactive canvas lands: an HTML doc, deck or report, '
      + 'its version strip, and point-and-comment feedback — all against this project’s one thread.',
  },
  video: {
    label: 'Video',
    available: false,
    enables:
      'Install the demo recorder (ffmpeg) and connect the interactive document service to '
      + 'this project to record demos here.',
    summary:
      'Video mode is where the demo storyboard and player land: chapters derived from the '
      + 'document’s steps, recorded and re-recorded from the same thread.',
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
            disabled={!spec.available}
            title={spec.available ? spec.summary : spec.enables}
            onClick={() => onSelect(m)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? S.accent : 'transparent'}`,
              color: !spec.available ? S.faint : active ? S.ink : S.muted,
              cursor: spec.available ? 'pointer' : 'not-allowed',
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
