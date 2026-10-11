import { useCallback, useEffect, useState } from 'react';
import { listEditors, type EditorView } from '../../api/editors.js';
import { seedComposer } from '../../store/composerSeed.js';

/**
 * Settings → Developer → Editor plugins (operator ruling X3, 2026-10-10; DES-EDITOR-PLUGINS-001 §3.2).
 *
 * The editors this studio's service has: the built-in ones that ship with studio and the ones a run of
 * the `editor-plugin` workflow installed. Each opens in the editor test page (`/editors/dev`), the real
 * sandboxed host over a sample page. "Create an editor plugin" puts `/workflow-editor-plugin` in the
 * Desk's message box; nothing is sent until you send it.
 *
 * The same list (compact) is the editor test page's empty state.
 */

/** The workflow command the Create button seeds (the core preset `editor-plugin`). */
export const CREATE_EDITOR_COMMAND = '/workflow-editor-plugin ';

const PERMISSION_WORDS: Record<string, string> = {
  'artifact.read': 'read what it opens',
  'artifact.write': 'change it, as versions you can undo',
  'selection.chip': 'point at parts in your message',
  'composer.draft': 'suggest what to ask',
  'checks.read': 'see the checks',
  'checks.contribute': 'add its own notes',
  'sources.read': 'see the sources',
  'media.read': 'play recordings',
  'artifact.export': 'download it',
  'ui.fullscreen': 'go full screen',
  'network.media': 'load images and fonts from the internet',
};

const KIND_WORDS: Record<string, string> = {
  page: 'pages',
  document: 'documents',
  deck: 'decks',
  'demo-video': 'demo videos',
  walkthrough: 'walkthroughs',
  'rfp-response': 'RFP responses',
};

/** "pages and documents" — the kinds an editor opens, in plain words. */
export function kindsInWords(kinds: readonly string[]): string {
  const words = kinds.map((k) => KIND_WORDS[k] ?? k.replace(/-/g, ' '));
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "Can read what it opens and go full screen." — every permission, never an id. */
export function permissionsInWords(permissions: readonly { id: string }[]): string {
  const words = permissions.map((p) => PERMISSION_WORDS[p.id] ?? p.id);
  if (words.length === 0) return 'Asks for nothing.';
  const list = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `Can ${list}.`;
}

/** The editor test page for one editor. */
export function devHostHref(e: Pick<EditorView, 'id' | 'version' | 'sha256' | 'title'>): string {
  const q = new URLSearchParams({ editor: e.id, version: e.version, sha: e.sha256, title: e.title });
  return `/editors/dev?${q.toString()}`;
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; editors: EditorView[] }
  | { state: 'unsupported' }
  | { state: 'error'; error: string };

/** The registry, re-read every time the surface mounts (an install made by a run shows on the next visit). */
export function useEditorList(): { load: Load; retry: () => void; retrying: boolean } {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let live = true;
    listEditors()
      .then((editors) => { if (live) setLoad(editors === null ? { state: 'unsupported' } : { state: 'ready', editors }); })
      .catch((e: unknown) => { if (live) setLoad({ state: 'error', error: e instanceof Error ? e.message : String(e) }); })
      .finally(() => { if (live) setRetrying(false); });
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setRetrying(true); setAttempt((n) => n + 1); }, []);
  return { load, retry, retrying };
}

/** `.wk-link` is the contract's link class (UI-CONTRACT §4.1, added by the primitives PR); until it lands
 *  the same look is given here with tokens: accent ink, underlined. */
const linkStyle: React.CSSProperties = { fontSize: 'var(--text-sm)', color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 };

const tagStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--ink-muted)',
  background: 'var(--surface-raised)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 6px',
};

