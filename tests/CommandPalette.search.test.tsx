import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GovernanceClaim, InteractionRequest } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The palette's SEARCH mode (DES-FEEDBACK-002 §5, slice J): the `?` prefix is
 * the deep mode — the EC24 corpus label always visible, the honest v1 corpus
 * (runs / open gates / decisions / repos, prompts scoped to the current
 * project), substring-on-prose + fuzzy-on-identifiers matching, and the §5.2
 * request budget: at most two GETs on ENTRY, zero per keystroke, and never a
 * request to any /search route.
 */

const listRepos = vi.fn();
const listClaims = vi.fn();
const listProjectPrompts = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: new Proxy(
    {},
    {
      // EVERY api surface is a spy — the budget assertions are "nothing but
      // the named calls fired", not a hand-picked subset.
      get: (_t, prop) => {
        const name = String(prop);
        if (name === 'listRepos') return listRepos;
        if (name === 'listClaims') return listClaims;
        if (name === 'listProjectPrompts') return listProjectPrompts;
        return calls(name);
      },
    },
  ),
}));

const otherCalls = new Map<string, ReturnType<typeof vi.fn>>();
function calls(prop: string): ReturnType<typeof vi.fn> {
  let fn = otherCalls.get(prop);
  if (fn === undefined) {
    fn = vi.fn(() => Promise.resolve({}));
    otherCalls.set(prop, fn);
  }
  return fn;
}

const { CommandPalette, clearPaletteRepoCache, substringMatch } = await import('../src/components/CommandPalette.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useMembershipStore } = await import('../src/store/membership.js');

const RUNS = [
  makeView({ id: 'r-gate', problem: 'migrate the auth tables', status: 'awaiting_human' }),
  makeView({ id: 'r-live', problem: 'add rate-limiting to the upload endpoint', status: 'executing' }),
  makeView({ id: 'r-done', problem: 'smoke the auth login flow', status: 'completed' }),
];

const CLAIMS: GovernanceClaim[] = [
  {
    claim_id: 'clm-1', scope: 'run:r-live', phase: 'build', policy_ids: ['pol-rate-limit'],
    decision: 'allow', obligations: [], evaluated_context_ref: 'ctx-1',
    criteria: 'rate-limiting middleware added before merge', evaluator_identity: 'conformance',
    evaluated_at: 1,
  },
  {
    claim_id: 'clm-2', scope: 'repo:studio-api', phase: 'design', policy_ids: ['pol-authz'],
    decision: 'deny', obligations: [], evaluated_context_ref: 'ctx-2',
    criteria: 'the migration lacks a rollback plan', evaluator_identity: 'conformance',
    evaluated_at: 2,
  },
];

const PROMPTS: InteractionRequest[] = [
  {
    id: 'ir-1', session_id: 'r-gate', kind: 'gate', ord: 0, reviewing_ord: null,
    prompt: 'Approve the migration outline?', status: 'open', answer: null,
    created_at: 1, resolved_at: null,
  },
  {
    id: 'ir-2', session_id: 'r-done', kind: 'gate', ord: 0, reviewing_ord: null,
    prompt: 'already answered — must not surface', status: 'answered', answer: '{}',
    created_at: 1, resolved_at: 2,
  },
];

function renderPalette(over: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const navigate = vi.fn();
  const utils = render(
    <CommandPalette
      open
      onClose={() => {}}
      runs={RUNS}
      navigate={navigate}
      runPath={(id) => `/runs/${id}`}
      projectId={null}
      selectedRun={null}
      onKill={() => {}}
      {...over}
    />,
  );
  return { navigate, ...utils };
}

function type(text: string): void {
  fireEvent.change(screen.getByTestId('palette-input'), { target: { value: text } });
}

function rows(): HTMLElement[] {
  return screen.queryAllByTestId('palette-row');
}

beforeEach(() => {
  clearPaletteRepoCache();
  listRepos.mockReset();
  listClaims.mockReset();
  listProjectPrompts.mockReset();
  otherCalls.clear();
  listRepos.mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/x', default_branch: 'main', registered_at: 1 }],
  });
  listClaims.mockResolvedValue({ claims: CLAIMS });
  listProjectPrompts.mockResolvedValue({ projectId: 'p1', prompts: PROMPTS });
  useProjectsStore.setState({ projects: [] });
  useGateStore.setState({
    gates: {
      'r-gate': { runId: 'r-gate', ord: 0, prompt: 'How should the tables move?', lifecycle: 'open', receivedAt: 5 },
    },
  });
  useMembershipStore.setState({ projectNameByRun: { 'r-gate': 'api-migration', 'r-live': 'upload-endpoint' }, attachedAtByRun: {} });
});
afterEach(cleanup);

