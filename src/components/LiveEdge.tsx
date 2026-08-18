/**
 * A 2 px accent strip placed along the leading (left) edge of an executing element.
 * The parent must have `position: relative` and `overflow: hidden` so the strip is
 * clipped by the parent's border-radius.  Never rendered for gate-waiting, failed,
 * or terminal states — those carry their own distinct treatments.
 *
 * Motion: slow opacity breath (0.5→1, 2 s ease-in-out, via .wk-live-edge in index.css).
 * Reduced-motion: animation is suppressed by the CSS media query; the strip stays at
 * full opacity so the state is still obvious.  The component also reads matchMedia and
 * sets data-reduced="true" so unit tests can assert the reduced-motion branch without
 * a real CSS engine.
 */

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LiveEdge(): React.ReactElement {
  const reduced = prefersReducedMotion();
  return (
    <span
      data-testid="live-edge"
      aria-hidden="true"
      className="wk-live-edge"
      {...(reduced ? { 'data-reduced': 'true' } : {})}
    />
  );
}
