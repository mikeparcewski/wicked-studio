// Slice R (DES-UX-001 §1.3-1 / §1.5): units-as-spine for EVERY terminal status.
//
// A failed run's page used to collapse to a one-line rejection while the
// transcripts sat on the wire (GET /runs/:id/units/:unitKey/output). These
// tests pin the post-mortem shape:
//
//   1. a FAILED run renders `[data-testid="work-unit"]` for its units, and a
//      unit with captured output auto-opens `[data-testid="unit-transcript"]`
//      (the rejected-unit auto-open contract, WorkUnitDetail.tsx:38, preserved);
//   2. FailureBanner is the HEADLINE — it renders, and it PRECEDES the unit
//      list in the DOM (demoted from the whole story, never removed);
//   3. cancelled runs get the same spine;
//   4. an evidence reference inside a transcript is a live <a> that opens the
//      FileViewer populated from readRunFile — no dead click (§1.3-4c).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

const FAILED_VIEW = makeView({ status: 'failed' }, [
  makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  makeUnit({
    id: 'run-1:review', ord: 1, stage: 'review', status: 'rejected',
    denial_reason: 'phase produced no reviewable substance',
  }),
]);

// Slice BB (DES-UX-002 §2.3): a terminal run's DEFAULT lens is the evidence
// timeline; the slice-R post-mortem spine is the preserved Units tab. These
// tests re-verify every spine AC holds UNCHANGED there (§8.3's re-scope) —
// the panel opens on the Units tab before each assertion.
async function renderPanel(view = FAILED_VIEW): Promise<void> {
  render(
    <ChatPanel
      view={view}
      onLaunched={vi.fn()}
      onNavigateBack={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  await userEvent.click(await screen.findByTestId('tab-unit-list'));
}

describe('ChatPanel — the failed-run post-mortem spine (slice R)', () => {
  it('renders work units for a FAILED run and auto-opens the captured transcript', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockImplementation(
      async (_id: string, unitKey: string) =>
        unitKey === 'survey'
          ? { output: 'captured survey transcript' }
          : { output: null, outputUnavailable: 'denied — output not retained past a deny' },
    );
    await renderPanel();

    // The spine renders (§1.5 AC 1) …
    const units = await screen.findAllByTestId('work-unit');
    expect(units).toHaveLength(2);

    // … and the transcripts auto-open, INCLUDING the rejected unit's honest
    // absence reason (WorkUnitDetail.tsx:38's contract, preserved).
    const panes = await screen.findAllByTestId('unit-transcript');
    expect(panes.length).toBe(2);
    expect(await screen.findByText('captured survey transcript')).toBeInTheDocument();
    expect(await screen.findByText(/output not retained past a deny/)).toBeInTheDocument();
    expect(client.api.getUnitOutput).toHaveBeenCalledWith('run-1', 'survey');
    expect(client.api.getUnitOutput).toHaveBeenCalledWith('run-1', 'review');
  });

  it('FailureBanner is the headline ABOVE the unit list — demoted, not removed', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'x' });
    await renderPanel();

    const banner = await screen.findByTestId('failure-banner');
    const list = await screen.findByTestId('unit-list');
    expect(banner).toHaveAttribute('data-kind', 'failed');
    expect(
      banner.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('a CANCELLED run renders the same spine under its banner', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'partial work' });
    await renderPanel(makeView({ status: 'cancelled' }, [
      makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'done' }),
    ]));

    expect(await screen.findByTestId('failure-banner')).toHaveAttribute('data-kind', 'cancelled');
    expect(await screen.findByTestId('work-unit')).toBeInTheDocument();
    expect(await screen.findByText('partial work')).toBeInTheDocument();
  });

  it('the VerdictDetail card renders on the post-mortem page', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'x' });
    useRunEventStore.setState({
      byRun: {
        'run-1': [{
          type: 'gateEvaluated', session: 'run-1', ord: 1,
          criterion: 'review artifacts exist', hasDeterministicFloor: false,
          deterministicPass: false, agentVerdict: 'deny',
          agentReasoning: 'nothing to review', evaluatorPass: true,
          evaluatorPolicies: [], denialReason: 'phase produced no reviewable substance',
          combined: false,
        }],
      },
    });
    await renderPanel();

    const card = await screen.findByTestId('verdict-detail');
    expect(card).toHaveAttribute('data-phase-ord', '1');
    expect(card).toHaveTextContent('nothing to review');
  });

  it('an evidence reference in a transcript opens the FileViewer via readRunFile — no dead click', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockImplementation(
      async (_id: string, unitKey: string) =>
        unitKey === 'survey'
          ? { output: 'see [NOTES.md](/w2/evidence/NOTES.md) for the survey notes' }
          : { output: null },
    );
    const getRunFile = vi.spyOn(client.api, 'getRunFile').mockResolvedValue({
      path: '/w2/evidence/NOTES.md', content: 'the notes', size: 9, truncated: false, binary: false,
    });
    await renderPanel();

    const link = await screen.findByTestId('evidence-ref');
    expect(link.tagName).toBe('A');
    await userEvent.click(link);

    expect(await screen.findByTestId('file-viewer')).toBeInTheDocument();
    expect(getRunFile).toHaveBeenCalledWith('run-1', '/w2/evidence/NOTES.md');
    expect(await screen.findByText('the notes')).toBeInTheDocument();
  });
});
