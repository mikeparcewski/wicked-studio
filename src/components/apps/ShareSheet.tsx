import { useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import { publishedExtrasOf } from '../../api/appsPublish.js';
import type { AppPublished } from '../../editors/apps/appsDirectory.js';
import { useModalEscape } from '../Modal.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';

/**
 * SHARE (operator 2026-11-03: "a share link so the user could share with others"). Real sharing is a PUBLISHED copy:
 * Publish (lane K6) builds a signed-in app server the deployer runs, and that server's address is the link. So:
 *
 *  - published (crew reports the record): the link and the iframe snippet (when embedding is allowed), each with Copy,
 *    who can open it, and which version went out when;
 *  - not published: it says so plainly, offers Publish (disabled until it lands), and a studio link labelled as one,
 *    for people who use this studio.
 *
 * Nothing here makes up an address: the share link is only ever crew's.
 */

export interface ShareSheetProps {
  name: string;
  slug: string;
  published: AppPublished | null;
  onClose: () => void;
  /** (K6) crew serves Publish: the not-published state offers it. */
  onPublish?: () => void;
  /** (K6) The app as crew reported it: the Teams package, when the publish made one. */
  detail?: unknown;
}

/** The studio address of an app (for people who use this studio, signed in to this daemon). */
export function studioLink(slug: string, origin = window.location.origin): string {
  return `${origin}/apps/${encodeURIComponent(slug)}`;
}

/** One value with Copy. The field shows exactly the string Copy copies (a snippet in a text area keeps its lines). */
export function CopyRow({ label, value, testId, note, multiline = false }: { label: string; value: string; testId: string; note?: string; multiline?: boolean }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const field = useRef<HTMLInputElement & HTMLTextAreaElement | null>(null);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // No clipboard here (permission, an insecure page): the text is selected for the person to copy.
      field.current?.select();
      setState('manual');
    }
  };
  return (
    <div className="wk-share-row">
      <label className="wk-share-label" htmlFor={`${testId}-field`}>{label}</label>
      <div className="wk-share-copy">
        {multiline
          ? <textarea id={`${testId}-field`} ref={field} readOnly rows={3} className="wk-share-field wk-share-field--multi" value={value} data-testid={`${testId}-field`} onFocus={(e) => e.currentTarget.select()} />
          : <input id={`${testId}-field`} ref={field} readOnly className="wk-share-field" value={value} data-testid={`${testId}-field`} onFocus={(e) => e.currentTarget.select()} />}
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid={`${testId}-copy`} onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {state === 'manual' && <p className="wk-share-note">Selected: press Ctrl+C or ⌘C to copy it.</p>}
      {note !== undefined && <p className="wk-share-note">{note}</p>}
    </div>
  );
}

export function ShareSheet({ name, slug, published, onClose, onPublish, detail }: ShareSheetProps): React.ReactElement {
  const teamsUrl = published !== null ? (publishedExtrasOf(detail)?.teamsUrl ?? null) : null;
  const box = useRef<HTMLDivElement | null>(null);
  // The modal family's contract: one Escape closes the top layer only (the palette and later modals first), Tab
  // stays inside, and focus goes back where it was when the sheet closes.
  useModalEscape(onClose);
  useDialogFocus(true, box, { modal: true });
  return (
    <div className="wk-share-scrim" data-testid="apps-share-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="wk-share" role="dialog" aria-modal="true" aria-labelledby="wk-share-title" data-testid="apps-share" data-published={published !== null}>
        <header className="wk-share-head">
          <h2 id="wk-share-title" className="wk-share-title">Share “{name}”</h2>
          <button type="button" className="wk-btn wk-btn--link" data-testid="apps-share-close" onClick={onClose} aria-label="Close">Close</button>
        </header>
        {published !== null ? (
          <>
            <p className="wk-share-lead" data-testid="apps-share-state">Published: send this link to the people who can open it.</p>
            <CopyRow label="Share link" value={published.shareUrl} testId="apps-share-link" />
            <p className="wk-share-meta"><span className="wk-share-k">Who can open it</span> <span data-testid="apps-share-audience">{published.audience}</span></p>
            {published.snippet !== null && <CopyRow label="Embed in a page" value={published.snippet} testId="apps-share-embed" multiline />}
            {teamsUrl !== null && (
              <p className="wk-share-meta"><span className="wk-share-k">Teams</span> <a className="wk-link" data-testid="apps-share-teams" href={`${apiBase()}${teamsUrl.replace(/^\/api\/v1/, '')}`} download>Download the Teams app package</a></p>
            )}
            {onPublish !== undefined && <p className="wk-share-actions"><button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-share-republish" onClick={onPublish}>Publish again</button></p>}
            <p className="wk-share-meta" data-testid="apps-share-when">
              <span className="wk-share-k">Published</span> v{published.version} on {new Date(published.at).toLocaleString()}
            </p>
          </>
        ) : (
          <>
            <p className="wk-share-lead" data-testid="apps-share-state">Not published yet: other people need a published copy to open it.</p>
            <p className="wk-share-body">Publish builds a signed-in app server that your deployer runs. Its link is what you share.</p>
            <div className="wk-share-actions">
              <button type="button" className="wk-btn wk-btn--primary" data-testid="apps-share-publish" disabled={onPublish === undefined} aria-describedby="wk-share-soon" onClick={onPublish}>Publish</button>
              {onPublish === undefined && <span id="wk-share-soon" className="wk-share-note">This crew does not publish apps yet</span>}
            </div>
            <CopyRow label="Studio link" value={studioLink(slug)} testId="apps-share-studio"
              note="For people who use this studio: it opens the app here, signed in to this daemon. Anyone else can’t open it." />
          </>
        )}
      </div>
    </div>
  );
}
