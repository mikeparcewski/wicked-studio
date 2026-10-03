import { useEffect, useMemo, useState } from 'react';
import { slideChip, slideInView, slidesOf } from '../../board/artifactMorph.js';
import { addAboutChip } from '../../store/composerChips.js';
import type { FrameParts } from './PageEditor.js';

/**
 * S9 — the slide strip of the deck editor (DES-EDITOR-PLUGINS-001 §7.2: "a slide strip and the
 * current slide large"). The slides are read from the frame's own inventory — every slide the
 * engine anchored (`slide-{i}-…`), named by its title — so the strip is what the deck holds, not a
 * guess. A click brings the slide into view and makes it the subject of the next message
 * ("about: slide 2 — “…”"); the slide in view is marked as the frame scrolls.
 *
 * Not here: reordering slides and speaker notes need an engine operation interactive does not
 * have (EP-I3), so there is no drag and no notes field.
 */

/** A click on a slide outranks "the slide in view" (the last slides of a deck cannot be scrolled
 *  to the middle of the frame, so the view alone would mark the wrong one). The pick holds where
 *  its own jump landed, and any scroll away from there is the reader's, which hands the mark back
 *  to the view. The landing is the scroll the frame reports right behind its confirmation of the
 *  jump (`scroll-ack`, counted in `parts.jumps`) — this long behind it at most, so a jump that
 *  moved nothing does not let the reader's own scroll, a moment later, pass for the landing. The
 *  window starts at the confirmation, not at the click: a slow frame costs nothing. */
const LANDING_WITHIN_MS = 150;

interface Pick {
  index: number;
  /** `parts.jumps` when the slide was clicked — the jump is confirmed once the count passes it. */
  asked: number;
  /** When the confirmation was seen (`null` = not yet). */
  confirmedAt: number | null;
  /** Where the jump landed (`null` = no scroll reported for it, yet or at all). */
  landedAt: number | null;
}

export function SlideStrip({ parts, docId, composerKey }: {
  parts: FrameParts;
  docId: string;
  composerKey: string;
}): React.ReactElement | null {
  const slides = useMemo(() => slidesOf(parts.blocks), [parts.blocks]);
  const [picked, setPicked] = useState<Pick | null>(null);
  const { scrollY, jumps } = parts;
  useEffect(() => {
    setPicked((p) => (p !== null && p.confirmedAt === null && jumps > p.asked ? { ...p, confirmedAt: performance.now() } : p));
  }, [jumps]);
  useEffect(() => {
    setPicked((p) => {
      if (p === null || p.confirmedAt === null) return p; // the jump has not happened yet
      if (p.landedAt === null) return performance.now() - p.confirmedAt <= LANDING_WITHIN_MS ? { ...p, landedAt: scrollY } : null;
      return scrollY === p.landedAt ? p : null;
    });
  }, [scrollY]);
  if (slides.length === 0) return null;
  const current = picked?.index ?? slideInView(slides, parts.tops, scrollY, parts.frameHeight);
  return (
    <nav data-testid="slide-strip" data-count={slides.length} data-current={current ?? ''} aria-label="Slides" className="wk-artifact-side wk-slide-strip">
      {slides.map((s) => (
        <button
          key={s.index}
          type="button"
          data-testid="slide-thumb"
          data-slide={s.index}
          aria-current={s.index === current ? 'true' : undefined}
          className={`wk-slide-thumb${s.index === current ? ' wk-slide-thumb--on' : ''}`}
          onClick={() => {
            setPicked({ index: s.index, asked: jumps, confirmedAt: null, landedAt: null });
            parts.scrollTo(s.first);
            addAboutChip(composerKey, slideChip(s, docId));
          }}
        >
          <span className="wk-slide-n">{s.index + 1}</span>
          <span className="wk-slide-title">{s.title === '' ? `Slide ${s.index + 1}` : s.title}</span>
        </button>
      ))}
    </nav>
  );
}
