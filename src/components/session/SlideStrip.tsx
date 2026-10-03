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
 *  its own jump landed — the first scroll within this window — and any scroll away from there is
 *  the reader's, which hands the mark back to the view. The window is only as long as the jump
 *  takes to report (the frame posts its scroll within a frame or two): a jump that moves nothing
 *  must not let the reader's own first scroll, a moment later, pass for the landing. */
const JUMP_WINDOW_MS = 200;

export function SlideStrip({ parts, docId, composerKey }: {
  parts: FrameParts;
  docId: string;
  composerKey: string;
}): React.ReactElement | null {
  const slides = useMemo(() => slidesOf(parts.blocks), [parts.blocks]);
  const [picked, setPicked] = useState<{ index: number; until: number; landedAt: number | null } | null>(null);
  const { scrollY } = parts;
  useEffect(() => {
    setPicked((p) => {
      if (p === null) return null;
      if (p.landedAt === null) return performance.now() <= p.until ? { ...p, landedAt: scrollY } : null;
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
            setPicked({ index: s.index, until: performance.now() + JUMP_WINDOW_MS, landedAt: null });
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
