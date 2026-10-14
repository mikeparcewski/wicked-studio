import { useState } from 'react';
import { registerHostTab, type HostTabContext } from '../../editors/hostApi.js';
import { ArtifactVersions, useVersionList, VersionLens } from '../session/ArtifactVersions.js';
import { ChecksPanel } from '../session/ChecksPanel.js';

/**
 * The host's own tabs (HOST-API §4): Versions and Checks, for an interactive document (they read interactive's
 * version list and reviews). Review is H4's (the deck review as the host review capability).
 */

function VersionsTab({ ctx }: { ctx: HostTabContext }): React.ReactElement {
  const { projectId, docId = '' } = ctx.binding;
  const [lens, setLens] = useState<number | null>(null);
  const list = useVersionList(projectId, docId, ctx.shown, true);
  return (
    <div className="wk-htab-versions">
      {lens !== null && <VersionLens projectId={projectId} docId={docId} version={lens} onBack={() => setLens(null)} />}
      <ArtifactVersions projectId={projectId} docId={docId} head={ctx.shown} list={list} lens={lens} onLook={setLens}
        onRestored={(h) => { setLens(null); ctx.changed(h, 'fork'); }} />
    </div>
  );
}

registerHostTab({ id: 'versions', label: 'Versions', needs: 'versions', render: (ctx) => <VersionsTab ctx={ctx} /> });
registerHostTab({
  id: 'checks', label: 'Checks', needs: 'checks',
  render: (ctx) => (ctx.shown !== null && ctx.shown >= 1 ? <ChecksPanel projectId={ctx.binding.projectId} docId={ctx.binding.docId ?? ''} head={ctx.shown} pointAt={ctx.pointAt} /> : <p className="wk-artifact-hint">No version to check yet.</p>),
});