describe('the EC24 corpus label (§5.2)', () => {
  it('renders the always-visible label naming what IS and IS NOT searched — verbatim, archived runs included', async () => {
    renderPalette();
    type('?auth');
    const label = screen.getByTestId('search-corpus-label');
    expect(label.textContent).toContain(
      'Searching: runs (all non-archived) · open gates · decisions (governance claims) · repos',
    );
    expect(label.textContent).toContain(
      'Not searched: archived runs, transcripts, historical events —',
    );
    // Outside a project shell there is NO prompts clause — the scoped wire only.
    expect(label.textContent).not.toContain('prompts: this project');
    await waitFor(() => expect(listClaims).toHaveBeenCalledTimes(1));
  });

  it('the [why?] popover states the wire truth in one sentence', () => {
    renderPalette();
    type('?x');
    expect(screen.queryByTestId('search-why-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('search-why'));
    expect(screen.getByTestId('search-why-popover').textContent).toBe(
      'The crew daemon has no search index yet; the studio searches what it holds.',
    );
  });

  it('inside a project shell the label adds "prompts: this project" and the scoped wire fires once', async () => {
    renderPalette({ projectId: 'p1' });
    type('?migration');
    expect(screen.getByTestId('search-corpus-label').textContent).toContain('prompts: this project');
    await waitFor(() => expect(listProjectPrompts).toHaveBeenCalledTimes(1));
    expect(listProjectPrompts).toHaveBeenCalledWith('p1');
  });
});

describe('the request budget (§5.2/§5.5)', () => {
  it('entering search mode fires GET /governance/claims once; ten keystrokes fire nothing further', async () => {
    renderPalette();
    type('?');
    await waitFor(() => expect(listClaims).toHaveBeenCalledTimes(1));
    for (const q of ['?a', '?au', '?aut', '?auth', '?auth ', '?auth t', '?auth ta', '?auth tab', '?auth tabl', '?auth table']) {
      type(q);
    }
    await waitFor(() => rows().length >= 0);
    expect(listClaims).toHaveBeenCalledTimes(1);
    expect(listProjectPrompts).not.toHaveBeenCalled();
    // The invented-wire guard: no /search anything, ever — every OTHER api
    // surface is a spy and none fired.
    for (const [name, fn] of otherCalls) {
      expect(fn, name).not.toHaveBeenCalled();
    }
  });

  it('outside a project no prompts request fires at all', async () => {
    renderPalette({ projectId: null });
    type('?anything');
    await waitFor(() => expect(listClaims).toHaveBeenCalled());
    expect(listProjectPrompts).not.toHaveBeenCalled();
  });
});

describe('the corpus & matching (§5.1/§5.2)', () => {
  it('substring on prose: run hits whose problem CONTAINS the needle, accent positions contiguous', () => {
    expect(substringMatch('auth', 'migrate the auth tables')?.positions).toEqual([12, 13, 14, 15]);
    expect(substringMatch('xyz', 'migrate the auth tables')).toBeNull();
    // Subsequence would match 'mat' scattered — substring must NOT.
    expect(substringMatch('mtt', 'migrate the tables')).toBeNull();
  });

  it('?auth returns run hits with project-name context, grouped under RUNS', async () => {
    renderPalette();
    type('?auth');
    await waitFor(() => {
      const runRows = rows().filter((r) => r.dataset.group === 'search-runs');
      expect(runRows.length).toBe(2); // r-gate + r-done ('smoke the auth login flow')
    });
    const first = rows().find((r) => r.dataset.group === 'search-runs') as HTMLElement;
    expect(first.textContent).toContain('migrate the auth tables');
    expect(first.textContent).toContain('api-migration'); // the run's project
    expect(first.getAttribute('href')).toBe('/runs/r-gate');
  });

  it('a word from an open gate prompt returns a gate hit that navigates to the run with #gate', async () => {
    const { navigate } = renderPalette();
    type('?tables move');
    let gateRow: HTMLElement | undefined;
    await waitFor(() => {
      gateRow = rows().find((r) => r.dataset.group === 'search-gates');
      expect(gateRow).toBeDefined();
    });
    expect(gateRow?.getAttribute('href')).toBe('/runs/r-gate#gate');
    fireEvent.click(gateRow as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/runs/r-gate#gate');
  });

  it('decisions: substring on the claim subject; the hit targets the run the claim names, else /steering', async () => {
    renderPalette();
    type('?rate-limiting middleware');
    let hit: HTMLElement | undefined;
    await waitFor(() => {
      hit = rows().find((r) => r.dataset.group === 'search-decisions');
      expect(hit).toBeDefined();
    });
    // clm-1 names run r-live in its scope — the hit goes to the run.
    expect(hit?.getAttribute('href')).toBe('/runs/r-live');
    expect(hit?.textContent).toContain('pol-rate-limit');
    expect(hit?.textContent).toContain('allow');

    type('?rollback plan');
    await waitFor(() => {
      const h = rows().find((r) => r.dataset.group === 'search-decisions');
      // clm-2 names no run the client holds — the ledger surface answers.
      expect(h?.getAttribute('href')).toBe('/steering');
    });
  });

  it('repos match by the fuzzy scorer and open the repo page', async () => {
    renderPalette();
    type('?stapi'); // subsequence of studio-api — identifiers stay fuzzy
    await waitFor(() => {
      const repo = rows().find((r) => r.dataset.group === 'search-repos');
      expect(repo?.getAttribute('href')).toBe('/repo-detail/studio-api');
    });
  });

  it('scoped prompts: only OPEN prompts surface, targeting the run at its gate', async () => {
    renderPalette({ projectId: 'p1' });
    type('?migration outline');
    let prompt: HTMLElement | undefined;
    await waitFor(() => {
      prompt = rows().find((r) => r.dataset.group === 'search-prompts');
      expect(prompt).toBeDefined();
    });
    expect(prompt?.getAttribute('href')).toBe('/runs/r-gate#gate');
    // The answered one never surfaces, whatever the needle.
    type('?already answered');
    await waitFor(() => {
      expect(rows().find((r) => r.dataset.group === 'search-prompts')).toBeUndefined();
    });
  });

  it('archived runs are excluded from the corpus — the label names them as not searched', async () => {
    const archived = makeView({ id: 'r-arch', problem: 'archived auth spike', status: 'completed' });
    archived.session.archived_at = 123;
    renderPalette({ runs: [...RUNS, archived] });
    type('?auth');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().some((r) => (r.getAttribute('href') ?? '').includes('r-arch'))).toBe(false);
  });
});

describe('the seed (Cmd+Shift+F lands here, §5.2)', () => {
  it('opening with seed="?" starts in search mode with the corpus label visible', () => {
    renderPalette({ seed: '?' });
    expect((screen.getByTestId('palette-input') as HTMLInputElement).value).toBe('?');
    expect(screen.getByTestId('search-corpus-label')).toBeInTheDocument();
  });
});
