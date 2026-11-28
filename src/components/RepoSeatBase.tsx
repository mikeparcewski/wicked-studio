import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError, apiStatus, isRouteAbsent, plainRefusal } from '../api/errors.js';
import type { RepoEntry } from '../api/types.js';
import { layerName, layerWord, seatBaseOf, seatLayersOf } from '../board/repoSeat.js';
import { SectionTitle } from './ui/index.js';

/** What a failed save says: the engine's own words for a reference it refuses, else the plain sentence. */
function saveError(e: unknown): string {
  const refused = plainRefusal(e, ['seat_base_invalid', 'repo_not_found']);
  if (refused !== null) return refused;
  if (apiStatus(e) === 501 || isRouteAbsent(e)) return 'This daemon cannot set a repository’s seat image yet. Update it, then try again.';
  return e instanceof ApiError ? e.message : 'That didn’t save. Try again.';
}

/** What the card says when a save went in but the page could not read the repository back. */
const SAVED_NOT_READ = 'Saved. The page could not read it back: reload to see it.';

/** (crew#1984) A repository's seat image edit: the typed draft (`null` until a person types, so the field follows the
 *  repository's base), whether a save is in flight, and why the last one failed. */
export interface SeatEdit {
  draft: string | null;
  saving: boolean;
  error: string | null;
  setDraft: (draft: string) => void;
  save: (image: string | null) => void;
}

interface EditState { repoId: string; visit: number; draft: string | null; saving: boolean; error: string | null }

/**
 * (crew#1984, DES on studio#1513) The seat image edit for the repository a page shows. It lives in the page, not the
 * card, so leaving the Settings tab keeps the draft, the in-flight block and a late refusal; it starts fresh for each
 * repository opened. A save never shows crew's answer itself: when it settles (saved or refused) the page reads the
 * repository again (`reRead`), so what is shown is what crew holds, through the page's one read fence.
 */
export function useSeatEdit(repoId: string, reRead: (repoId: string) => Promise<boolean>): SeatEdit {
  const visit = useRef({ repoId, n: 0 });
  if (visit.current.repoId !== repoId) visit.current = { repoId, n: visit.current.n + 1 };
  const fresh = (): EditState => ({ repoId, visit: visit.current.n, draft: null, saving: false, error: null });
  const [state, setState] = useState<EditState>(fresh);
  // The opening a save is in flight for: a second press before the re-render shows "Saving…" sends nothing.
  const busy = useRef<number | null>(null);
  const cur = state.repoId === repoId && state.visit === visit.current.n ? state : fresh();
  if (cur !== state) setState(cur);

  /** Apply `f` only while the same opening of the same repository is shown. */
  const update = (forVisit: number, f: (s: EditState) => EditState): void =>
    setState((s) => (s.repoId === repoId && s.visit === forVisit ? f(s) : s));

  return {
    ...cur,
    setDraft: (draft) => update(cur.visit, (s) => (s.saving ? s : { ...s, draft })),
    save: (image) => {
      if (cur.saving || busy.current === cur.visit) return;
      const forRepo = repoId;
      const forVisit = cur.visit;
      busy.current = forVisit;
      update(forVisit, (s) => ({ ...s, saving: true, error: null }));
      void (async () => {
        let error: string | null = null;
        try { await api.setRepoSeatBase(forRepo, image); } catch (e: unknown) { error = saveError(e); }
        // Saved or refused, crew's state is read again; a failed read keeps the repository shown. After a save that
        // went in, that would show the old base as if nothing was saved: the draft stays and the card says so.
        let readBack = false;
        try { readBack = await reRead(forRepo); } catch { /* not read */ }
        if (error === null && !readBack) error = SAVED_NOT_READ;
        if (busy.current === forVisit) busy.current = null;
        update(forVisit, (s) => ({ ...s, saving: false, error, draft: error === null ? null : s.draft }));
      })();
    },
  };
}

interface Props {
  repo: RepoEntry;
  /** The page's edit for this repository ({@link useSeatEdit}). */
  edit: SeatEdit;
}

/**
 * (crew#1984, core#1043) A repository's seat image: its own seat base image (a local image the container runtime
 * already has; never pulled), set or cleared here, and the toolchain layers its seats get. It shows the page's
 * repository and the page's edit state, so it can remount with its tab without losing either.
 */
export function RepoSeatBase({ repo, edit }: Props): React.ReactElement {
  const base = seatBaseOf(repo);
  const layers = seatLayersOf(repo);
  const shown = edit.draft ?? base ?? '';
  const trimmed = shown.trim();
  const changed = trimmed !== (base ?? '');
  return (
    <section className="wk-card" data-testid="repo-seat-image">
      <SectionTitle>Seat image</SectionTitle>
      <dl className="wk-rp-kv">
        <dt>Base image</dt>
        <dd className="wk-rp-seatbase-now" data-testid="repo-seat-base-now">{base ?? 'This daemon’s default'}</dd>
      </dl>
      <form
        className="wk-rp-seatform"
        onSubmit={(ev) => { ev.preventDefault(); if (changed && !edit.saving) edit.save(trimmed === '' ? null : trimmed); }}
      >
        <label htmlFor={`seat-base-${repo.id}`}>Its own seat base image</label>
        <input
          id={`seat-base-${repo.id}`}
          className="wk-field"
          data-testid="repo-seat-base-input"
          value={shown}
          readOnly={edit.saving}
          placeholder="e.g. my-team/seat-base:go1.23"
          spellCheck={false}
          autoComplete="off"
          maxLength={255}
          onChange={(ev) => edit.setDraft(ev.target.value)}
        />
        <div className="wk-rp-seatform-actions">
          <button type="submit" className="wk-btn wk-btn--secondary" data-testid="repo-seat-base-save" disabled={!changed || edit.saving}>
            {edit.saving ? 'Saving…' : 'Save'}
          </button>
          {base !== null && (
            <button type="button" className="wk-btn wk-btn--quiet" data-testid="repo-seat-base-clear" disabled={edit.saving} onClick={() => edit.save(null)}>
              Use the default
            </button>
          )}
        </div>
        <p>
          A local image this computer’s container runtime already has. Its jobs’ seats are built on it instead of the
          default from the next step on, unless this daemon pins its own image for that agent. It is never downloaded:
          a step on an image the runtime lacks stops and says so.
        </p>
        {edit.error !== null && <p role="alert" className="wk-rp-seatform-err" data-testid="repo-seat-base-error">{edit.error}</p>}
      </form>
      {layers !== null && layers.length > 0 && (
        <dl className="wk-rp-kv wk-rp-layers" data-testid="repo-seat-layers">
          {layers.map((l) => (
            <div key={l.id} className="wk-rp-layer" data-layer={l.id} data-enabled={l.enabled}>
              <dt>{layerName(l.id)}</dt>
              <dd>{layerWord(l)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
