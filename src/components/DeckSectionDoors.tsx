import type { Navigate } from '../hooks/useRoute.js';

/** One section door — a glyph, a name, a live count line, its route + accent color. */
export interface SectionDoor {
  key: string;
  label: string;
  glyph: string;
  /** The one-line count/context, or null when its wire hasn't answered (the door still links). */
  count: string | null;
  href: string;
  /** The door's accent token (its section color). */
  color: string;
}

/**
 * The section-doors strip (command-deck redesign) — the nav made legible on the landing: Execute /
 * Test / Vibe / Demo / Evals / Steering as color-coded doors with a live count, the "where do I go"
 * answer. Absent counts (a wire that hasn't answered) show the door without a number, never a
 * fabricated zero. Mirrors the rail's Make-breakout so the landing and the nav agree.
 */
export function DeckSectionDoors({ doors, navigate }: {
  doors: SectionDoor[];
  navigate: Navigate;
}): React.ReactElement {
  return (
    <nav className="deck-doors" data-testid="home-section-doors" aria-label="Sections">
      {doors.map((d) => (
        <a
          key={d.key}
          className="deck-door"
          data-testid="section-door"
          data-section={d.key}
          href={d.href}
          onClick={(e) => { e.preventDefault(); navigate(d.href); }}
          style={{ ['--door-col' as string]: d.color }}
        >
          <span className="deck-door-glyph" aria-hidden>{d.glyph}</span>
          <span className="deck-door-text">
            <span className="deck-door-label">{d.label}</span>
            {d.count !== null && <span className="deck-door-count">{d.count}</span>}
          </span>
        </a>
      ))}
    </nav>
  );
}
