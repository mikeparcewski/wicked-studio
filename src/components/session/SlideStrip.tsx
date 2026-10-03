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

/** How long a click on a slide outranks "the slide in view": the scroll it starts is not the
 *  reader's. A later scroll hands the mark back to the view. */
const PICK_HOLDS_MS = 700;

export function SlideStrip({ parts, docId, composerKey }: {
  parts: FrameParts;
  docId: string;
  composerKey: string;
}): React.ReactElement | null {
  const slides = useMemo(() => slidesOf(parts.blocks), [parts.blocks]);
  const [picked, setPicked] = useState<{ index: number; until: number } | null>(null);
  const { scrollY } = parts;
  useEffect(() => {
    setPicked((p) => (p !== null && performance.now() > p.until ? null : p));
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
            setPicked({ index: s.index, until: performance.now() + PICK_HOLDS_MS });
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
