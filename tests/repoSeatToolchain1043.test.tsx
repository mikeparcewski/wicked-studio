import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';

/**
 * wicked-core#1043: the repo page's "Seat toolchain" card. The rows are crew's: `GET /repos` and the reply of
 * `PUT /repos/:id/seat-layers` carry core's `RepoEntry.seat_layers` (core src/repo.rs:82-108, rows from
 * src/seat_layers.rs:382-408: the layers detected in the checkout, in catalog order, `off_by` `repo` | `daemon` |
 * `operator_base` | null) and `seat_layers_off` (sorted, absent when empty). Crew's route (wicked-crew, core#1043)
 * answers the row as `GET /repos` shows it, 403 `human_operator_only` for any actor but a person, 400
 * `unknown_seat_layer`, 404 `repo_not_found`, 501 `repo_seat_layers_unsupported`.
 */

type Row = { id: string; enabled: boolean; off_by: 'repo' | 'daemon' | 'operator_base' | null };
const setRepoSeatLayers = vi.fn<(repoId: string, off: string[]) => Promise<RepoEntry>>();
/** Crew's row as `GET /repos` reads it at the press (the card builds the list from it). */
let crewRow: RepoEntry | null = null;
const listRepos = vi.fn(async () => ({ repos: crewRow === null ? [] : [crewRow] }));
/** The row shown, which is also crew's until a test says otherwise. */
function crewIs(e: RepoEntry): RepoEntry { crewRow = e; return e; }

/** A row as crew answers it for a checkout with Node.js and Python files (core's detection, catalog order). */
function entry(rows: Row[] | undefined, off: string[] = []): RepoEntry {
  return {
    id: 'shop', name: 'shop', root_path: '/srv/shop', default_branch: 'main', registered_at: 1_764_000_000, findings: [],
    ...(rows !== undefined ? { seat_layers: rows } : {}),
    ...(off.length > 0 ? { seat_layers_off: off } : {}),
  } as unknown as RepoEntry;
}
const on = (id: string): Row => ({ id, enabled: true, off_by: null });
const offBy = (id: string, by: Row['off_by']): Row => ({ id, enabled: false, off_by: by });
/** What crew answers for an off list: the same rows, `repo` on the ones turned off. */
function answer(off: string[], ids = ['node', 'python']): RepoEntry {
  const sorted = [...new Set(off)].sort();
  return entry(ids.map((id) => (sorted.includes(id) ? offBy(id, 'repo') : on(id))), sorted);
}

vi.mock('../src/api/client.js', () => ({
  api: { setRepoSeatLayers: (repoId: string, off: string[]) => setRepoSeatLayers(repoId, off), listRepos: () => listRepos() },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoSeatToolchain } = await import('../src/components/RepoSeatToolchain.js');
const { resetSeatLayerSaves } = await import('../src/store/seatLayerSaves.js');

beforeEach(() => { setRepoSeatLayers.mockReset(); listRepos.mockClear(); crewRow = null; });
afterEach(() => { cleanup(); resetSeatLayerSaves(); });

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const card = (): HTMLElement => screen.getByTestId('repo-seat-layers');
const sw = (label: string): HTMLElement => within(card()).getByRole('switch', { name: label });

describe('the Seat toolchain card shows crew\'s rows (core#1043)', () => {
  it('a switch per layer this repo can turn off, on when the layer is on', () => {
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), offBy('python', 'repo')], ['python']))} onChanged={() => {}} onReread={async () => {}} />);
    expect(within(card()).getByRole('heading', { name: 'Seat toolchain' })).toBeInTheDocument();
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Python')).toHaveAttribute('aria-checked', 'false');
  });

  it('a layer the daemon turned off shows why and has no switch', () => {
    render(<RepoSeatToolchain repo={crewIs(entry([offBy('node', 'daemon'), offBy('python', 'daemon')]))} onChanged={() => {}} onReread={async () => {}} />);
    expect(within(card()).queryAllByRole('switch')).toHaveLength(0);
    const rows = within(card()).getAllByTestId('repo-seat-layer');
    expect(rows.map((r) => r.dataset['layer'])).toEqual(['node', 'python']);
    expect(rows[0]).toHaveAttribute('data-off-by', 'daemon');
    expect(rows[0]).toHaveTextContent('Node.js');
    expect(rows[0]).toHaveTextContent('Off for every repository on this daemon');
  });

  it('the operator\'s own seat image: each layer says the image supplies the tools, with no switch', () => {
    render(<RepoSeatToolchain repo={crewIs(entry([offBy('node', 'operator_base')]))} onChanged={() => {}} onReread={async () => {}} />);
    expect(within(card()).queryAllByRole('switch')).toHaveLength(0);
    expect(within(card()).getByTestId('repo-seat-layer')).toHaveTextContent('Your own seat image supplies the tools');
  });

  it('no layer found: says so, with no switch', () => {
    render(<RepoSeatToolchain repo={crewIs(entry([]))} onChanged={() => {}} onReread={async () => {}} />);
    expect(within(card()).queryAllByRole('switch')).toHaveLength(0);
    expect(within(card()).getByTestId('repo-seat-layers-none')).toBeInTheDocument();
  });

  it('an older crew that sends no rows: no card at all', () => {
    const { container } = render(<RepoSeatToolchain repo={crewIs(entry(undefined))} onChanged={() => {}} onReread={async () => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a row crew did not shape as a layer is left out', () => {
    const odd = [on('node'), { id: 7, enabled: 'yes' }, { id: 'python', enabled: false, off_by: 'somewhere' }] as unknown as Row[];
    render(<RepoSeatToolchain repo={crewIs(entry(odd))} onChanged={() => {}} onReread={async () => {}} />);
    expect(within(card()).getAllByTestId('repo-seat-layer').map((r) => r.dataset['layer'])).toEqual(['node']);
  });
});

