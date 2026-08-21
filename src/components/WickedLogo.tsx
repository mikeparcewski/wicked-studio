/**
 * The default wicked mark (DES-VISION-001 §3.1): an SVG PATH, not a font
 * character — so it scales cleanly at 32×32 — stroked in `var(--accent)` so it
 * follows accent customization (§3) with zero component changes. The old
 * filled-square + dark-stroke rendering carried its own raw palette; the mark
 * is now monochrome accent, the token contract's own recommendation for marks
 * ("monochrome logos work on any surface ramp", §3.1).
 *
 * Rendered by the chrome's logo slot (`AppChrome.tsx`) when no custom
 * `--logo-url` is set; slice 7's customization surface swaps it for the
 * operator's asset. `data-testid="logo-wicked-mark"` is the §6.3 slice-7 AC's
 * name for it — pinned here so the swap is assertable.
 */
export function WickedLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      data-testid="logo-wicked-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M6 10L10.5 24L16 13L21.5 24L26 10"
        style={{ stroke: 'var(--accent)' }}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
