import { useCallback, useEffect, useState } from 'react';
import { listEditors, type EditorView } from '../../api/editors.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { EmptyState, PageFrame, Skeleton, StateBanner } from '../ui/index.js';
import { PAGE_NAMES } from '../../board/pageNames.js';

/**
 * The Plugins page (operator 2026-10-12; was Settings → Developer → Editor plugins, ruling X3, 2026-10-10;
 * DES-EDITOR-PLUGINS-001 §3.2).
 *
 * The editors this studio's service has: the built-in ones that ship with studio and the ones a run of
 * the `editor-plugin` workflow installed. Each opens in the editor test page (`/editors/dev`), the real
 * sandboxed host over a sample page. "Create an editor plugin" opens the launch wizard on the editor-plugin workflow (was: put `/workflow-editor-plugin` in the
 * Desk's message box; nothing is sent until you send it.
 *
 * The same list (compact) is the editor test page's empty state.
 */

/** The workflow command the Create button seeds (the core preset `editor-plugin`). */
/** The editor-plugin workflow's id (the launch wizard opens on it). */
export const CREATE_EDITOR_WORKFLOW_ID = 'editor-plugin';

const PERMISSION_WORDS: Record<string, string> = {
  'artifact.read': 'read what it opens',
  'artifact.write': 'change it (you can undo)',
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

/** Every permission in plain words, never an id: what it can do, and its internet access on its own line. */
export function permissionsInWords(permissions: readonly { id: string }[]): { can: string; internet: string | null } {
  const can = permissions.filter((p) => p.id !== 'network.media').map((p) => PERMISSION_WORDS[p.id] ?? p.id);
  return {
    can: can.length === 0 ? 'Asks for nothing.' : `Can: ${can.join(' · ')}`,
    internet: permissions.some((p) => p.id === 'network.media') ? 'Also loads images and fonts from the internet.' : null,
  };
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

function EditorRow({ e, navigate, compact }: { e: EditorView; navigate: (p: string) => void; compact: boolean }): React.ReactElement {
  const href = devHostHref(e);
  const words = permissionsInWords(e.permissions);
  return (
    <li data-testid="editor-plugin-row" data-editor={e.id} className="py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
      <p className="flex flex-wrap items-center gap-2" style={{ fontSize: 'var(--text-md)', color: 'var(--ink-high)', fontWeight: 600 }}>
        <span>{e.title}</span>
        <span data-testid="editor-plugin-source" className="wk-tag">{e.first_party ? 'Built in' : 'Installed'}</span>
        {!e.enabled && <span data-testid="editor-plugin-off" className="wk-tag">Off</span>}
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', marginTop: 2 }}>
        Version {e.version} · opens {kindsInWords(e.kinds)}
      </p>
      {!compact && (
        <div data-testid="editor-plugin-permissions" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-body)', marginTop: 4 }}>
          <p>{words.can}</p>
          {words.internet !== null && <p data-testid="editor-plugin-internet">{words.internet}</p>}
        </div>
      )}
      <p style={{ marginTop: 6 }}>
        {e.enabled ? (
          <a href={href} data-testid="editor-plugin-open" className="wk-btn wk-btn--secondary wk-btn--sm" aria-label={compact ? `Open ${e.title}` : `Try it on a sample page: ${e.title}`} onClick={(ev) => { ev.preventDefault(); navigate(href); }}>
            {compact ? 'Open' : 'Try it on a sample page'}
          </a>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)' }}>Turned off, so it opens nowhere.</span>
        )}
      </p>
    </li>
  );
}

/** The list itself, with its loading, error, unsupported and empty states. */
export function EditorPluginList({ navigate, compact = false }: { navigate: (p: string) => void; compact?: boolean }): React.ReactElement {
  const { load, retry, retrying } = useEditorList();
  if (load.state === 'loading') return <Skeleton rows={2} data-testid="editor-plugins-loading" />;
  if (load.state === 'error') {
    return <StateBanner kind="error" what="the editor plugins" error={load.error} onRetry={retry} retrying={retrying} data-testid="editor-plugins-error" />;
  }
  if (load.state === 'unsupported') {
    return <EmptyState data-testid="editor-plugins-unsupported" title="This version of studio’s service has no editor plugins to list." body="Update it to see them here." />;
  }
  if (load.editors.length === 0) {
    return <EmptyState data-testid="editor-plugins-empty" title="No editor plugins yet." body="Create one, and it shows here once it is installed." />;
  }
  return (
    <ul data-testid="editor-plugins-list" aria-label="Editor plugins">
      {load.editors.map((e) => <EditorRow key={e.id} e={e} navigate={navigate} compact={compact} />)}
    </ul>
  );
}

/** The editor test page with no editor named (UX audit row 39): the installed editors to open. */
export function EditorTestPagePicker({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  return (
    <PageFrame
      data-testid="editor-host-pick"
      title="Editor test page"
      intro="Pick an editor to open it in the real sandbox over a sample page."
      actions={<a href="/plugins" className="wk-link" data-testid="editor-host-back" onClick={(ev) => { ev.preventDefault(); navigate('/plugins'); }}>Back to {PAGE_NAMES.plugins}</a>}
    >
      <EditorPluginList navigate={navigate} compact />
    </PageFrame>
  );
}

/** Open the launch wizard for the editor-plugin workflow (the one start point for a new job). */
export function startCreateEditorPlugin(): void {
  openLaunchWizard({ workflowId: CREATE_EDITOR_WORKFLOW_ID });
}

/**
 * THE PLUGINS PAGE (operator ruling 2026-10-12: editor plugins move out of Configuration onto their
 * own Workspace page), `/plugins`: what the Developer section did — the list, each opening in the
 * editor test page, Create an editor plugin (the launch wizard on `editor-plugin`) and the test page.
 * The open-in-editor door is `devHostHref` (above), the one seam the MCP inspector builds on.
 */
export function PluginsPage({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  return (
    <PageFrame
      data-testid="plugins-page"
      title={PAGE_NAMES.plugins}
      intro="Editor plugins open what studio makes, such as pages and documents, in a sandbox: each can do only what its row lists."
      actions={<>
        <a href="/editors/dev" className="wk-btn wk-btn--secondary" data-testid="editor-plugins-devhost" onClick={(ev) => { ev.preventDefault(); navigate('/editors/dev'); }}>
          Open the editor test page
        </a>
        <button type="button" className="wk-btn wk-btn--primary" data-testid="editor-plugins-create" onClick={() => startCreateEditorPlugin()}>
          Create an editor plugin
        </button>
      </>}
    >
      <section data-testid="editor-plugins-settings" aria-labelledby="plugins-list-title" className="wk-card">
        <h2 id="plugins-list-title" className="wk-section-title">Editor plugins</h2>
        <p className="wk-pg-proj-note">
          Built-in ones ship with studio. One you create appears here once its job passes studio’s checks and you approve the install.
        </p>
        <EditorPluginList navigate={navigate} />
      </section>
    </PageFrame>
  );
}
