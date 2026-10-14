import { useEffect } from 'react';
import { editorKindOf } from '../../board/artifactMorph.js';
import { useHostChrome, useHostPanel } from '../../editors/hostApi.js';
import { HostPanel } from '../editorHost/HostPanel.js';
import { artifactKey, setArtifactSize, useArtifactSizes } from '../../store/artifactSizes.js';
import { ArtifactMorph } from '../session/ArtifactMorph.js';

/**
 * S16a-4c: a document no run is bound to opens on its project's Made list (`?open=<doc>`) in the same
 * ArtifactMorph a session uses, at full size — touch edits and versions work; there is no composer
 * (no session to send to). Esc from full screen comes back to the card (DES §7.3), whose Options hold its
 * Versions; Esc on the card, or Close, closes it back to the list.
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
  // Esc on the card closes it — not while it is full screen (that Esc is the shell's: back to the card), not while
  // its Options group is open, and not when something inside consumed it (an input, a menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only this card's own group holds the Esc (codex h4-fix r1 P2): another page's left-over group does not.
      if (useHostChrome.getState().full === key || useHostPanel.getState().group?.binding.artifactKey === key) return;
      if (useArtifactSizes.getState().sizes[key] === 'full') return; // the deep link has not opened full screen yet
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, onClose]);
  // The card's Options open its group in a panel beside it (there is no run here, so no Run tab); closing the
  // document leaves no group behind.
  const grouped = useHostPanel((s) => s.group !== null && s.group.binding.artifactKey === key);
  useEffect(() => () => { const p = useHostPanel.getState(); if (p.group?.binding.artifactKey === key) p.closeGroup(); }, [key]);
  return (
    <div data-testid="everything-made-open" data-doc={docId} data-project-id={projectId} className="wk-made-open">
      <div className="wk-made-open-bar">
        <button type="button" data-testid="everything-made-close" className="wk-host-btn" onClick={onClose}>Close · back to the list</button>
      </div>
      <div className="wk-made-open-row">
        <div className="wk-made-open-card">
          <ArtifactMorph artifactKey={key} title={title} projectId={projectId} docId={docId} composerKey={`made:${projectId}/${docId}`} kind={editorKindOf(style)} />
        </div>
        {grouped && <HostPanel />}
      </div>
    </div>
  );
}
