import { useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { ApiError } from '../../api/errors.js';
import { KNOWLEDGE_VIEW_PATH, profileSource, type SourceProfileResponse } from '../../api/knowledgeShapes.js';

/** What profiling does, said before the person starts it (DES-KNOWLEDGE-DATA-001 §10.2). */
export const PROFILE_MEANS =
  'crew counts rows, nulls, distinct values and key overlap through the data gate. It keeps bands, never a value, and files what it learns as data shapes for you to review.';

const codeOf = (e: unknown): string | null => {
  const c = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
  return typeof c === 'string' ? c : null;
};

/** Why a profile did not run, in words (crew's code first; its sentence otherwise). */
export function profileRefusal(e: unknown): string {
  switch (codeOf(e)) {
    case 'not_in_knowledge':
      return 'crew has not written this source’s structure into knowledge yet. Test its connection again, then profile it.';
    case 'not_described':
      return 'Test the connection first: crew profiles a source it has described.';
    case 'profile_unsupported':
      return 'crew profiles Postgres sources on its own adapter in this release.';
    case 'source_disabled':
      return 'This source is switched off, so crew reads nothing from it.';
    case 'secret_missing':
      return 'This source’s secret is not set, so crew does not connect.';
    case 'profile_human_only':
      return 'Only a person signed in as an operator can profile a source.';
    case null:
      if (e instanceof ApiError && e.status === 404) return 'The crew on this daemon does not profile sources yet: update crew.';
      return e instanceof Error ? e.message : String(e);
    default:
      return e instanceof Error ? e.message : String(e);
  }
}

/** One relation's result in a line: its rows band, its key, its joins. */
export function relationLine(p: SourceProfileResponse, key: string): string {
  const r = p.relations.find((x) => x.key === key);
  if (r === undefined) return key;
  if (r.rows === null) return `${key}: not read (${r.error ?? 'failed'})`;
  const keys = r.columns.filter((c) => c.keyCandidate).map((c) => c.name);
  const joins = p.joins.filter((j) => j.from === key).map((j) => j.to);
  return [`${key}: ${r.rows} rows`, keys.length > 0 ? `key ${keys.join(', ')}` : null, joins.length > 0 ? `joins ${joins.join(', ')}` : null].filter((x) => x !== null).join(' · ');
}

/**
 * THE PROFILE BOX of a saved Postgres source (DES-KNOWLEDGE-DATA-001 §10.2, §19 B4): the person starts the value-free
 * profile here; crew answers what it found, in bands, and the data shapes it filed for review, with the way to the
 * review (Understand → Knowledge). Nothing becomes knowledge until the person approves a shape there.
 */
export function ProfileBox({ source }: { source: string }): React.ReactElement {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SourceProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // Another source's sheet: nothing of this one's answer stays.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [source]);
  const run = (): void => {
    setRunning(true);
    setError(null);
    profileSource(source).then(
      (r) => {
        if (!live.current || r.name !== source) return;
        setResult(r);
      },
      (e: unknown) => {
        if (live.current) setError(profileRefusal(e));
      },
    ).finally(() => {
      if (live.current) setRunning(false);
    });
  };
  const filed = result?.proposed.length ?? 0;
  return (
    <div className="wk-src-box" data-testid="source-profile">
      <p className="wk-src-okline wk-src-strong"><BarChart3 size={16} aria-hidden className="wk-src-ico" />Data shapes</p>
      <p className="wk-src-note">{PROFILE_MEANS}</p>
      <div>
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="source-profile-run" disabled={running} onClick={run}>
          {running ? 'Profiling…' : result !== null ? 'Profile again' : 'Profile this source'}
        </button>
      </div>
      {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid="source-profile-error">{error}</p>}
      {result !== null && (
        <div data-testid="source-profile-result" role="status">
          <p className="wk-src-note">
            Profiled {result.relations.length === 1 ? '1 table' : `${result.relations.length} tables`}
            {result.joins.length > 0 && `, found ${result.joins.length === 1 ? '1 join' : `${result.joins.length} joins`}`}
            {result.describes.length > 0 && `, and ${result.describes.length === 1 ? '1 code entity' : `${result.describes.length} code entities`} named like a table`}.
            {' '}{filed > 0 ? `${filed === 1 ? '1 data shape is' : `${filed} data shapes are`} waiting for your review.` : 'Nothing new to review: the same shapes are already in the queue.'}
          </p>
          <ul className="wk-src-profile-rows" data-testid="source-profile-rows">
            {result.relations.map((r) => <li key={r.key}>{relationLine(result, r.key)}</li>)}
          </ul>
          <p className="wk-src-note"><a className="wk-link wk-src-profile-link" href={KNOWLEDGE_VIEW_PATH} data-testid="source-profile-review">Review them in Understand → Knowledge map</a></p>
        </div>
      )}
    </div>
  );
}
