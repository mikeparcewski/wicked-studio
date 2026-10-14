import { useEffect, useMemo } from 'react';
import { apiBase } from '../../api/client.js';
import type { EditorView } from '../../api/editors.js';
import { FakeSurfaceAdapter } from '../../editors/adapters/fake.js';
import { useHostChrome, useHostPanel, type ArtifactBinding, type RunHostContext } from '../../editors/hostApi.js';
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
export function EditorSurfacesView({ editor, version, sha, title, kind }: { editor: string; version: string; sha: string; title: string; kind: string }): React.ReactElement {
  const view = useMemo<EditorView>(() => ({
    id: editor, title, version, sha256: sha, protocol: [1, 2], kinds: [kind], sizes: ['inline', 'pane', 'full'],
    permissions: [], first_party: editor.startsWith('wicked-'), enabled: true,
  } as unknown as EditorView), [editor, title, version, sha, kind]);
  const binding = useMemo<ArtifactBinding>(() => ({
    artifactKey: `test:${editor}@${version}`, title: kind === 'deck' ? 'Library room booking · deck' : 'Library room booking', kind, source: 'fake',
    projectId: '', composerKey: 'editor-test', producedBy: 'Claude Code',
  }), [editor, version, kind]);
  const adapter = useMemo(() => new FakeSurfaceAdapter(binding), [binding]);
  const src = bundleUrl(apiBase(), editor, version, sha);
  const run = useMemo<RunHostContext>(() => ({
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
  }), []);
  // Leaving the page leaves no group or full screen behind.
  useEffect(() => () => { useHostPanel.getState().closeGroup(); useHostChrome.getState().exitFull(); }, []);

  return (
    <RunHostProvider value={run}>
      <section data-testid="editor-surfaces" className="wk-surfaces">
        <div className="wk-surfaces-thread" aria-label="A mock thread turn">
          <h2 className="wk-surfaces-h">The card, in a thread turn</h2>
          <p className="wk-surfaces-turn">I made the page. Point at a part to talk about it.</p>
          <PluginCard binding={binding} editor={view} adapter={adapter} src={src} />
        </div>
        <HostPanel
          runTab={(
            <div data-testid="surfaces-mock-run" className="wk-surfaces-run">
              <p><b>Workflow</b> Page · Critique now</p>
              <p><b>Phase</b> Build, 2 of 4</p>
              <p><b>Agents</b> Claude Code (maker), Codex (reviewer)</p>
              <p className="wk-host-note">A mock of the run page’s Run tab. Press Options on the card to add the plugin’s tabs.</p>
            </div>
          )}
          ribbon={<span>Run · Build, phase 2 of 4 · open the panel</span>}
        />
      </section>
    </RunHostProvider>
  );
}
