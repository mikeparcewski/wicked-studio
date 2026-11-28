import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError, apiStatus, isRouteAbsent, plainRefusal } from '../api/errors.js';
import type { RepoEntry } from '../api/types.js';
import { layerName, layerWord, seatBaseOf, seatLayersOf } from '../board/repoSeat.js';
import { SectionTitle } from './ui/index.js';

interface Props {
  repo: RepoEntry;
  /** Begin a save; the function returned hands the engine's entry (its single writer's answer) to the page, which
   *  shows it only if no newer save was begun since (the card remounts with its tab, so the page keeps the order). */
  beginSave: () => (entry: RepoEntry) => void;
}

/** What a failed save says: the engine's own words for a reference it refuses, else the plain sentence. */
function saveError(e: unknown): string {
  const refused = plainRefusal(e, ['seat_base_invalid', 'repo_not_found']);
  if (refused !== null) return refused;
  if (apiStatus(e) === 501 || isRouteAbsent(e)) return 'This daemon cannot set a repository’s seat image yet. Update it, then try again.';
  return e instanceof ApiError ? e.message : 'That didn’t save. Try again.';
}

/**
 * (crew#1984, core#1043) A repository's seat image: its own seat base image (a local image the container runtime
 * already has; never pulled), set or cleared here, and the toolchain layers its seats get. The page keys this by
 * repository id, so a draft typed for one repository is never shown on another.
 */
export function RepoSeatBase({ repo, beginSave }: Props): React.ReactElement {
  const base = seatBaseOf(repo);
  const layers = seatLayersOf(repo);
  // `null` until a person types: an untouched field follows the repository's base as the page re-reads it.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest save lands its answer (a double click, or Save then Clear).
  const seq = useRef(0);

  async function save(image: string | null): Promise<void> {
    const mine = ++seq.current;
    const land = beginSave();
    setSaving(true);
    setError(null);
    try {
      const entry = await api.setRepoSeatBase(repo.id, image);
      if (seq.current !== mine) return;
      land(entry);
      // The field follows the base again (it could not be edited while the save was in flight).
      setDraft(null);
    } catch (e: unknown) {
      // Nothing was written: the draft stays as typed, with why.
      if (seq.current === mine) setError(saveError(e));
    } finally {
      if (seq.current === mine) setSaving(false);
    }
  }

  const shown = draft ?? base ?? '';
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
        onSubmit={(ev) => { ev.preventDefault(); if (changed && !saving) void save(trimmed === '' ? null : trimmed); }}
      >
        <label htmlFor={`seat-base-${repo.id}`}>Its own seat base image</label>
        <input
          id={`seat-base-${repo.id}`}
          className="wk-field"
          data-testid="repo-seat-base-input"
          value={shown}
          readOnly={saving}
          placeholder="e.g. my-team/seat-base:go1.23"
          spellCheck={false}
          autoComplete="off"
          maxLength={255}
          onChange={(ev) => { if (!saving) setDraft(ev.target.value); }}
        />
        <div className="wk-rp-seatform-actions">
          <button type="submit" className="wk-btn wk-btn--secondary" data-testid="repo-seat-base-save" disabled={!changed || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {base !== null && (
            <button type="button" className="wk-btn wk-btn--quiet" data-testid="repo-seat-base-clear" disabled={saving} onClick={() => void save(null)}>
              Use the default
            </button>
          )}
        </div>
        <p>
          A local image this computer’s container runtime already has. Its jobs’ seats are built on it instead of the
          default, from the next step on, and it is never downloaded: a step on an image the runtime lacks stops and says so.
        </p>
        {error !== null && <p role="alert" className="wk-rp-seatform-err" data-testid="repo-seat-base-error">{error}</p>}
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
