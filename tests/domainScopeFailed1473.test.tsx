/**
 * studio#1473 (J6): crew's scope answer when garden cannot read the scope is `the scope failed: <garden's last stderr line>`
 * (wicked-crew packages/crew/src/api/domain-scope.ts:202, `runScope`). An npm-global wicked-garden older than the scope
 * script answers with its launcher's JSON, absolute host path included (the train-16 cert, lanes/j6-build/cert16/shots/s1d/
 * after.txt). The card says it in words (the words wicked-core's run step uses for the same garden,
 * src/domain_extraction.rs:167 OLD_GARDEN_REFUSAL), never the JSON or the path, and the chat job's Start is held until a
 * scope resolves (as the launch wizard's already is).
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactProposal } from '../src/api/types.js';
import { foldJobLineages } from '../src/board/jobStream.js';
import { scopeErrorWords } from '../src/board/domainModel.js';
import { JobPassage } from '../src/components/session/JobPassage.js';
import { resetJobLocal } from '../src/hooks/useJobStream.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useJobBinding } from '../src/store/jobBinding.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { jobProposal, CHAT } from './jobFixtures.js';

// The cert's answer, verbatim (crew's prefix + garden's launcher line).
const CERT_ERROR = 'the scope failed: {"ok":false,"reason":"scripts/domain/scope.py: not found under the plugin root /opt/homebrew/lib/node_modules/wicked-garden","tried":[{"path":"/opt/homebrew/lib/node_modules/wicked-garden/scripts/domain/scope.py","reason":"absent"}]}';
const OLD_GARDEN = 'this wicked-garden is too old to map a domain: upgrade it';
const CARD = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'domain-v3', 'scope-mini-cobol.crew.json'), 'utf8')) as unknown;

let preview: () => Record<string, unknown> = () => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeError: CERT_ERROR });
const posts: string[] = [];

function domainProposal(): ArtifactProposal {
  return jobProposal({
    what: { entry: 'analyze-codebase', title: 'Map the domain', label: 'Analyze · Domain', outcome: null },
    shape: { card: 'analyze-codebase', option: 'domain', depth: null, by: 'picked', source: 'chat' },
    repos: ['payroll'], repoRefs: ['payroll'], gate: [], words: 'How PAYCALC1 computes pay', brief: null,
  } as never);
}
function passage(p: ArtifactProposal): React.ReactElement {
  const lineage = foldJobLineages([{ at: 1, turnId: p.turnId, kind: 'proposal', proposal: p }])[0]!;
  return <JobPassage chatId={CHAT} lineage={lineage} runs={[]} sessionId={CHAT} say={() => {}} onChanged={() => {}} />;
}
const start = (): HTMLButtonElement => screen.getAllByTestId('job-passage-reply').find((b) => b.dataset['reply'] === 'start') as HTMLButtonElement;

beforeEach(() => {
  posts.length = 0;
  resetJobLocal();
  useJobBinding.setState({ binding: null });
  useCapabilities.setState({ loaded: true, chatJobPower: false });
  setCachedRoster([]);
  preview = () => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeError: CERT_ERROR });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST' && path !== '/runs/preview') posts.push(path);
    const body = path === '/runs/preview' ? preview() : { view: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('studio#1473: a failed domain scope', () => {
  it('says an old garden in words, with no JSON and no host path', () => {
    expect(scopeErrorWords(CERT_ERROR)).toBe(OLD_GARDEN);
  });

  it('any other failure keeps crew\'s words, with garden\'s JSON read down to its reason and no absolute path', () => {
    expect(scopeErrorWords('the scope did not finish in 120 s')).toBe('the scope did not finish in 120 s');
    const w = scopeErrorWords('the scope failed: {"ok":false,"reason":"the store at /home/someone/x/estate.db is locked"}');
    expect(w).toBe('the scope failed: the store at …/estate.db is locked');
    expect(scopeErrorWords('the scope failed: Traceback in /opt/homebrew/lib/node_modules/wicked-garden/scripts/domain/scope.py')).toBe('the scope failed: Traceback in …/scope.py');
  });

  it('the chat job\'s card says it in words, and Start is held with the reason until a scope resolves', async () => {
    render(passage(domainProposal()));
    const card = await screen.findByTestId('domain-scope-card');
    await waitFor(() => expect(card.dataset.state).toBe('failed'));
    const err = within(card).getByTestId('domain-scope-error');
    expect(err.textContent).toContain(OLD_GARDEN);
    expect(err.textContent).not.toMatch(/[{}]|\/opt\/|plugin root/);
    expect(start().disabled).toBe(true);
    expect(screen.getByTestId('job-passage-held').textContent).toBe('There is no scope to start from yet: see the card.');
    start().click();
    expect(posts).toEqual([]);
  });

  it('once the scope resolves (Read the code again), Start is offered', async () => {
    render(passage(domainProposal()));
    const card = await screen.findByTestId('domain-scope-card');
    await waitFor(() => expect(card.dataset.state).toBe('failed'));
    preview = () => ({ posture: { power: false, deliver: 'none', autoDeliver: false }, scopeCard: CARD });
    within(card).getByTestId('domain-scope-refresh').click();
    await waitFor(() => expect(card.dataset.state).toBe('ready'));
    await waitFor(() => expect(start().disabled).toBe(false));
  });
});
