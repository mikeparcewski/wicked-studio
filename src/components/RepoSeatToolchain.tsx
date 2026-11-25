import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry } from '../api/types.js';
import { nextSeatLayersOff, seatLayerName, seatLayersOf, seatLayersOffOf, seatLayersRefusal, type SeatLayerRow } from '../api/seatLayers.js';
import { SectionTitle } from './ui/index.js';
import { Switch } from './ui/Switch.js';

/**
 * wicked-core#1043: the repo page's "Seat toolchain" card. One row per toolchain layer the engine found in the
 * checkout (crew's `seat_layers`): a switch when this repo's own switch decides it, else the reason it is off (the
 * daemon turned every layer off, or the operator's own seat image supplies the tools) and no switch. A switch sends
 * the repo's full off list (`PUT /repos/:id/seat-layers`) and hands crew's answer, the repo's row as `GET /repos`
 * shows it, to the page. A refusal is said in plain words and changes nothing. Nothing renders on a crew that sends
 * no rows.
 */
export function RepoSeatToolchain({ repo, onChanged }: { repo: RepoEntry; onChanged: (repo: RepoEntry) => void }): React.ReactElement | null {
  const [saving, setSaving] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // A second press while crew answers sends nothing (the fieldset is disabled too, a render later).
  const busy = useRef(false);
  const rows = seatLayersOf(repo);
  if (rows === null) return null;

  async function flip(row: SeatLayerRow, turnOn: boolean): Promise<void> {
    if (busy.current || rows === null) return;
    busy.current = true;
    setSaving(row.id);
    setRefused(null);
    const forRepo = repo.id;
    try {
      const next = await api.setRepoSeatLayers(forRepo, nextSeatLayersOff(seatLayersOffOf(repo, rows), row.id, turnOn));
      onChanged(next);
    } catch (e) {
      setRefused(seatLayersRefusal(e));
    } finally {
      busy.current = false;
      setSaving(null);
    }
  }

  return (
    <section className="wk-card" data-testid="repo-seat-layers" aria-labelledby="repo-seat-layers-title">
      <div id="repo-seat-layers-title"><SectionTitle>Seat toolchain</SectionTitle></div>
      <p className="wk-rp-note">The tools put in this repository’s seats, picked from its files. A layer turned off is left out of the next jobs’ seats.</p>
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
      {refused !== null && <p className="wk-field-note wk-field-note--bad" role="alert" data-testid="repo-seat-layers-error">{refused}</p>}
    </section>
  );
}
