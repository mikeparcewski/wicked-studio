/**
 * J6 S1 (codex S1 r1, classes 3 and 7): a chat job that maps a domain shows, before Start, crew's scope card for the
 * words Start will send. Crew's job launcher sends the proposal's brief first, then its words (crew routes.ts, the
 * `job` launcher), so the card asks for the same words: an edited brief, never the first words. Drives the real
 * passage and the preview it posts.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactProposal } from '../src/api/types.js';
import { foldJobLineages } from '../src/board/jobStream.js';
import { JobPassage } from '../src/components/session/JobPassage.js';
import { resetJobLocal } from '../src/hooks/useJobStream.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useJobBinding } from '../src/store/jobBinding.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { jobProposal, CHAT } from './jobFixtures.js';

const CARD = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'domain-v3', 'scope-mini-cobol.crew.json'), 'utf8')) as unknown;
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function domainProposal(over: Partial<ArtifactProposal> = {}): ArtifactProposal {
  return jobProposal({
    what: { entry: 'analyze-codebase', title: 'Map the domain', label: 'Analyze · Domain', outcome: null },
    shape: { card: 'analyze-codebase', option: 'domain', depth: null, by: 'picked', source: 'chat' },
    repos: ['payroll'], repoRefs: ['payroll'], gate: [],
    ...over,
  } as never);
}
function passage(p: ArtifactProposal): React.ReactElement {
  const lineage = foldJobLineages([{ at: 1, turnId: p.turnId, kind: 'proposal', proposal: p }])[0]!;
  return <JobPassage chatId={CHAT} lineage={lineage} runs={[]} sessionId={CHAT} say={() => {}} onChanged={() => {}} />;
}
beforeEach(() => {
  posts.length = 0;
  resetJobLocal();
  useJobBinding.setState({ binding: null });
  useCapabilities.setState({ loaded: true, chatJobPower: false });
  setCachedRoster([]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const body = path === '/runs/preview' ? { posture: { power: false, deliver: 'none', autoDeliver: false }, scopeCard: CARD } : { view: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const scopeAsks = (): Array<Record<string, unknown>> => posts.filter((p) => p.path === '/runs/preview' && p.body['domainScope'] !== undefined).map((p) => p.body);

describe("a domain model chat job's scope card (J6 S1)", () => {
  it('asks for the brief Start sends (not the first words) and shows the card read only', async () => {
    render(passage(domainProposal({ words: 'map payroll', brief: 'How PAYCALC1 computes pay from the payroll file' } as never)));
    const card = await screen.findByTestId('domain-scope-card');
    await waitFor(() => expect(card.dataset.state).toBe('ready'));
    expect(scopeAsks()).toEqual([{ workflow: 'domain-extraction', repoRef: 'payroll', domainScope: { intent: 'How PAYCALC1 computes pay from the payroll file' } }]);
    expect(within(card).getByTestId('domain-scope-readonly')).toHaveTextContent('Start maps what these words cover. To change it, change the words.');
    expect(within(card).queryByTestId('domain-scope-drop')).not.toBeInTheDocument();
    expect(within(card).queryByTestId('domain-scope-add-input')).not.toBeInTheDocument();
  });

  it('asks for the words when there is no brief', async () => {
    render(passage(domainProposal({ words: 'How PAYCALC1 computes pay', brief: null } as never)));
    await waitFor(() => expect(scopeAsks()).toHaveLength(1));
    expect((scopeAsks()[0]!['domainScope'] as { intent: string }).intent).toBe('How PAYCALC1 computes pay');
  });

  it('another kind of job shows no card and asks nothing', async () => {
    render(passage(jobProposal({ words: 'port it' } as never)));
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByTestId('domain-scope-card')).not.toBeInTheDocument();
    expect(scopeAsks()).toEqual([]);
  });
});
