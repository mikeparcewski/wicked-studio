/**
 * The skip link (usability review #10): the app's FIRST tabbable element, so
 * the first Tab reaches something sensible — a jump to the main content —
 * instead of landing on a page's top-right "Refresh". Visually hidden until
 * focused (the `.skip-link` rules in global.css); on activation it moves focus
 * to the `#main` region App marks around the center surface.
 */
export function SkipLink(): React.ReactElement {
  return (
    <a
      href="#main"
      data-testid="skip-link"
      className="skip-link"
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById('main');
        if (main !== null) {
          main.focus();
          main.scrollIntoView?.({ block: 'start' });
        }
      }}
    >
      Skip to main content
    </a>
  );
}
