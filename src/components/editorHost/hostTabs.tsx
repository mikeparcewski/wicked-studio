import { useRef, useState } from 'react';
import { useArtifactAddress } from '../session/ArtifactAddress.js';
import { registerHostTab, type HostTabContext } from '../../editors/hostApi.js';
import { ArtifactVersions, useVersionList, VersionLens } from '../session/ArtifactVersions.js';
import { ChecksPanel } from '../session/ChecksPanel.js';

/**
 * The host's own tabs (HOST-API §4): Versions and Checks, for an interactive document (they read interactive's
 * version list and reviews). Review is H4's (the deck review as the host review capability).
 */

function VersionsTab({ ctx }: { ctx: HostTabContext }): React.ReactElement {
  const { projectId, docId = '' } = ctx.binding;
  // The lens is the address's (S16a-4b): `?v=N` on the artifact's full address, so it can be bookmarked; the card
  // shows it full screen. Without an address (the test page) it stays local, shown here.
  const address = useArtifactAddress();
  // The address as it is when a restore lands, not when it started (codex h2-r19 P2).
  const addressRef = useRef(address);
  addressRef.current = address;
  const key = ctx.binding.artifactKey;
  const [local, setLocal] = useState<number | null>(null);
  const lens = address !== null ? (address.routeKey === key ? address.routeVersion : null) : local;
  const look = (v: number | null): void => { if (address !== null) address.pickVersion(key, v, 'push'); else setLocal(v); };
  const list = useVersionList(projectId, docId, ctx.shown, true);
  return (
    <div className="wk-htab-versions">
      {address === null && lens !== null && <VersionLens projectId={projectId} docId={docId} version={lens} onBack={() => setLocal(null)} />}
      <ArtifactVersions projectId={projectId} docId={docId} head={ctx.shown} list={list} lens={lens} onLook={look}
        onRestored={(h) => { const a = addressRef.current; if (a === null) setLocal(null); else if (a.routeKey === key && a.routeVersion !== null) a.pickVersion(key, null, 'replace'); ctx.changed(h, 'fork'); }} />
    </div>
  );
}

registerHostTab({ id: 'versions', label: 'Versions', needs: 'versions', render: (ctx) => <VersionsTab ctx={ctx} /> });
registerHostTab({
  id: 'checks', label: 'Checks', needs: 'checks',
  render: (ctx) => (ctx.shown !== null && ctx.shown >= 1 ? <ChecksPanel projectId={ctx.binding.projectId} docId={ctx.binding.docId ?? ''} head={ctx.shown} pointAt={ctx.pointAt} /> : <p className="wk-host-note">No version to check yet.</p>),
});
