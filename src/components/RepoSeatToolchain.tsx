import { useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry } from '../api/types.js';
import { SEAT_LAYERS_UNSURE, nextSeatLayersOff, seatLayerName, seatLayersOf, seatLayersOffOf, seatLayersRefusal, type SeatLayerRow } from '../api/seatLayers.js';
import { useSeatLayerSaves } from '../store/seatLayerSaves.js';
import { SectionTitle } from './ui/index.js';
import { Switch } from './ui/Switch.js';

/**
 * wicked-core#1043: the repo page's "Seat toolchain" card. One row per toolchain layer the engine found in the
 * checkout (crew's `seat_layers`): a switch when this repo's own switch decides it, else the reason it is off (the
 * daemon turned every layer off, or the operator's own seat image supplies the tools) and no switch. A switch sends
 * the repo's full off list (`PUT /repos/:id/seat-layers`) and hands crew's answer, the repo's row as `GET /repos`
 * shows it, to the page. Nothing renders on a crew that sends no rows.
 *
 * The full list is built from the row shown, so that row must be crew's latest (round 1). One change per repository
 * is in flight at a time, held in a store the card's unmount does not reset; a refusal crew names changed nothing;
 * any other failure may have landed, so the page reads crew again before the switches free.
 */
export function RepoSeatToolchain({ repo, onChanged, onReread }: {
  repo: RepoEntry;
  /** Crew's answer: the repo's row as `GET /repos` shows it. */
  onChanged: (repo: RepoEntry) => void;
  /** Read the repo's row from crew again (the outcome of a change is not known). */
  onReread: () => Promise<void>;
}): React.ReactElement | null {
  const saving = useSeatLayerSaves((s) => s.saving[repo.id] ?? null);
  const [said, setSaid] = useState<string | null>(null);
  const rows = seatLayersOf(repo);
  if (rows === null) return null;

  async function flip(row: SeatLayerRow, turnOn: boolean): Promise<void> {
    if (rows === null) return;
    const saves = useSeatLayerSaves.getState();
    if (!saves.begin(repo.id, row.id)) return;
    setSaid(null);
    try {
      onChanged(await api.setRepoSeatLayers(repo.id, nextSeatLayersOff(seatLayersOffOf(repo, rows), row.id, turnOn)));
    } catch (e) {
      const refused = seatLayersRefusal(e);
      setSaid(refused ?? SEAT_LAYERS_UNSURE);
      if (refused === null) await onReread().catch(() => undefined);
    } finally {
      saves.end(repo.id);
    }
  }

  return (
    <section className="wk-card" data-testid="repo-seat-layers" aria-labelledby="repo-seat-layers-title">
      <div id="repo-seat-layers-title"><SectionTitle>Seat toolchain</SectionTitle></div>
      <p className="wk-rp-note">Toolchain layers added to this repository’s seats, picked from its files. Turning one off stops adding it to the next jobs’ seats; tools the seat image already has stay.</p>
      {rows.length === 0
        ? <p className="wk-rp-note" data-testid="repo-seat-layers-none">No toolchain was found in its files, so none is added to its seats.</p>
        : (
          <fieldset className="wk-rp-layers" disabled={saving !== null}>
            <legend className="sr-only">Toolchain layers</legend>
            <ul>
              {rows.map((row) => (
                <li key={row.id} data-testid="repo-seat-layer" data-layer={row.id} data-off-by={row.off_by ?? 'none'}>
                  {row.off_by === 'daemon' || row.off_by === 'operator_base'
                    ? (
                      <div className="wk-rp-layer-fixed">
                        <b>{seatLayerName(row.id)}</b>
                        <p>{row.off_by === 'daemon'
                          ? 'Off for every repository on this daemon.'
                          : 'Your own seat image supplies the tools, so this layer is not added.'}</p>
                      </div>
                    )
                    : (
                      <Switch
                        label={seatLayerName(row.id)}
                        checked={row.enabled}
                        disabled={saving === row.id ? 'Saving…' : null}
                        onChange={(v) => { void flip(row, v); }}
                        data-testid="repo-seat-layer-switch"
                      />
                    )}
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      {said !== null && <p className="wk-field-note wk-field-note--bad" role="alert" data-testid="repo-seat-layers-error">{said}</p>}
    </section>
  );
}
