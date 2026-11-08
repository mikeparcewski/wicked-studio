import { useRef, useState } from 'react';
import type { AppDetail } from '../../api/types.js';
import { PublishSheet } from './PublishSheet.js';
import type { AppPublished } from '../../editors/apps/appsDirectory.js';
import { useModalEscape } from '../Modal.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';

export interface ShareSheetProps {
  name: string;
  slug: string;
  published: AppPublished | null;
  onClose: () => void;
  detail?: AppDetail;
  publishEnabled?: boolean;
  publishDisabledWhy?: string | null;
  onStarted?: (runId: string) => void;
}

/** The studio address of an app (for people who use this studio, signed in to this daemon). */
export function studioLink(slug: string, origin = window.location.origin): string {
  return `${origin}/apps/${encodeURIComponent(slug)}`;
}

/** One value with Copy. The field shows exactly the string Copy copies (a snippet in a text area keeps its lines). */
function CopyRow({ label, value, testId, note, multiline = false }: { label: string; value: string; testId: string; note?: string; multiline?: boolean }): React.ReactElement {
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

/** Quote the image as a shell argument; environment values stay in the deployer's environment. */
export function dockerRun(published: AppPublished): string | null {
  if (published.run === undefined || published.image === undefined) return null;
  const { env, port, volume } = published.run;
  const quote = (v: string): string => "'" + v.replaceAll("'", "'\\''") + "'";
  return ['docker run --rm', `-p ${port}:${port}`, ...env.map((e) => `-e ${quote(e)}`), ...(volume === null ? [] : [`-v apps-data:${volume}`]), quote(published.image.tag)].join(' ');
}

export function ShareSheet(props: ShareSheetProps): React.ReactElement {
  const [publishing, setPublishing] = useState(false);
  if (publishing && props.detail !== undefined) return <PublishSheet detail={props.detail} onClose={() => setPublishing(false)} onStarted={(id) => { props.onStarted?.(id); props.onClose(); }} />;
  return <ShareDialog {...props} onPublish={() => setPublishing(true)} />;
}

function ShareDialog({ name, slug, published, onClose, detail, publishEnabled = false, publishDisabledWhy = null, onPublish }: ShareSheetProps & { onPublish: () => void }): React.ReactElement {
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
            {published.image !== undefined && <>
              <CopyRow label="Image tag" value={published.image.tag} testId="apps-share-image-tag" />
              <CopyRow label="Image id" value={published.image.id} testId="apps-share-image-id" />
            </>}
            {dockerRun(published) !== null && <CopyRow label="Run the image" value={dockerRun(published)!} testId="apps-share-run" multiline note="Set these environment names to your source secrets before running this command. Run the image at the share link’s site address." />}
            {published.snippet !== null && <CopyRow label="Embed in a page" value={published.snippet} testId="apps-share-embed" multiline />}
            <p className="wk-share-meta" data-testid="apps-share-when">
              <span className="wk-share-k">Published</span> v{published.version} on {new Date(published.at).toLocaleString()}
            </p>
          </>
        ) : (
          <>
            <p className="wk-share-lead" data-testid="apps-share-state">Not published yet: other people need a published copy to open it.</p>
            <p className="wk-share-body">Publish builds an app server that you run in your own container engine. Its site address is the link you share.</p>
            <CopyRow label="Studio link" value={studioLink(slug)} testId="apps-share-studio"
              note="For people who use this studio: it opens the app here, signed in to this daemon. Anyone else can’t open it." />
          </>
        )}
        <div className="wk-share-actions">
          <button type="button" className="wk-btn wk-btn--primary" data-testid="apps-share-publish" disabled={!publishEnabled || detail === undefined || publishDisabledWhy !== null} aria-describedby="wk-share-publish-why" onClick={onPublish}>
            {published === null ? 'Publish' : detail !== undefined && detail.head.version > published.version ? `Publish v${detail.head.version}` : 'Publish again'}
          </button>
          <span id="wk-share-publish-why" className="wk-share-note">{!publishEnabled ? 'Publish needs a container engine (Docker or Rancher Desktop) running on this computer, and a wicked-crew that can publish.' : publishDisabledWhy ?? (detail === undefined ? 'Open the app to publish it.' : '')}</span>
        </div>
      </div>
    </div>
  );
}
