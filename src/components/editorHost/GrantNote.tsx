import type { DecidedGrants } from '../../editors/model.js';

/** Same-tab navigation for a link outside a page that was handed `navigate` (the app's router listens to popstate). */
function go(href: string): void {
  history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The host's line about what an editor asks for (F37). When the person can allow it, the line ends in a link that goes
 * straight to the switch that does (the editor's details on the Plugins page), never to a page without one.
 */
export function grantNote(decided: Pick<DecidedGrants, 'note' | 'allow'>, navigate: (p: string) => void = go): React.ReactNode {
  if (decided.note === null) return null;
  const allow = decided.allow ?? null;
  if (allow === null) return decided.note;
  const asks = decided.note.replace(/ Allow it in Plugins\.$/u, '');
  return (
    <>
      {asks}{' '}
      <a href={allow.href} data-testid="editor-grants-allow" data-permission={allow.permission} className="wk-link"
        onClick={(ev) => { ev.preventDefault(); navigate(allow.href); }}>
        Allow it in Plugins
      </a>.
    </>
  );
}
