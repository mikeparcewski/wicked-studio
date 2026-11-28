import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import { RepoSeatBase } from '../src/components/RepoSeatBase.js';
import { layerWord, seatBaseOf, seatLayersOf } from '../src/board/repoSeat.js';

/**
 * crew#1984 (wicked-core#2023, core#1043 part 3): a repository's seat image on its Settings tab.
 *
 * The entries are the shape crew's `PUT /repos/:id/seat-base` answers with: the engine's own `RepoEntry` as
 * `Core::set_repo_seat_base_image` serializes it (wicked-core `src/repo.rs` `RepoEntry`: `seat_base_image` skipped
 * when unset, `seat_layers` rows `{id, enabled, off_by}` from `seat_layers::rows`; crew passes it through,
 * `routes.ts` PUT seat-base, wicked-crew `packages/crew/tests/repo-seat-base-1984.test.ts`).
 */
function entry(base: string | null, id = 'shop'): RepoEntry {
  return {
    id,
    name: id,
    root_path: `/repos/${id}`,
    default_branch: 'main',
    registered_at: 0,
    graph_key: `${id}-1a2b3c`,
    code_graph_db: `/state/repo-graphs/${id}-1a2b3c/estate.db`,
    findings: [],
    seat_layers: [
      { id: 'go', enabled: base === null, off_by: base === null ? null : 'repo_base' },
      { id: 'rust', enabled: base === null, off_by: base === null ? null : 'repo_base' },
    ],
    ...(base === null ? {} : { seat_base_image: base }),
  } as unknown as RepoEntry;
}

/** crew's 400 for a reference the engine refuses: its own words (wicked-core `valid_image_ref`). */
const refusal = (image: string) =>
  `\`${image}\` is not a seat base image reference: use a local image name such as \`wicked-seat-base:rust\` ` +
  '(lowercase letters, digits and . _ / : @ -, starting with a letter or digit, at most 255 characters)';

interface Sent { method: string; path: string; body: Record<string, unknown> }
let sent: Sent[] = [];
let answer: (body: Record<string, unknown>) => Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  answer = (b) => Promise.resolve(json(200, entry(typeof b['image'] === 'string' ? b['image'] : null)));
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = init?.body === undefined ? {} : JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ method, path, body });
    return answer(body);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const input = () => screen.getByTestId('repo-seat-base-input') as HTMLInputElement;
const save = () => screen.getByTestId('repo-seat-base-save') as HTMLButtonElement;

