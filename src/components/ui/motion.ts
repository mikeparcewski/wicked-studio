/** The scroll behaviour a script-driven scroll should use: none of the glide when the operator asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true ? 'auto' : 'smooth';
}
