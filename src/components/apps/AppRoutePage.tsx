import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { listEditors } from '../../api/editors.js';
import { sampleKeyOf } from '../../editors/apps/appsDirectory.js';
import type { AppMode } from '../../editors/apps/appAdapter.js';
import { APPS_EDITOR } from '../../editors/protocol.js';
import { AppHostView } from '../editorHost/AppHostView.js';

/**
 * `/apps/<slug>` (`?mode=edit` opens it in Edit; Preview otherwise): one app in the `wicked-apps` runtime. The app is
 * crew's when crew serves the app store; without it only the two sample apps open, and any other address says so.
 */
export function AppRoutePage({ slug, search, navigate }: { slug: string; search: string; navigate: (path: string) => void }): React.ReactElement {
  const [state, setState] = useState<{ editor: { version: string; sha: string } | null; store: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.getHealth().catch(() => null), listEditors().catch(() => null)]).then(([h, editors]) => {
      if (cancelled) return;
      const e = editors?.find((x) => x.id === APPS_EDITOR && x.enabled !== false) ?? null;
      setState({ editor: e === null ? null : { version: e.version, sha: e.sha256 }, store: h?.capabilities?.apps !== undefined });
    });
    return () => { cancelled = true; };
  }, [slug]);
  const mode: AppMode = new URLSearchParams(search).get('mode') === 'edit' ? 'edit' : 'preview';
  if (state === null) return <div className="wk-apps-route" data-testid="apps-route-loading" />;
  const sample = state.store ? null : sampleKeyOf(slug);
  const back = <a href="/apps" className="wk-link" onClick={(ev) => { ev.preventDefault(); navigate('/apps'); }}>Back to Apps</a>;
  if (state.editor === null) {
    return <div className="wk-apps-route wk-apps-route--msg" data-testid="apps-route-noeditor"><p>The App editor is not installed on this daemon, so apps can’t open here.</p>{back}</div>;
  }
  if (!state.store && sample === null) {
    return <div className="wk-apps-route wk-apps-route--msg" data-testid="apps-route-unknown"><p>This daemon has no app store, so “{slug}” can’t open here. Only the sample apps do.</p>{back}</div>;
  }
  return (
    <div className="wk-editor-page wk-editor-page--app wk-apps-route" data-testid="apps-route">
      <AppHostView key={`${slug}:${mode}`} editor={APPS_EDITOR} version={state.editor.version} sha={state.editor.sha}
        app={state.store ? slug : null} sample={sample} initialMode={mode} navigate={navigate} />
    </div>
  );
}
