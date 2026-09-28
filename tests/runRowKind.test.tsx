// studio#230 — run rows say what the run IS: its kind word (Onboarding, Document, Bug fix — not
// "Build" for all of them), a title that is its head sentence (never just a one-word label), and a
// delivery chip when the run delivered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import * as client from '../src/api/client.js';
import { RunLink } from '../src/components/RunLink.js';
import { humanTitle } from '../src/components/runIdentity.js';
import { runRowKind } from '../src/components/runMode.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import type { AgentSession } from '../src/api/types.js';

beforeEach(() => {
  clearCachedWorkflows();
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const identity = (name: string | null, kind = 'workflow', system = false) => ({ kind, name, user_plan: false, system });

describe('runRowKind', () => {
  it('names the workflow the run drove, from the daemon’s run_identity', () => {
    expect(runRowKind({ workflow_id: 'onboarding', run_identity: identity('onboarding', 'preset', true) })).toEqual({ kind: 'build', label: 'Onboarding' });
    expect(runRowKind({ workflow_id: 'bug-deliver-r1', run_identity: identity('bug') })).toEqual({ kind: 'build', label: 'Bug fix' });
    expect(runRowKind({ workflow_id: 'wf-r2', run_identity: identity('feature') })).toEqual({ kind: 'build', label: 'Feature' });
    expect(runRowKind({ workflow_id: 'wf-r3', run_identity: identity('my-custom-flow') })).toEqual({ kind: 'build', label: 'Build' });
  });

  it('a run that answered a document is a Document, whatever def it drove', () => {
    expect(runRowKind({ workflow_id: 'wf-r4', document_id: 'doc-7', run_identity: identity('interactive-draft', 'workflow', true) })).toEqual({ kind: 'document', label: 'Document' });
  });

  it('no workflow, or chat, is a Chat; an older daemon without run_identity falls back to workflow_id', () => {
    expect(runRowKind({ workflow_id: '' })).toEqual({ kind: 'chat', label: 'Chat' });
    expect(runRowKind({ workflow_id: 'chat' })).toEqual({ kind: 'chat', label: 'Chat' });
    expect(runRowKind({ workflow_id: 'onboarding' })).toEqual({ kind: 'build', label: 'Onboarding' });
    expect(runRowKind({ workflow_id: 'wf-r5' })).toEqual({ kind: 'build', label: 'Build' });
  });
});

describe('humanTitle — a one-word label before a colon is part of the headline', () => {
  it('"Runs: …" and "Recon: …" are not titled by the label alone', () => {
    expect(humanTitle('Runs: the list rows lose their kind')).toBe('Runs: the list rows lose their kind');
    expect(humanTitle('Recon: survey the target and write a proposed test plan')).toBe('Recon: survey the target and write a proposed test plan');
    // …while a real clause before a colon still ends the title.
    expect(humanTitle('Implement GitHub issue #167 in this repo (wicked-interactive): the picker')).toBe('Implement GitHub issue #167 in this repo (wicked-interactive)');
    expect(humanTitle('Fix the flaky test. Then refactor')).toBe('Fix the flaky test');
  });
});

describe('RunLink rows (studio#230)', () => {
  it('an onboarding run reads "Onboarding", not "Build"', () => {
    const view = makeView({ id: 'r-onb', problem: 'Onboard repository', workflow_id: 'onboarding', run_identity: identity('onboarding', 'preset', true) } as Partial<AgentSession>);
    render(<RunLink view={view} selectedRunId={null} onSelect={() => {}} />);
    const row = screen.getByTestId('run-link');
    expect(row.textContent).toContain('Onboarding ·');
    expect(row.textContent).not.toContain('Build ·');
  });

  it('a delivered run carries the delivery chip on the row', async () => {
    const id = 'r-pr';
    const view = makeView(
      {
        id,
        problem: 'Runs: rows hide the delivery chip',
        workflow_id: `bug-deliver-${id}`,
        status: 'completed',
        run_identity: identity('bug'),
        delivery: 'delivered',
        deliverUrl: 'https://github.com/o/r/pull/12',
      } as Partial<AgentSession>,
      [makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'done' })],
    );
    render(<RunLink view={view} selectedRunId={null} onSelect={() => {}} />);
    expect(await screen.findByTestId('run-delivery-chip')).toBeInTheDocument();
    expect(screen.getByTestId('run-title').textContent).toContain('Runs: rows hide the delivery chip');
    expect(screen.getByTestId('run-link').textContent).toContain('Bug fix ·');
  });
});
