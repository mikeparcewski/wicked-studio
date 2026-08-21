import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import { makeView } from './factories.js';

/**
 * The rail consolidated to TWO taxonomies (DES-UXFIX-001 §2.3, slice-3 DOM AC):
 * Projects (attention-ordered, the board's own axis) and Repositories. The
 * Chats/Work sections are gone; the flat lists survive behind ONE "All runs ›"
 * escape hatch; the creation verbs speak the mode spine (Build / Chat), not
 * "Do Work" / "New Chat" (F2's second occurrence, V9/V10).
 *
 * The board model is mocked: the rail's contract is "render what the model
 * ordered, verbatim" — the ordering arithmetic itself is pinned in
 * boardAttention.test.ts / boardModel.test.ts.
 */

let boardItems: BoardProject[] = [];

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: boardItems, unfiled: [], loading: false, error: null }),
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.2.0', ping: 'pong' }),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
}));

const { LeftSidebar } = await import('../src/components/LeftSidebar.js');
const { RunLink } = await import('../src/components/RunLink.js');

function bp(id: string, attention: BoardProject['attention'], score: number): BoardProject {
  return {
    project: {
      id, name: id, description: null, status: 'active',
      scope: `project:${id}`, created_at: 1, updated_at: 1,
    },
    repo: null, runs: [], docs: [], attention, score,
    band: score >= 20 ? 'needs-you' : 'quiet', signal: null,
  };
}

/** The W2 top of the board, already model-ordered, plus quiet tail. */
const W2_ORDERED = [
  bp('q3-review-deck', 'gate', 100),
  bp('api-migration', 'gate', 100),
  bp('auth-refactor', 'failing', 67),
  bp('upload-endpoint', 'running', 40),
  bp('notes', 'drafts', 12),
  bp('smoke-tests', 'quiet', 0),
];

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  boardItems = W2_ORDERED;
});

describe('the rail: two taxonomies (§2.3)', () => {
  it('carries Projects and Repositories — and NO Chats/Work sections', async () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} />);
    await screen.findByRole('button', { name: 'wicked-studio' });

    expect(screen.getByTestId('rail-section-projects')).toBeInTheDocument();
    expect(screen.getByTestId('rail-section-repos')).toBeInTheDocument();
    expect(screen.queryByTestId('rail-section-chats')).toBeNull();
    expect(screen.queryByTestId('rail-section-work')).toBeNull();
    // The old section labels are gone from the surface entirely.
    expect(screen.queryByText('Chats')).toBeNull();
    expect(screen.queryByText('Work')).toBeNull();
    expect(screen.queryByText('No chats yet')).toBeNull();
    expect(screen.queryByText('No work yet')).toBeNull();
  });

  it('lists projects in the model\'s attention order, capped with "view all"', async () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} />);
    await screen.findByRole('button', { name: 'wicked-studio' });

    const rows = within(screen.getByTestId('rail-section-projects')).getAllByTestId('rail-project');
    expect(rows.map((r) => r.dataset.projectId)).toEqual([
      'q3-review-deck', 'api-migration', 'auth-refactor', 'upload-endpoint',
    ]);
    expect(screen.getByText('view all')).toBeInTheDocument();
  });

  it('a project row enters the shell — Chat mode default (§1.5)', async () => {
    const navigate = vi.fn();
    render(<LeftSidebar runs={[]} navigate={navigate} />);
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(screen.getAllByTestId('rail-project')[0]!);
    expect(navigate).toHaveBeenCalledWith('/p/q3-review-deck/chat');
  });

  it('keeps /runs reachable through the ONE escape hatch', async () => {
    const navigate = vi.fn();
    render(<LeftSidebar runs={[]} navigate={navigate} />);
    await screen.findByRole('button', { name: 'wicked-studio' });

    const hatch = screen.getByTestId('rail-all-runs');
    expect(hatch).toHaveAttribute('href', '/runs');
    fireEvent.click(hatch);
    expect(navigate).toHaveBeenCalledWith('/runs');
  });

  it('speaks the mode spine for creation: Build / Chat / Repository, never the old synonyms', async () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} />);
    await screen.findByRole('button', { name: 'wicked-studio' });

    const actions = within(screen.getByTestId('rail-actions'));
    expect(actions.getByRole('button', { name: 'Build' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'Repository' })).toBeInTheDocument();
    expect(screen.queryByText('Do Work')).toBeNull();
    expect(screen.queryByText('New Chat')).toBeNull();
    expect(screen.queryByText('New Repository')).toBeNull();
  });
});

describe('run items name their mode (F4: no more identical truncated items)', () => {
  it('a chat run and a work run are distinguishable by spine word + glyph', () => {
    const chat = makeView({ id: 'r-chat', problem: 'talk about the thing', workflow_id: 'chat' });
    const work = makeView({ id: 'r-work', problem: 'work on the thing', workflow_id: 'wf-1' });
    render(
      <>
        <RunLink view={chat} selectedRunId={null} onSelect={() => {}} />
        <RunLink view={work} selectedRunId={null} onSelect={() => {}} />
      </>,
    );

    const links = screen.getAllByTestId('run-link');
    expect(links.map((l) => l.dataset.kind)).toEqual(['chat', 'build']);
    expect(links[0]!.textContent).toContain('Chat ·');
    expect(links[1]!.textContent).toContain('Build ·');
    expect(links[0]!.textContent).toContain('💬');
    expect(links[1]!.textContent).toContain('⚙');
  });
});