describe('repository seat image (crew#1984)', () => {
  it('shows the repository’s base and why each layer is not added', () => {
    render(<RepoSeatBase repo={entry('acme/seat-base:go')} beginSave={() => () => {}} />);
    expect(screen.getByTestId('repo-seat-base-now').textContent).toBe('acme/seat-base:go');
    expect(input().value).toBe('acme/seat-base:go');
    const rows = screen.getByTestId('repo-seat-layers').textContent ?? '';
    expect(rows).toContain('Go');
    expect(rows).toContain('Rust');
    expect(rows).toContain('this repository’s seat base image is its toolchain');
  });

  it('with no base: the default, and the layers its seats get', () => {
    render(<RepoSeatBase repo={entry(null)} beginSave={() => () => {}} />);
    expect(screen.getByTestId('repo-seat-base-now').textContent).toBe('This daemon’s default');
    expect(screen.queryByTestId('repo-seat-base-clear')).toBeNull();
    expect(screen.getByTestId('repo-seat-layers').textContent).toContain('Added to its seats');
    expect(save().disabled).toBe(true);
  });

  it('STALE READS: Save sends the trimmed reference and shows the engine’s post-write entry', async () => {
    const onSaved = vi.fn();
    const { rerender } = render(<RepoSeatBase repo={entry(null)} beginSave={() => onSaved} />);
    fireEvent.change(input(), { target: { value: '  acme/seat-base:go  ' } });
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ method: 'PUT', path: '/repos/shop/seat-base', body: { image: 'acme/seat-base:go' } }]);
    expect(onSaved.mock.calls[0]![0]).toMatchObject({ id: 'shop', seat_base_image: 'acme/seat-base:go' });
    // The page shows the entry it was handed; the field follows it.
    rerender(<RepoSeatBase repo={onSaved.mock.calls[0]![0] as RepoEntry} beginSave={() => onSaved} />);
    expect(input().value).toBe('acme/seat-base:go');
    expect(save().disabled).toBe(true);
  });

  it('“Use the default” clears it with null', async () => {
    const onSaved = vi.fn();
    const { rerender } = render(<RepoSeatBase repo={entry('acme/seat-base:go')} beginSave={() => onSaved} />);
    fireEvent.click(screen.getByTestId('repo-seat-base-clear'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sent[0]!.body).toEqual({ image: null });
    expect(seatBaseOf(onSaved.mock.calls[0]![0] as RepoEntry)).toBeNull();
    rerender(<RepoSeatBase repo={onSaved.mock.calls[0]![0] as RepoEntry} beginSave={() => onSaved} />);
    expect(input().value).toBe('');
  });

  it('PARTIAL FAILURE: a refused reference shows the engine’s words, keeps the draft, and saves nothing', async () => {
    answer = (b) => Promise.resolve(json(400, { code: 'seat_base_invalid', error: refusal(String(b['image'])) }));
    const onSaved = vi.fn();
    render(<RepoSeatBase repo={entry(null)} beginSave={() => onSaved} />);
    fireEvent.change(input(), { target: { value: '--privileged' } });
    fireEvent.click(save());
    const err = await screen.findByTestId('repo-seat-base-error');
    expect(err.textContent).toBe(refusal('--privileged'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(input().value).toBe('--privileged');
    expect(save().disabled).toBe(false);
  });

  // crew 0.21.0's 501 (routes.ts PUT seat-base), and fastify's 404 for a route an older crew lacks.
  it.each([
    ['501', 501, { code: 'repo_seat_base_unsupported', error: 'Setting a repository’s seat base image requires an engine with setRepoSeatBaseImage; upgrade wicked-core-ts.' }],
    ['no route', 404, { message: 'Route PUT:/api/v1/repos/shop/seat-base not found', error: 'Not Found', statusCode: 404 }],
  ])('an older daemon (%s) says to update it', async (_name, status, body) => {
    answer = () => Promise.resolve(json(status, body));
    render(<RepoSeatBase repo={entry(null)} beginSave={() => () => {}} />);
    fireEvent.change(input(), { target: { value: 'acme/seat-base:go' } });
    fireEvent.click(save());
    expect((await screen.findByTestId('repo-seat-base-error')).textContent).toMatch(/cannot set a repository’s seat image yet/u);
  });

  it('a repository crew no longer knows (404 repo_not_found) shows crew’s words, not upgrade advice', async () => {
    const words = 'no registered repo "shop"';
    answer = () => Promise.resolve(json(404, { code: 'repo_not_found', error: words }));
    render(<RepoSeatBase repo={entry(null)} beginSave={() => () => {}} />);
    fireEvent.change(input(), { target: { value: 'acme/seat-base:go' } });
    fireEvent.click(save());
    const err = (await screen.findByTestId('repo-seat-base-error')).textContent ?? '';
    expect(err).toContain(words);
    expect(err).not.toMatch(/cannot set a repository’s seat image yet/u);
  });

  it('STALE READS: an untouched field follows the repository’s base as the page re-reads it; an edit is kept', () => {
    const { rerender } = render(<RepoSeatBase repo={entry('acme/seat-base:go')} beginSave={() => () => {}} />);
    rerender(<RepoSeatBase repo={entry('acme/seat-base:java')} beginSave={() => () => {}} />);
    expect(input().value).toBe('acme/seat-base:java');
    expect(save().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: 'acme/seat-base:rust' } });
    rerender(<RepoSeatBase repo={entry('acme/seat-base:node')} beginSave={() => () => {}} />);
    expect(input().value).toBe('acme/seat-base:rust');
    expect(save().disabled).toBe(false);
  });

  it('UNTRUSTED TEXT OUT: a reference and a refusal are shown as text, never as markup', async () => {
    const odd = '<b id="x">bold</b>';
    answer = () => Promise.resolve(json(400, { code: 'seat_base_invalid', error: refusal(odd) }));
    render(<RepoSeatBase repo={entry(odd)} beginSave={() => () => {}} />);
    expect(screen.getByTestId('repo-seat-base-now').textContent).toBe(odd);
    expect(document.getElementById('x')).toBeNull();
    fireEvent.change(input(), { target: { value: `${odd} ` } });
    fireEvent.change(input(), { target: { value: 'z' } });
    fireEvent.click(save());
    await screen.findByTestId('repo-seat-base-error');
    expect(document.getElementById('x')).toBeNull();
  });

  it('IDENTITY REUSE: keyed by repository, a draft typed on one is not shown on another', () => {
    const { rerender } = render(<RepoSeatBase key="shop" repo={entry(null)} beginSave={() => () => {}} />);
    fireEvent.change(input(), { target: { value: 'acme/seat-base:go' } });
    rerender(<RepoSeatBase key="shipping" repo={entry(null, 'shipping')} beginSave={() => () => {}} />);
    expect(input().value).toBe('');
  });

  it('a save in flight blocks another (no second request), then shows its answer', async () => {
    const resolvers: Array<(r: Response) => void> = [];
    answer = () => new Promise<Response>((res) => { resolvers.push(res); });
    const onSaved = vi.fn();
    render(<RepoSeatBase repo={entry('acme/seat-base:go')} beginSave={() => onSaved} />);
    fireEvent.change(input(), { target: { value: 'acme/seat-base:java' } });
    fireEvent.click(save());
    expect(save().textContent).toBe('Saving…');
    // The field cannot be edited while the save is in flight, so its answer never discards an edit.
    expect(input().readOnly).toBe(true);
    fireEvent.change(input(), { target: { value: 'acme/seat-base:typed-meanwhile' } });
    expect(input().value).toBe('acme/seat-base:java');
    fireEvent.click(screen.getByTestId('repo-seat-base-clear'));
    fireEvent.submit(input().form!);
    expect(resolvers).toHaveLength(1);
    await act(async () => { resolvers[0]!(json(200, entry('acme/seat-base:java'))); await Promise.resolve(); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(seatBaseOf(onSaved.mock.calls[0]![0] as RepoEntry)).toBe('acme/seat-base:java');
  });
});

describe('repoSeat bag reads', () => {
  it('reads the fields an older api-types lacks, skipping malformed rows', () => {
    const odd = { ...entry(null), seat_layers: [{ id: 'go', enabled: true, off_by: null }, { id: 3 }, null, { id: 'x', enabled: 'yes' }] } as unknown as RepoEntry;
    expect(seatLayersOf(odd)).toEqual([{ id: 'go', enabled: true, offBy: null }]);
    expect(seatLayersOf({ id: 'a' } as unknown as RepoEntry)).toBeNull();
    expect(seatBaseOf({ id: 'a', seat_base_image: '  ' } as unknown as RepoEntry)).toBeNull();
    expect(layerWord({ id: 'go', enabled: false, offBy: 'something_new' })).toBe('Not added');
  });
});
