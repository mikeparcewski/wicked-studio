import { useEffect, useRef, useState } from 'react';
import type { AppPublished } from '../../editors/apps/appsDirectory.js';

/**
 * SHARE (operator 2026-11-03: "a share link so the user could share with others"). Real sharing is a PUBLISHED copy:
 * Publish (lane K6) builds a signed-in app server the deployer runs, and that server's address is the link. So:
 *
 *  - published (crew reports the record): the link, who can open it, the iframe snippet when embedding is allowed,
 *    and which version went out when — each with Copy;
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
}

/** The studio address of an app (for people who use this studio, signed in to this daemon). */
export function studioLink(slug: string, origin = window.location.origin): string {
  return `${origin}/apps/${encodeURIComponent(slug)}`;
}

/** The iframe snippet for a published copy that allows embedding; its words are attribute-escaped. */
export function embedSnippet(embedUrl: string, name: string): string {
  const esc = (v: string): string => v.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  return `<iframe src="${esc(embedUrl)}" title="${esc(name)}" width="100%" height="640" loading="lazy"></iframe>`;
}

function CopyRow({ label, value, testId, note }: { label: string; value: string; testId: string; note?: string }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const field = useRef<HTMLInputElement | null>(null);
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
        <input id={`${testId}-field`} ref={field} readOnly className="wk-share-field" value={value} data-testid={`${testId}-field`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid={`${testId}-copy`} onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {state === 'manual' && <p className="wk-share-note">Selected: press Ctrl+C or ⌘C to copy it.</p>}
      {note !== undefined && <p className="wk-share-note">{note}</p>}
    </div>
  );
}

export function ShareSheet({ name, slug, published, onClose }: ShareSheetProps): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); was?.focus?.(); };
  }, [onClose]);
  return (
    <div className="wk-share-scrim" data-testid="apps-share-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="wk-share" role="dialog" aria-modal="true" aria-labelledby="wk-share-title" data-testid="apps-share" data-published={published !== null}>
        <header className="wk-share-head">
          <h2 id="wk-share-title" className="wk-share-title">Share “{name}”</h2>
          <button type="button" className="wk-btn wk-btn--link" data-testid="apps-share-close" onClick={onClose} aria-label="Close">Close</button>
        </header>
        {published !== null ? (
          <>
            <p className="wk-share-lead" data-testid="apps-share-state">Published: anyone the deployer allows can open it, signed in.</p>
            <CopyRow label="Share link" value={published.url} testId="apps-share-link" />
            <p className="wk-share-meta"><span className="wk-share-k">Who can open it</span> <span data-testid="apps-share-audience">{published.audience}</span></p>
            {published.embedUrl !== null && <CopyRow label="Embed in a page" value={embedSnippet(published.embedUrl, name)} testId="apps-share-embed" />}
            <p className="wk-share-meta" data-testid="apps-share-when">
              <span className="wk-share-k">Published</span> v{published.version} · published · {new Date(published.at).toLocaleString()}
            </p>
          </>
        ) : (
          <>
            <p className="wk-share-lead" data-testid="apps-share-state">Not published yet: other people need a published copy to open it.</p>
            <p className="wk-share-body">Publish builds a signed-in app server that your deployer runs. Its link is what you share.</p>
            <div className="wk-share-actions">
              <button type="button" className="wk-btn wk-btn--primary" data-testid="apps-share-publish" disabled aria-describedby="wk-share-soon">Publish</button>
              <span id="wk-share-soon" className="wk-share-note">Coming with Publish</span>
            </div>
            <CopyRow label="Studio link" value={studioLink(slug)} testId="apps-share-studio"
              note="For people who use this studio: it opens the app here, signed in to this daemon. Anyone else can’t open it." />
          </>
        )}
      </div>
    </div>
  );
}
