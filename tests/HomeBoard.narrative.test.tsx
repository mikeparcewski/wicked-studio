import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * Slice Q (DES-FEEDBACK-003 §7.6): on `/` the NARRATIVE BAND replaces the
 * metrics bar — old testid absent (supersession), GateLatencyChart unmounted
 * from the landing — while the wall, bands, and live feed render unchanged
 * beneath it (C3/C6).
 */

let projects: Project[] = [];
let members: Record<string, ProjectMember[]> = {};

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: (id: string) => Promise.resolve({ members: members[id] ?? [] }),
    getRunEvents: () => Promise.reject(new Error('no log')),
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: () => Promise.resolve([]),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

function project(id: string): Project {
  return { id, name: id, description: null, status: 'active', scope: `project:${id}`, created_at: 1, updated_at: Date.now() };
}

function member(project_id: string, member_ref: string, attached_at: number): ProjectMember {
  return { id: `${project_id}:crew.run:${member_ref}`, project_id, member_kind: 'crew.run', member_ref, meta: null, attached_at, attached_by: 'studio' };
}

describe('HomeBoard — the narrative landing (slice Q)', () => {
  beforeEach(() => {
    projects = [];
    members = {};
  });

  it('mounts the narrative band where the metrics bar was; the old band is GONE', async () => {
    const now = Date.now();
    projects = [project('p-live')];
    members = { 'p-live': [member('p-live', 'r-live', now - 3_600_000)] };
    const runs = [makeView({ id: 'r-live', status: 'executing' })];
    render(<HomeBoard runs={runs} navigate={() => {}} />);
    await screen.findByTestId('project-board');

    // Supersession (§7.6 AC 1 + §8.5): new band in, old bar out, latency chart off `/`.
    expect(await screen.findByTestId('narrative-band')).toBeInTheDocument();
    expect(screen.queryByTestId('metrics-bar')).toBeNull();
    expect(screen.queryByTestId('gate-latency-chart')).toBeNull();

    // The band's parts: lede + river + the two margin notes.
    expect(screen.getByTestId('landing-lede')).toBeInTheDocument();
    expect(screen.getByTestId('activity-river')).toBeInTheDocument();
    const margin = screen.getByTestId('river-margin');
    expect(margin.querySelector('[data-testid="run-outcome-bar"]')).not.toBeNull();
    expect(margin.querySelector('[data-testid="token-burn-sparkline"]')).not.toBeNull();

    // The band sits ABOVE the wall in the document flow.
    const band = screen.getByTestId('narrative-band');
    const wall = screen.getByTestId('project-board');
    expect(band.compareDocumentPosition(wall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('preserves the wall structure beneath the band (C3/C6): bands, chips, feed', async () => {
    const now = Date.now();
    projects = [project('p-gate'), project('p-move'), project('p-quiet')];
    members = {
      'p-gate': [member('p-gate', 'r-gate', now - 60_000)],
      // A MOVING run so the live feed mounts (it is absent when nothing runs);
      // p-quiet stays runless so the QUIET band renders too.
      'p-move': [member('p-move', 'r-live', now - 120_000)],
    };
    const runs = [
      makeView({ id: 'r-gate', status: 'awaiting_human' }),
      makeView({ id: 'r-live', status: 'executing' }),
    ];
    render(<HomeBoard runs={runs} navigate={() => {}} />);
    await screen.findByTestId('project-board');
    await vi.waitFor(() => {
      expect(screen.getByTestId('band-needs-you')).toBeInTheDocument();
    });
    expect(screen.getByTestId('band-quiet')).toBeInTheDocument();
    expect(screen.getByTestId('band-quiet-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('live-feed')).toBeInTheDocument();
    expect(screen.getByTestId('all-runs-link')).toBeInTheDocument();
  });
});