function EditorRow({ e, navigate, compact }: { e: EditorView; navigate: (p: string) => void; compact: boolean }): React.ReactElement {
  const href = devHostHref(e);
  return (
    <li
      data-testid="editor-plugin-row"
      data-editor={e.id}
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 border-b last:border-b-0"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-high)', fontWeight: 500 }}>
          <span>{e.title}</span>
          <span data-testid="editor-plugin-source" style={tagStyle}>{e.first_party ? 'Built in' : 'Installed'}</span>
          {!e.enabled && <span data-testid="editor-plugin-off" style={tagStyle}>Off</span>}
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', marginTop: 2 }}>
          Version {e.version} · opens {kindsInWords(e.kinds)}
        </p>
        {!compact && (
          <p data-testid="editor-plugin-permissions" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', marginTop: 2 }}>
            {permissionsInWords(e.permissions)}
          </p>
        )}
      </div>
      {e.enabled ? (
        <a
          href={href}
          data-testid="editor-plugin-open"
          className="wk-link"
          style={linkStyle}
          onClick={(ev) => { ev.preventDefault(); navigate(href); }}
        >
          Try it in the test page
        </a>
      ) : (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>Turned off, so it opens nowhere.</span>
      )}
    </li>
  );
}

/** The list itself, with its loading, error, unsupported and empty states. */
export function EditorPluginList({ navigate, compact = false }: { navigate: (p: string) => void; compact?: boolean }): React.ReactElement {
  const { load, retry, retrying } = useEditorList();
  if (load.state === 'loading') {
    return (
      <ul data-testid="editor-plugins-loading" aria-busy="true" aria-label="Loading editor plugins">
        {[0, 1].map((i) => (
          <li key={i} className="py-3">
            <div style={{ height: 12, width: '40%', background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)' }} />
            <div style={{ height: 10, width: '60%', marginTop: 6, background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)' }} />
          </li>
        ))}
      </ul>
    );
  }
  if (load.state === 'error') {
    return (
      <div data-testid="editor-plugins-error" role="alert" className="py-3 flex flex-wrap items-center gap-3">
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-body)' }}>Couldn’t load the editor plugins.</p>
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="editor-plugins-retry" onClick={retry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <details className="w-full" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>
          <summary>Technical details</summary>
          <pre style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{load.error}</pre>
        </details>
      </div>
    );
  }
  if (load.state === 'unsupported') {
    return (
      <p data-testid="editor-plugins-unsupported" className="py-3" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
        This version of studio’s service has no editor plugins to list. Update it to see them here.
      </p>
    );
  }
  if (load.editors.length === 0) {
    return (
      <p data-testid="editor-plugins-empty" className="py-3" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
        No editor plugins yet. Create one, and it shows here once it is installed.
      </p>
    );
  }
  return (
    <ul data-testid="editor-plugins-list" aria-label="Editor plugins">
      {load.editors.map((e) => <EditorRow key={e.id} e={e} navigate={navigate} compact={compact} />)}
    </ul>
  );
}

/** Put the create command in the Desk's message box, ready to send. */
export function startCreateEditorPlugin(navigate: (p: string) => void): void {
  navigate('/');
  seedComposer('desk', CREATE_EDITOR_COMMAND);
}

/** The Developer section of Settings. */
export function DeveloperSettings({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  return (
    <section
      data-testid="developer-settings"
      aria-labelledby="developer-settings-title"
      className="rounded-xl px-5 py-4 mb-6"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
    >
      <h2 id="developer-settings-title" style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink-high)' }}>Developer</h2>
      <div data-testid="editor-plugins-settings" className="mt-3">
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink-high)' }}>Editor plugins</h3>
        <p className="mt-1" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
          Editors open what studio makes, such as pages and documents, inside a sandbox with no internet. Built-in ones
          ship with studio. The ones you build are installed when their run finishes, after they pass studio’s checks.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="wk-btn wk-btn--primary"
            data-testid="editor-plugins-create"
            onClick={() => startCreateEditorPlugin(navigate)}
          >
            Create an editor plugin
          </button>
          <a
            href="/editors/dev"
            className="wk-link"
            data-testid="editor-plugins-devhost"
            style={linkStyle}
            onClick={(ev) => { ev.preventDefault(); navigate('/editors/dev'); }}
          >
            Open the editor test page
          </a>
        </div>
        <p className="mt-1" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>
          The test page opens an installed editor in the real sandbox over a sample page, so you can try one you are building.
        </p>
        <div className="mt-2">
          <EditorPluginList navigate={navigate} />
        </div>
      </div>
    </section>
  );
}
