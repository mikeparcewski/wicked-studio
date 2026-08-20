import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ProjectCard, ACTIVE_CARD_H, QUIET_CARD_H } from '../src/components/ProjectCard.js';
import { MODE_SPECS } from '../src/components/ModeSwitcher.js';
import { MODES } from '../src/hooks/useRoute.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { DocSummary } from '../src/api/interactive.js';
import type { Project, SessionStatus } from '../src/api/types.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The slice-2 DOM ACs (DES-UXFIX-001 §4.3): ACTIVE/QUIET card variants, the
 * empty-state budget (absence is at most ONE line, `quiet-summary`, and the
 * banned "nothing" strings appear nowhere), and the four quick actions
 * relabelled to the mode spine with distinct `data-mode`, the switcher's
 * glyphs, and first-run sublabels from MODE_SPECS.
 */

const BANNED = ['No documents yet', 'Nothing running', 'No runs yet', 'Start here'];

beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useRuntimeStore.setState({ outputs: {}, logs: {}, deltaSeq: {}, docActivity: {} });
});
afterEach(cleanup);

const THREE_DAYS = 3 * 86_400_000;

function project(id: string, created_at: number = Date.now() - THREE_DAYS): Project {
  return {
    id, name: id, description: null, status: 'active', scope: `project:${id}`,
    created_at, updated_at: Date.now() - THREE_DAYS,
  };
}

function doc(name: string): DocSummary {
  return { name, kind: 'doc', head: 1, versions: 1, updated_at: null };
}

function item(id: string, over: Partial<BoardProject> = {}): BoardProject {
  return {
    project: project(id), repo: null, runs: [], docs: [],
    attention: 'quiet', score: 0, band: 'quiet', signal: null,
    ...over,
  };
}

function run(id: string, status: SessionStatus) {
  return makeView({ id, status, unit_ix: 0 }, [makeUnit({ id: `${id}:u0`, session_id: id, ord: 0, stage: 'build' })]);
}

const card = (): HTMLElement => screen.getByTestId('project-card');

