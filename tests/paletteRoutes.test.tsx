import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_PANELS, parseRoute } from '../src/hooks/useRoute.js';
import { NOT_A_DESTINATION, REACHED_BY_OTHER_GROUPS, ROUTE_SHAPES, routeTargets } from '../src/palette/routeTargets.js';
import { makeView } from './factories.js';

/**
 * The skin contract's "by ⌘K" half (DES-STUDIO-REBUILD-001 §10, §14 Q2; COVERAGE.md finding 1):
 * the router is enumerated — every panel, every sub-route shape — and each has a palette entry.
 */

const DATA = {
  projects: [{ id: 'kes', name: 'Kestrel' }],
  runs: [makeView({ id: 'r1', problem: 'fix the double charge', status: 'executing' })],
  projectIdByRun: { r1: 'kes' },
  chats: [{ id: 'c1', title: 'what is open' }],
  campaigns: [{ id: 'k1', label: 'checkout sweep' }],
  runChatId: false,
};

describe('the router, enumerated', () => {
  it('every panel but the dead-address one has a route shape, and every shape parses as it says', () => {
    for (const s of ROUTE_SHAPES) expect(s.is(parseRoute(s.example)), `${s.id} ← ${s.example}`).toBe(true);
    const covered = new Set(ROUTE_SHAPES.map((s) => parseRoute(s.example).panel));
    for (const panel of ALL_PANELS) {
      if (panel === NOT_A_DESTINATION) continue;
      expect(covered.has(panel), panel).toBe(true);
    }
    expect(new Set(ROUTE_SHAPES.map((s) => s.id)).size).toBe(ROUTE_SHAPES.length);
  });

  it('each example matches exactly one shape (no two shapes claim one address)', () => {
    for (const s of ROUTE_SHAPES) {
      const r = parseRoute(s.example);
      expect(ROUTE_SHAPES.filter((o) => o.is(r)).map((o) => o.id), s.example).toStrictEqual([s.id]);
    }
  });

  it('every shape has a ⌘K entry (GO TO, or the run / project / repo groups) whose address parses back to it', () => {
    const targets = routeTargets(DATA);
    for (const s of ROUTE_SHAPES) {
      if (REACHED_BY_OTHER_GROUPS.includes(s.id)) continue;
      // S16a-2c: a run no longer lives inside its project, so ⌘K offers no "· in its project" row;
      // the address still parses (it redirects to the run's session, S16a-2d).
      if (s.id === 'p-build-run') continue;
      const mine = targets.filter((t) => t.shape === s.id);
      expect(mine.length, `no ⌘K entry for ${s.id}`).toBeGreaterThan(0);
      for (const t of mine) expect(s.is(parseRoute(t.href)), `${t.label} → ${t.href}`).toBe(true);
    }
    for (const id of REACHED_BY_OTHER_GROUPS) expect(ROUTE_SHAPES.some((s) => s.id === id)).toBe(true);
  });
});

describe('the palette carries them', () => {
  afterEach(cleanup);
  it('typing a destination finds it under GO TO; go: scopes to that group', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"repos":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))));
    const { CommandPalette } = await import('../src/components/CommandPalette.js');
    const navigate = vi.fn();
    render(<CommandPalette open onClose={() => {}} seed="" runs={DATA.runs} navigate={navigate} runPath={(id) => `/runs/${id}`} projectId={null} selectedRun={null} onKill={() => {}} />);
    const input = screen.getByTestId('palette-input');
    fireEvent.change(input, { target: { value: 'go: settings' } });
    await waitFor(() => expect(screen.getAllByTestId('palette-row').length).toBeGreaterThan(0));
    const rows = screen.getAllByTestId('palette-row');
    expect(new Set(rows.map((r) => r.dataset.group))).toStrictEqual(new Set(['go']));
    expect(rows[0]!.getAttribute('href')).toBe('/system');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/system');
    vi.unstubAllGlobals();
  }, 30_000);

  it('the run, project and repo groups carry the shapes GO TO leaves to them', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"repos":[{"id":"x1","name":"api","root_path":"/x","default_branch":"main","registered_at":1}]}', { status: 200, headers: { 'content-type': 'application/json' } }))));
    const { clearPaletteRepoCache, CommandPalette } = await import('../src/components/CommandPalette.js');
    const { useProjectsStore } = await import('../src/store/projects.js');
    clearPaletteRepoCache();
    useProjectsStore.setState({ projects: [{ id: 'kes', name: 'Kestrel', description: null, status: 'active', scope: 'project:kes', created_at: 1, updated_at: 1 }] });
    render(<CommandPalette open onClose={() => {}} seed="" runs={DATA.runs} navigate={() => {}} runPath={(id) => `/runs/${id}`} projectId={null} selectedRun={null} onKill={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('palette-row').some((r) => r.dataset.group === 'repos')).toBe(true));
    const hrefs = screen.getAllByTestId('palette-row').filter((r) => ['runs', 'projects', 'repos'].includes(r.dataset.group ?? '')).map((r) => r.getAttribute('href') ?? '');
    for (const id of REACHED_BY_OTHER_GROUPS) {
      const shape = ROUTE_SHAPES.find((s) => s.id === id)!;
      expect(hrefs.some((h) => shape.is(parseRoute(h.split('#')[0]!))), id).toBe(true);
    }
    vi.unstubAllGlobals();
  });

  it('with nothing typed, GO TO lists the destinations only; a word finds the per-item rows', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"repos":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))));
    const { CommandPalette } = await import('../src/components/CommandPalette.js');
    render(<CommandPalette open onClose={() => {}} seed="" runs={DATA.runs} navigate={() => {}} runPath={(id) => `/runs/${id}`} projectId={null} selectedRun={null} onKill={() => {}} />);
    const input = screen.getByTestId('palette-input');
    fireEvent.change(input, { target: { value: 'go:' } });
    const empty = screen.getAllByTestId('palette-row').map((r) => r.getAttribute('href'));
    expect(empty).not.toContain('/runs/r1/events');
    fireEvent.change(input, { target: { value: 'go: double charge raw' } });
    await waitFor(() => expect(screen.getAllByTestId('palette-row').map((r) => r.getAttribute('href'))).toContain('/runs/r1/events'));
    vi.unstubAllGlobals();
  });
});
