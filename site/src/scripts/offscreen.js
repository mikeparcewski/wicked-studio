/* pauseWhenOffscreen: an interactive plays only while a person can see it.
 *
 *   const vis = pauseWhenOffscreen(root, { start, stop, threshold });
 *
 * `root` is live while at least `threshold` of it is on screen (a quarter by default; an element
 * taller than the window counts the share of the window it fills), the tab is visible and the
 * visitor has not asked for reduced motion. `stop()` runs when it stops being live, `start()` when it
 * is live again; `vis.live` reads the state. Each interactive keeps its own pause and hover hold:
 * `start` resumes only what the person has not paused.
 *
 * When it stops being live, its one-shot animations and transitions jump to their end (nothing is
 * left half-faded or half-drawn), and while it is not live it carries data-offscreen, so studio.css
 * pauses every looping CSS animation in it: nothing under it changes while nobody can see it. A
 * switch to reduced motion reaches `stop()` even when the root was already held, so a held
 * autoplay can settle on its end state.
 *
 * The no-scroll rules that go with it: a timer tick never calls scrollIntoView, scrollTo, scrollBy
 * or focus(), and never sets the page's scrollTop. Content that swaps on a timer is stacked in a
 * box as tall as its tallest state, and html { overflow-anchor: none } (studio.css) keeps the browser's
 * scroll anchoring from following it. */

const RM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
// every hundredth of the root: a root taller than the window crosses a quarter of the window at a ratio
// under the threshold, and the observer only reports ratio crossings
const STEPS = Array.from({ length: 101 }, (_, i) => i / 100);

/** One-shot animations and transitions under `root` land on their end state now; loops are left to the
 *  data-offscreen rule. */
export function settle(root) {
  if (!root.getAnimations) return;
  root.getAnimations({ subtree: true }).forEach((a) => {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    if (t && t.endTime !== Infinity && a.playState === 'running') { try { a.finish(); } catch (e) { /* not finishable */ } }
  });
}

export function pauseWhenOffscreen(root, opts = {}) {
  const threshold = opts.threshold === undefined ? 0.25 : opts.threshold;
  let seen = !('IntersectionObserver' in window);
  let live = false;
  function sync() {
    const now = seen && !document.hidden && !(RM && RM.matches);
    root.toggleAttribute('data-offscreen', !now);
    if (now === live) return;
    live = now;
    if (now) { if (opts.start) opts.start(); return; }
    if (opts.stop) opts.stop();
    // after stop(): whatever it changed on the way out (a reset, a finished typing) lands now too, and
    // again on the next frame, for a transition another observer started on the way out
    settle(root);
    requestAnimationFrame(() => { if (!live) settle(root); });
  }
  if (!seen) {
    new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      const share = Math.max(e.intersectionRatio, e.intersectionRect.height / Math.max(1, window.innerHeight));
      seen = e.isIntersecting && share >= threshold - 0.001;
      sync();
    }, { threshold: STEPS.concat([threshold]) }).observe(root);
  }
  document.addEventListener('visibilitychange', sync);
  if (RM && RM.addEventListener) RM.addEventListener('change', () => {
    const was = live;
    sync();
    if (RM.matches && !was && opts.stop) opts.stop();
  });
  sync();
  return { get live() { return live; } };
}
