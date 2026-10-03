import { useEffect, useMemo, useState } from 'react';
import { slideChip, slideInView, slidesOf } from '../../board/artifactMorph.js';
import { addAboutChip, relabelAboutChip } from '../../store/composerChips.js';
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
 *  to the middle of the frame, so the view alone would mark the wrong one) — for as long as the
 *  frame stands where that click's jump landed. No timer: every jump has a number, the frame
 *  confirms it by that number and says where it landed (`parts.jump`). Before its confirmation
 *  the pick holds; after it, the pick holds while the frame stands at the landing — so it gives
 *  way when the reader scrolls elsewhere and holds again at that exact position, where the picked
 *  slide is still the answer. A later jump, a re-measure or a new frame ends it. A bridge that
 *  does not report the landing gets the view's mark only. */
interface Pick {
  index: number;
  /** The number of this pick's own jump (`scrollTo`'s return). */
  jump: number;
}

function holds(pick: Pick | null, parts: FrameParts): pick is Pick {
  if (pick === null) return false;
  if (parts.jump.seq < pick.jump) return true; // asked, not yet confirmed
  return parts.jump.seq === pick.jump && parts.jump.scrollY !== null && parts.jump.scrollY === parts.scrollY;
}

export function SlideStrip({ parts, docId, composerKey }: {
  parts: FrameParts;
  docId: string;
  composerKey: string;
}): React.ReactElement | null {
  const slides = useMemo(() => slidesOf(parts.blocks), [parts.blocks]);
  const [picked, setPicked] = useState<Pick | null>(null);
  // A slide chip already on the composer names the slide by its title as it reads now.
  useEffect(() => {
    for (const s of slides) relabelAboutChip(composerKey, slideChip(s, docId));
  }, [slides, composerKey, docId]);
  if (slides.length === 0) return null;
  const current = holds(picked, parts) ? picked.index : slideInView(slides, parts.tops, parts.scrollY, parts.frameHeight);
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
            setPicked({ index: s.index, jump: parts.scrollTo(s.first) });
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
