import { useEffect, useMemo } from 'react';
import { apiBase } from '../../api/client.js';
import type { EditorView } from '../../api/editors.js';
import { fakeSurfaceFor } from '../../editors/adapters/fake.js';
import { useHostChrome, useHostPanel, type ArtifactBinding, type RunHostContext, type SurfaceAdapter } from '../../editors/hostApi.js';
import { bundleUrl } from '../../editors/model.js';
import { HostPanel } from './HostPanel.js';
import { PluginCard } from './PluginCard.js';
import { RunHostProvider } from './RunHostContext.js';

/**
 * H7 — the editor test page's three surfaces (DES-EDITOR-PLUGIN-CONTRACT-001 §8.3): one plugin, loaded from crew's
 * bundle route over the scripted sample artifact, rendered by the SAME host components the run page uses — the card
 * in a mock thread turn, its Options group in a mock host panel, and full screen with Simple/Advanced and the chat
 * drawer. Nothing here knows the plugin: everything is drawn from its declaration.
 */
export function EditorSurfacesView({ editor, version, sha, title, kind, file }: {
  editor: string; version: string; sha: string; title: string; kind: string;
  /** studio#1516: a job's file, read-only, instead of the sample (`key` names the run and path). */
  file?: { adapter: SurfaceAdapter; name: string; key: string };
}): React.ReactElement {
  const view = useMemo<EditorView>(() => ({
    id: editor, title, version, sha256: sha, protocol: [1, 2], kinds: [kind], sizes: ['inline', 'pane', 'full'],
    permissions: [], first_party: editor.startsWith('wicked-'), enabled: true,
  } as unknown as EditorView), [editor, title, version, sha, kind]);
  const binding = useMemo<ArtifactBinding>(() => ({
    artifactKey: file !== undefined ? `test:${editor}@${version}:${file.key}` : `test:${editor}@${version}`,
    title: file !== undefined ? file.name : kind === 'run-insights' ? 'Sample run insights' : kind === 'deck' ? 'Library room booking · deck' : kind === 'demo-video' ? 'Build a team · demo video' : 'Library room booking', kind, source: 'fake',
    // A job's file names no maker: who wrote it is the job's to say, not a made-up seat (studio#1516).
    projectId: '', composerKey: 'editor-test', producedBy: file !== undefined ? '' : 'Claude Code',
  }), [editor, version, kind, file]);
  const adapter = useMemo(() => file?.adapter ?? fakeSurfaceFor(binding), [binding, file]);
  const src = bundleUrl(apiBase(), editor, version, sha);
  // A job's real file (studio#1516) gets no mock chat, phase or gate: nothing on it is made up.
  const run = useMemo<RunHostContext>(() => (file !== undefined ? { runId: null } : {
    runId: null,
    phase: 'Build · phase 2 of 4',
    renderChat: () => (
      <div data-testid="surfaces-mock-chat" className="wk-surfaces-chat">
        <p className="wk-surfaces-chat-who">You</p>
        <p>Make the second part shorter.</p>
        <p className="wk-surfaces-chat-who">Claude Code</p>
        <p>Version 2 is ready. Compare shows both.</p>
        <textarea aria-label="Ask for a change" placeholder="Ask for a change" rows={2} className="wk-hcontrol-input" />
      </div>
    ),
    gateActions: () => <button type="button" data-testid="surfaces-mock-gate" className="wk-host-btn" disabled title="A mock of the host's gate controls">Approve (mock gate)</button>,
  }), [file]);
  // Leaving the page leaves no group or full screen behind.
  useEffect(() => () => { useHostPanel.getState().closeGroup(); useHostChrome.getState().exitFull(); }, []);

  return (
    <RunHostProvider value={run}>
      <section data-testid="editor-surfaces" className="wk-surfaces">
        <div className="wk-surfaces-thread" aria-label="A mock thread turn">
          {file === undefined && (<>
            <h2 className="wk-surfaces-h">The card, in a thread turn</h2>
            <p className="wk-surfaces-turn">I made the page. Point at a part to talk about it.</p>
          </>)}
          <PluginCard binding={binding} editor={view} adapter={adapter} src={src} />
        </div>
        <HostPanel
          runTab={file !== undefined ? (
            <div data-testid="surfaces-file-run" className="wk-surfaces-run">
              <p><b>File</b> {file.name}</p>
              <p className="wk-host-note">Read-only. A change to it goes through a job.</p>
            </div>
          ) : (
            <div data-testid="surfaces-mock-run" className="wk-surfaces-run">
              <p><b>Workflow</b> Page · Critique now</p>
              <p><b>Phase</b> Build, 2 of 4</p>
              <p><b>Helpers</b> Claude Code (maker), Codex (reviewer)</p>
              <p className="wk-host-note">A mock of the run page’s Run tab. Press Options on the card to add the plugin’s tabs.</p>
            </div>
          )}
          ribbon={<span>{file !== undefined ? `${file.name} · Read-only · open the panel` : 'Run · Build, phase 2 of 4 · open the panel'}</span>}
        />
      </section>
    </RunHostProvider>
  );
}