describe('a switch sends the full list and shows crew\'s answer (core#1043)', () => {
  it('turning Node.js off sends every layer this repo turned off, and hands on crew\'s row', async () => {
    const changed = vi.fn();
    setRepoSeatLayers.mockResolvedValueOnce(answer(['node', 'python']));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), offBy('python', 'repo')], ['python']))} onChanged={changed} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', ['node', 'python']);
    expect(changed).toHaveBeenCalledWith(answer(['node', 'python']));
  });

  it('turning Python back on sends the list without it', async () => {
    setRepoSeatLayers.mockResolvedValueOnce(answer([]));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), offBy('python', 'repo')], ['python']))} onChanged={() => {}} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', []);
  });

  it('turning one layer back on keeps every other id this repo turned off (round 1)', async () => {
    setRepoSeatLayers.mockResolvedValueOnce(answer(['go', 'rust']));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), offBy('python', 'repo'), offBy('rust', 'repo')], ['go', 'python', 'rust']))} onChanged={() => {}} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', ['go', 'rust']);
  });

  it('a layer turned off that this checkout no longer has stays in the list', async () => {
    setRepoSeatLayers.mockResolvedValueOnce(answer(['go', 'node', 'python']));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), offBy('python', 'repo')], ['go', 'python']))} onChanged={() => {}} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', ['go', 'node', 'python']);
  });

  it('while crew answers, the switches wait, and a second press sends nothing', async () => {
    let finish: (r: RepoEntry) => void = () => {};
    setRepoSeatLayers.mockImplementationOnce(() => new Promise<RepoEntry>((r) => { finish = r; }));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), on('python')]))} onChanged={() => {}} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(sw('Python')).toBeDisabled();
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenCalledTimes(1);
    await act(async () => { finish(answer(['node'])); });
    expect(sw('Python')).not.toBeDisabled();
  });

  it('the list is built from crew\'s row at the press, not the row shown (round 1 delta)', async () => {
    // The row shown is from before a change that landed (Node.js off); crew has it.
    render(<RepoSeatToolchain repo={entry([on('node'), on('python')])} onChanged={() => {}} onReread={async () => {}} />);
    crewRow = entry([offBy('node', 'repo'), on('python')], ['node']);
    setRepoSeatLayers.mockResolvedValueOnce(answer(['node', 'python']));
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', ['node', 'python']);
  });

  it('crew cannot be read at the press: nothing is sent, and it says nothing changed', async () => {
    render(<RepoSeatToolchain repo={crewIs(entry([on('node')]))} onChanged={() => {}} onReread={async () => {}} />);
    listRepos.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).not.toHaveBeenCalled();
    expect(within(card()).getByRole('alert')).toHaveTextContent('Couldn’t read this repository’s layers just now. Nothing changed.');
    expect(sw('Node.js')).not.toBeDisabled();
  });

  it('crew no longer has the repository at the press: nothing is sent', async () => {
    render(<RepoSeatToolchain repo={entry([on('node')])} onChanged={() => {}} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).not.toHaveBeenCalled();
    expect(within(card()).getByRole('alert')).toHaveTextContent('This repository is no longer registered.');
  });

  it('crew still has the repository but sends no layers for it now: nothing is sent, and it is not called unregistered (delta 2)', async () => {
    render(<RepoSeatToolchain repo={entry([on('node')])} onChanged={() => {}} onReread={async () => {}} />);
    crewRow = entry(undefined);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).not.toHaveBeenCalled();
    expect(within(card()).getByRole('alert')).toHaveTextContent('This daemon no longer reports toolchain layers for this repository. Nothing changed.');
  });

  it('a repository named like an Object property (constructor) is not taken as saving (round 1 delta)', async () => {
    const e = { ...entry([on('node')]), id: 'constructor', name: 'constructor' } as RepoEntry;
    render(<RepoSeatToolchain repo={crewIs(e)} onChanged={() => {}} onReread={async () => {}} />);
    expect(sw('Node.js')).not.toBeDisabled();
    setRepoSeatLayers.mockResolvedValueOnce({ ...answer(['node']), id: 'constructor' } as RepoEntry);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('constructor', ['node']);
  });

  it.each([
    [new ApiError(403, 'Turning a repository\'s seat layers off is a person\'s choice', { code: 'human_operator_only' }), 'Only a person can change this; an agent cannot.'],
    [new ApiError(404, '', { code: 'repo_not_found' }), 'This repository is no longer registered.'],
    [new ApiError(400, 'no seat layer `cobol` (the layers are go, java, node, python, rust)', { code: 'unknown_seat_layer', error: 'no seat layer `cobol` (the layers are go, java, node, python, rust)' }), 'This daemon has no such toolchain layer.'],
    [new ApiError(501, 'requires an engine with setRepoSeatLayersOff', { code: 'repo_seat_layers_unsupported' }), 'This daemon can’t turn toolchain layers off yet. Upgrade wicked-crew to use this.'],
  ])('a refusal is said in plain words, and nothing changes (%#)', async (err, words) => {
    const changed = vi.fn();
    setRepoSeatLayers.mockRejectedValueOnce(err);
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), on('python')]))} onChanged={changed} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(within(card()).getByRole('alert')).toHaveTextContent(words);
    expect(changed).not.toHaveBeenCalled();
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Node.js')).not.toBeDisabled();
  });

  it('no answer, or a failure crew did not name: says it could not confirm, and reads crew again before a switch frees (round 1)', async () => {
    const changed = vi.fn();
    const reread = deferredVoid();
    const onReread = vi.fn(() => reread.promise);
    setRepoSeatLayers.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), on('python')]))} onChanged={changed} onReread={onReread} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(within(card()).getByRole('alert')).toHaveTextContent('Couldn’t confirm that change. The switches show the last state this page read.');
    expect(onReread).toHaveBeenCalledTimes(1);
    expect(sw('Python')).toBeDisabled();
    await act(async () => { reread.resolve(); });
    expect(sw('Python')).not.toBeDisabled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('a 500 is not taken as nothing changed either', async () => {
    const onReread = vi.fn(async () => {});
    setRepoSeatLayers.mockRejectedValueOnce(new ApiError(500, 'boom', { error: 'boom' }));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node')]))} onChanged={() => {}} onReread={onReread} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(within(card()).getByRole('alert')).toHaveTextContent('Couldn’t confirm that change');
    expect(onReread).toHaveBeenCalledTimes(1);
  });

  it('a later change clears the last refusal', async () => {
    setRepoSeatLayers.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce(answer(['node']));
    render(<RepoSeatToolchain repo={crewIs(entry([on('node'), on('python')]))} onChanged={() => {}} onReread={async () => {}} />);
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(within(card()).getByRole('alert')).toBeInTheDocument();
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(within(card()).queryByRole('alert')).toBeNull();
  });
});
