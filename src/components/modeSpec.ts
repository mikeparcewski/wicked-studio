import type { Mode } from '../hooks/useRoute.js';

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

/** Extracted from ModeSwitcher.tsx (S16a) so kept components (RunLink, ProjectCard, LeftSidebar)
 *  can import without pulling in the deleted ModeSwitcher component. */
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
    label: 'Demo',
    glyph: '▶',
    summary:
      'Demo mode makes a demo of your running app: the team plans and rehearses it, you approve the '
      + 'script, it records each chapter, and a different seat reviews it before you watch.',
    sublabel: 'record a demo',
  },
};
