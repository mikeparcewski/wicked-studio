import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { listEditors } from '../../api/editors.js';
import type { AppsCapabilities, SessionView } from '../../api/types.js';
import { isAppSlug, sampleKeyOf } from '../../editors/apps/appsDirectory.js';
import type { AppMode } from '../../editors/apps/appAdapter.js';
import { APPS_EDITOR } from '../../editors/protocol.js';
import { AppHostView } from '../editorHost/AppHostView.js';

type RouteState =
  | { kind: 'ready'; editor: { version: string; sha: string } | null; caps: { apps: AppsCapabilities | undefined } }
  | { kind: 'failed'; message: string };

/**
 * `/apps/<slug>` (`?mode=edit` opens it in Edit; Preview otherwise): one app in the `wicked-apps` runtime. The app is
 * crew's when crew serves the app store; without it only the two sample apps open, and any other address says so.
 * Health is read once here and handed to the host, and a daemon that does not answer is an error to retry: it never
 * reads as "no app store" (codex r9).
 */
export function AppRoutePage({ slug, search, navigate, runs }: { slug: string; search: string; navigate: (path: string) => void; runs?: readonly SessionView[] }): React.ReactElement {
  const [state, setState] = useState<RouteState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const valid = isAppSlug(slug);
  useEffect(() => {
    if (!valid) return undefined;
    let cancelled = false;
    setState(null);
    void (async () => {
      try {
        const [h, editors] = await Promise.all([api.getHealth(), listEditors()]);
        if (cancelled) return;
        const e = (editors ?? []).find((x) => x.id === APPS_EDITOR && x.enabled !== false) ?? null;
        setState({ kind: 'ready', editor: e === null ? null : { version: e.version, sha: e.sha256 }, caps: { apps: h.capabilities?.apps } });
      } catch (e) {
        if (!cancelled) setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [slug, valid, attempt]);
  const mode: AppMode = new URLSearchParams(search).get('mode') === 'edit' ? 'edit' : 'preview';
  const back = <a href="/apps" className="wk-link" onClick={(ev) => { ev.preventDefault(); navigate('/apps'); }}>Back to Apps</a>;
  if (!valid) {
    return <div className="wk-apps-route wk-apps-route--msg" data-testid="apps-route-unknown"><p>“{slug.slice(0, 80)}” is not an app’s address.</p>{back}</div>;
  }
  if (state === null) return <div className="wk-apps-route" data-testid="apps-route-loading" />;
  if (state.kind === 'failed') {
    return (
      <div className="wk-apps-route wk-apps-route--msg" data-testid="apps-route-failed">
        <p>The daemon did not answer, so “{slug}” could not be opened: {state.message}</p>
        <p><button type="button" className="wk-btn wk-btn--secondary" data-testid="apps-route-retry" onClick={() => setAttempt((n) => n + 1)}>Try again</button> {back}</p>
      </div>
    );
  }
  const store = state.caps.apps !== undefined;
  const sample = store ? null : sampleKeyOf(slug);
  if (state.editor === null) {
    return <div className="wk-apps-route wk-apps-route--msg" data-testid="apps-route-noeditor"><p>The App editor is not installed on this daemon, so apps can’t open here.</p>{back}</div>;
  }
  if (!store && sample === null) {
    return <div className="wk-apps-route wk-apps-route--msg" data-testid="apps-route-unknown"><p>This daemon has no app store, so “{slug}” can’t open here. Only the sample apps do.</p>{back}</div>;
  }
  return (
    <div className="wk-editor-page wk-editor-page--app wk-apps-route" data-testid="apps-route">
      <AppHostView key={`${slug}:${mode}`} editor={APPS_EDITOR} version={state.editor.version} sha={state.editor.sha}
        app={store ? slug : null} sample={sample} initialMode={mode} navigate={navigate} caps={state.caps} {...(runs !== undefined ? { runs } : {})} />
    </div>
  );
}
