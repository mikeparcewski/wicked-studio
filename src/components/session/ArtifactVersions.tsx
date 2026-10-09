import { useEffect, useState } from 'react';
import { getVersions, HeadMovedError, interactiveDocUrl, postFork, type VersionEntry } from '../../api/interactive.js';
import { AgeStamp } from '../AgeStamp.js';

/**
 * S16a-4b: a page, document or deck opened FULL screen in its session lists its versions, newest
 * first — "Version N · <age>", the head marked "working". Picking one is a lens, not an edit: `?v=N`
 * joins the artifact's address and the frame shows that version read-only. "Make this the working
 * version" is the one write: `POST …/api/fork {from: N, expect_head: head}`; a refusal for a moved
 * head says so and creates nothing. Compare, takes (pick / remix) and the theme tab are not carried.
 */

/** The manifest's versions (newest first) for the artifact, re-read when the head moves. */
export function useVersionList(projectId: string, docId: string, head: number | null, enabled: boolean): VersionEntry[] | null {
  const [list, setList] = useState<VersionEntry[] | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getVersions(projectId, docId)
      .then((m) => { if (!cancelled) setList([...m.versions].sort((a, b) => b.version - a.version)); })
      .catch(() => { if (!cancelled) setList(null); });
    return () => { cancelled = true; };
  }, [projectId, docId, head, enabled]);
  return list;
}

/** The version the address asks to look at, when it is a real one that is not the head; else null. */
export function lensVersion(pinned: number | null, head: number | null, list: readonly VersionEntry[] | null): number | null {
  if (pinned === null || list === null || pinned === head) return null;
  return list.some((v) => v.version === pinned) ? pinned : null;
}

export function ArtifactVersions({ projectId, docId, head, list, lens, onLook, onRestored }: {
  projectId: string;
  docId: string;
  head: number | null;
  list: readonly VersionEntry[] | null;
  /** The version being looked at (a real, non-head one), or null. */
  lens: number | null;
  /** Look at a version, or back at the working one (`null`). */
  onLook: (version: number | null) => void;
  /** A restore landed: the new head. */
  onRestored: (newHead: number) => void;
}): React.ReactElement {
  const [line, setLine] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const restore = async (version: number): Promise<void> => {
    if (busy || head === null) return;
    setBusy(true);
    try {
      const r = await postFork(projectId, docId, version, undefined, head);
      setLine({ bad: false, text: `Version ${version} is the working version again — as version ${r.version}.` });
      onRestored(r.version);
    } catch (e) {
      setLine(e instanceof HeadMovedError
        ? { bad: true, text: `Not restored — version ${e.head} landed since. Look again.` }
        : { bad: true, text: `Not restored — ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside data-testid="artifact-versions" aria-label="Versions" className="wk-artifact-versions">
      <p className="wk-artifact-versions-title">Versions</p>
      {list === null && <p className="wk-session-grey">Reading the versions…</p>}
      <ol className="wk-artifact-versions-list">
        {(list ?? []).map((v) => {
          const working = v.version === head;
          const looking = v.version === lens;
          return (
            <li key={v.version} data-testid="artifact-version-row" data-version={v.version} data-working={working ? 'true' : 'false'} data-looking={looking ? 'true' : 'false'} className={`wk-artifact-version${looking ? ' wk-artifact-version--on' : ''}`}>
              <button type="button" data-testid="artifact-version-lens" aria-pressed={looking || (lens === null && working)} onClick={() => onLook(working ? null : v.version)} className="wk-since-toggle">
                Version {v.version}
              </button>
              {' · '}<AgeStamp at={Date.parse(v.created_at) || null} now={Date.now()} testId="artifact-version-age" />
              {working && <span className="wk-session-grey"> · working</span>}
              {/* studio#616: the age and the restore arm apart ("18h · Make this the working version"). */}
              {!working && <>{' · '}
                <button type="button" data-testid="artifact-version-restore" disabled={busy || head === null} onClick={() => void restore(v.version)} className="wk-since-toggle">
                  Make this the working version
                </button>
              </>}
            </li>
          );
        })}
      </ol>
      {line !== null && <p data-testid="artifact-version-line" className={`wk-artifact-line${line.bad ? ' wk-artifact-line--bad' : ''}`}>{line.text}</p>}
    </aside>
  );
}

/** The lens: the picked version, read-only in the same sandboxed frame — nothing picks, nothing edits. */
export function VersionLens({ projectId, docId, version, onBack }: { projectId: string; docId: string; version: number; onBack: () => void }): React.ReactElement {
  return (
    <div className="wk-artifact-body" data-testid="artifact-version-frame" data-version={version}>
      {/* studio#616: the lens line carries a CONTROL — its own class, stacked above the frame and taking
          the pointer (the read-only hint style is `pointer-events: none` and paints under the frame). */}
      <p data-testid="artifact-lens-line" className="wk-artifact-hint wk-artifact-hint--control">
        Looking at version {version} — <button type="button" data-testid="artifact-lens-back" onClick={onBack} className="wk-since-toggle">Back to the working version</button>
      </p>
      <iframe title={`${docId} version ${version}`} className="wk-artifact-frame" sandbox="allow-scripts" src={interactiveDocUrl(projectId, docId, version)} />
    </div>
  );
}
