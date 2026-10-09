import { useEffect } from 'react';
import { editorKindOf } from '../../board/artifactMorph.js';
import { artifactKey, setArtifactSize, useArtifactSizes } from '../../store/artifactSizes.js';
import { ArtifactMorph } from '../session/ArtifactMorph.js';

/**
 * S16a-4c: a document no run is bound to opens on its project's Made list (`?open=<doc>`) in the same
 * ArtifactMorph a session uses, at full size — touch edits and versions work; there is no composer
 * (no session to send to). Shrinking it (Esc, ⤡) closes it back to the list.
 */
export function MadeOpen({ projectId, docId, title, style, onClose }: {
  projectId: string;
  docId: string;
  title: string;
  /** The document's recorded style (`doc` / `ppt` / …), for the editor kind. */
  style: string | null;
  onClose: () => void;
}): React.ReactElement {
  const key = artifactKey(projectId, docId, 'made');
  useEffect(() => {
    setArtifactSize(key, 'full');
    return () => setArtifactSize(key, 'inline');
  }, [key]);
  const size = useArtifactSizes((s) => s.sizes[key]);
  // Opened full; any shrink is a close (there is no thread to stand beside).
  useEffect(() => { if (size !== undefined && size !== 'full') onClose(); }, [size, onClose]);
  return (
    <div data-testid="everything-made-open" data-doc={docId} data-project-id={projectId}>
      <ArtifactMorph artifactKey={key} title={title} projectId={projectId} docId={docId} composerKey={`made:${projectId}/${docId}`} kind={editorKindOf(style)} />
    </div>
  );
}