describe('the QUIET variant — calm is one line, not a wall of absence (F1)', () => {
  it('renders exactly ONE absence line and none of the banned "nothing" strings', () => {
    render(
      <ProjectCard
        item={item('smoke-tests', {
          runs: [run('r-old', 'completed')],
          attention: 'quiet',
          signal: null,
        })}
        navigate={() => {}}
      />,
    );
    expect(card()).toHaveAttribute('data-variant', 'quiet');
    expect(card().style.maxHeight).toBe(`${QUIET_CARD_H}px`);
    const summaries = within(card()).getAllByTestId('quiet-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent(/Quiet — last active \d+[smhd] ago/);
    for (const s of BANNED) expect(card()).not.toHaveTextContent(s);
    // The budget: no region furniture at all — one line plus the action row.
    expect(within(card()).queryByTestId('doc-tile')).toBeNull();
    expect(within(card()).queryByTestId('live-line')).toBeNull();
    expect(within(card()).queryByTestId('run-chip')).toBeNull();
  });

  it('a quiet project WITH docs still shows one line — tiles are ACTIVE-card furniture', () => {
    render(
      <ProjectCard
        item={item('notes', { docs: [doc('ideas'), doc('todo')], attention: 'drafts' })}
        navigate={() => {}}
      />,
    );
    expect(within(card()).getAllByTestId('quiet-summary')).toHaveLength(1);
    expect(within(card()).queryByTestId('doc-tile')).toBeNull();
    for (const s of BANNED) expect(card()).not.toHaveTextContent(s);
  });

  it('an OLD empty project is debris, not a beginning — plain quiet line, no invitation (W2)', () => {
    render(<ProjectCard item={item('abandoned')} navigate={() => {}} />);
    const summaries = within(card()).getAllByTestId('quiet-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent(/Quiet — last active \d+[smhd] ago/);
    expect(card()).not.toHaveTextContent('Start by describing what you want');
    expect(within(card()).getByTestId('quick-actions')).not.toHaveAttribute('data-detail');
  });

  it('a brand-new empty project gets the first-run invitation as its one line (§2.1.2)', () => {
    render(<ProjectCard item={item('scratch', { project: project('scratch', Date.now()) })} navigate={() => {}} />);
    const summaries = within(card()).getAllByTestId('quiet-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent('Start by describing what you want');
    // The invitation IS the one obvious next action (EC1) — a link into Chat.
    expect(summaries[0]).toHaveAttribute('href', '/p/scratch/chat');
    // First-run is the sublabelled 2×2 layout; other quiet cards are compact.
    expect(within(card()).getByTestId('quick-actions')).toHaveAttribute('data-detail', 'true');
  });
});

describe('the quick actions — the mode spine, differentiated (F2, §2.2)', () => {
  it('four actions with distinct data-mode, MODE_SPECS labels and glyphs', () => {
    render(<ProjectCard item={item('any')} navigate={() => {}} />);
    const actions = within(card()).getAllByTestId('quick-action');
    expect(actions).toHaveLength(4);
    expect(actions.map((a) => a.getAttribute('data-mode'))).toEqual([...MODES]);
    for (const [i, m] of MODES.entries()) {
      expect(actions[i]).toHaveTextContent(MODE_SPECS[m].label);
      expect(actions[i]).toHaveTextContent(MODE_SPECS[m].glyph);
    }
    // V9/V10: the old near-synonyms are gone.
    expect(card()).not.toHaveTextContent('Do work');
    expect(card()).not.toHaveTextContent('New chat');
  });

  it('first-run shows each verb\'s sublabel; elsewhere it survives as hover title', () => {
    render(<ProjectCard item={item('scratch', { project: project('scratch', Date.now()) })} navigate={() => {}} />);
    const sublabels = within(card()).getAllByTestId('quick-action-sublabel');
    expect(sublabels.map((s) => s.textContent)).toEqual(MODES.map((m) => MODE_SPECS[m].sublabel));
    cleanup();

    render(
      <ProjectCard
        item={item('busy', { runs: [run('r1', 'executing')], attention: 'running', band: 'needs-you', score: 40, signal: { kind: 'running', at: Date.now(), runId: 'r1' } })}
        navigate={() => {}}
      />,
    );
    expect(within(card()).queryByTestId('quick-action-sublabel')).toBeNull();
    for (const a of within(card()).getAllByTestId('quick-action')) {
      expect(a.getAttribute('title')).toContain('—');
    }
  });
});

describe('the ACTIVE variant — rich, but an empty region is OMITTED (§2.1.1)', () => {
  it('no docs ⇒ no Documents region; the runs and live regions stand on their own', () => {
    render(
      <ProjectCard
        item={item('auth-refactor', {
          runs: [run('r-fail', 'failed')],
          attention: 'failing', band: 'needs-you', score: 66,
          signal: { kind: 'failing', at: Date.now() - 12 * 60_000, runId: 'r-fail' },
        })}
        navigate={() => {}}
      />,
    );
    expect(card()).toHaveAttribute('data-variant', 'active');
    expect(card().style.maxHeight).toBe(`${ACTIVE_CARD_H}px`);
    // Omitted, not narrated: no tile, no absence line, no quiet summary.
    expect(within(card()).queryByTestId('doc-tile')).toBeNull();
    expect(within(card()).queryByTestId('quiet-summary')).toBeNull();
    for (const s of BANNED) expect(card()).not.toHaveTextContent(s);
    // A failed run is terminal — the live region is omitted too, never "Nothing running".
    expect(within(card()).queryByTestId('live-activity')).toBeNull();
    expect(within(card()).getByTestId('run-chip')).toHaveAttribute('data-status', 'failed');
  });

  it('the header pill names the signal in user words — "working", never "distributing" (V3)', () => {
    render(
      <ProjectCard
        item={item('upload-endpoint', {
          runs: [run('r-live', 'executing')],
          attention: 'running', band: 'needs-you', score: 40,
          signal: { kind: 'running', at: Date.now(), runId: 'r-live' },
        })}
        navigate={() => {}}
      />,
    );
    const pill = within(card()).getByTestId('attention-pill');
    expect(pill).toHaveAttribute('data-kind', 'running');
    expect(pill).toHaveTextContent('working');
    expect(within(card()).getByTestId('live-line')).toBeInTheDocument();
  });
});
