import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactProposal } from '../src/api/types.js';
import { foldJobLineages } from '../src/board/jobStream.js';
import { JobPassage } from '../src/components/session/JobPassage.js';
import { resetJobLocal } from '../src/hooks/useJobStream.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useJobBinding } from '../src/store/jobBinding.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { jobProposal, CHAT } from './jobFixtures.js';

const refs = [{ repoId: 'svc', key: 'k1' }, { repoId: 'svc', key: 'k2' }];
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
const reads: string[] = [];
function proposal(): ArtifactProposal {
  return jobProposal({
    what: { entry: 'draft-epics', title: 'Draft epics', label: 'Draft epics', outcome: null },
    launch: 'compose', filedIn: { projectId: 'shop', label: 'Shop' },
    needs: [
      { id: 'project', kind: 'project', label: 'Project', required: true, status: 'met', value: 'shop' },
      { id: 'requirements', kind: 'requirements', label: 'Requirements', required: true, status: 'missing' },
    ],
    question: { kind: 'missing', text: 'Requirements?', choices: [] },
  });
}
function passage(p = proposal()): React.ReactElement {
  const lineage = foldJobLineages([{ at: 1, turnId: p.turnId, kind: 'proposal', proposal: p }])[0]!;
  return <JobPassage chatId={CHAT} lineage={lineage} runs={[]} sessionId={CHAT} say={() => {}} onChanged={() => {}} />;
}
beforeEach(() => {
  posts.length = 0;
  reads.length = 0;
  resetJobLocal();
  useJobBinding.setState({ binding: null });
  useCapabilities.setState({ loaded: true, chatJobPower: false });
  setCachedRoster([]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    else reads.push(path);
    const body = path === '/projects/shop/requirements' ? {
      projectId: 'shop', offset: 0, limit: 50,
      totals: { repos: 1, ok: 1, absent: 0, errors: 0, dangling: 0, total: 2, corpus: 2 },
      rows: [{ repo: { id: 'svc', name: 'Service' }, state: 'ok', total: 2, corpus: 2,
        items: refs.map((r, i) => ({ key: r.key, domain: 'shop', reqId: `REQ-${i + 1}`, title: `Requirement ${i + 1}`, category: 'functional', statement: 's', status: 'draft', risk: false, riskSource: null, edited: false })) }],
    } : { view: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('requirements question in the job passage (#1054)', () => {
  it('lists the project requirements and sends two picks in one question revision', async () => {
    const p = proposal();
    render(passage(p));
    const picks = await screen.findAllByTestId('requirement-pick');
    expect(reads).toContain('/projects/shop/requirements');
    const use = screen.getByTestId('job-passage-requirements-use');
    fireEvent.click(picks[0]!);
    expect(use).toHaveTextContent(/^Use 1 requirement$/);
    expect(use).toBeEnabled();
    fireEvent.click(picks[1]!);
    expect(use).toHaveTextContent('Use 2 requirements');
    fireEvent.click(use);
    fireEvent.click(use);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ path: `/chats/${CHAT}/proposals`, body: {
      revises: p.pid, source: 'question', edits: { inputs: { requirements: { kind: 'requirements', refs } } },
    } });
  });

  it('keeps Use disabled and posts nothing when no requirement is picked', async () => {
    render(passage());
    await screen.findAllByTestId('requirement-pick');
    const use = screen.getByTestId('job-passage-requirements-use');
    expect(use).toHaveTextContent('Use the requirements you pick');
    expect(use).toBeDisabled();
    fireEvent.click(use);
    expect(posts).toEqual([]);
  });
});
