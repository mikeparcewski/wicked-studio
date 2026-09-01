// DES-RUN-NARRATOR §8 (revised 2026-08-31) — the lens demotion + header condense.
//
// Operator feedback on the shipped three-tab layout: "I don't know what value
// timeline and units have. I feel like they will confuse most users. Also think
// you could condense the header." These tests pin the revision:
//
//   1. the Feed IS the run view — a terminal run renders NO primary tabs
//      (no tablist, no role=tab siblings of the feed);
//   2. Timeline and Units stay REACHABLE — demoted behind the header's single
//      Inspect ▾ control (`run-inspect` → `run-inspect-menu`), never deleted;
//      the menu items keep the tab-* testids (selector contract);
//   3. a LIVE run has no Inspect control at all (lenses are terminal-only,
//      exactly as the tabs were);
//   4. the header is ONE row (`run-header`): back + status dot + DERIVED title
//      (runTitle) + status chip + actions — and the started/ended/took strip is
//      GONE from the run page chrome (it moved into What/Where, its test lives
//      with that panel).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'captured output' });
});

const TERMINAL_VIEW = makeView({ status: 'completed' }, [
  makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
]);

function renderPanel(view = TERMINAL_VIEW): void {
  render(
    <ChatPanel
      view={view}
      onLaunched={vi.fn()}
      onNavigateBack={vi.fn()}
      onRefresh={vi.fn()}
      navigate={vi.fn()}
    />,
  );
}

describe('ChatPanel — lens demotion (DES-RUN-NARRATOR §8, revised)', () => {
  it('the Feed is the run view: no primary tabs render on a terminal run', async () => {
    renderPanel();
    expect(await screen.findByTestId('thread')).toBeInTheDocument();
    // The old sibling-tab strip is gone entirely.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    // The lens entries are NOT in the DOM until the Inspect control opens them.
    expect(screen.queryByTestId('tab-timeline')).toBeNull();
    expect(screen.queryByTestId('tab-unit-list')).toBeNull();
  });

  it('Inspect ▾ opens the lens menu with Feed checked as the default', async () => {
    renderPanel();
    expect(screen.queryByTestId('run-inspect-menu')).toBeNull();
    await userEvent.click(await screen.findByTestId('run-inspect'));
    const menu = await screen.findByTestId('run-inspect-menu');
    expect(within(menu).getByTestId('tab-feed')).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByTestId('tab-timeline')).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByTestId('tab-unit-list')).toHaveAttribute('aria-checked', 'false');
  });

  it('Timeline is reachable through the menu — and Feed is one more click back', async () => {
    renderPanel();
    await userEvent.click(await screen.findByTestId('run-inspect'));
    await userEvent.click(await screen.findByTestId('tab-timeline'));
    // The evidence timeline (slice BB) renders; the menu closed on selection.
    expect(await screen.findByTestId('timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('run-inspect-menu')).toBeNull();
    expect(screen.queryByTestId('thread')).toBeNull();
    // Back to the story.
    await userEvent.click(screen.getByTestId('run-inspect'));
    await userEvent.click(await screen.findByTestId('tab-feed'));
    expect(await screen.findByTestId('thread')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline')).toBeNull();
  });

  it('Units is reachable through the menu (the crew#272 output blocks, unchanged)', async () => {
    renderPanel();
    await userEvent.click(await screen.findByTestId('run-inspect'));
    await userEvent.click(await screen.findByTestId('tab-unit-list'));
    // The units lens: output spine without the feed's narration header.
    expect(await screen.findByTestId('unit-output-0')).toBeInTheDocument();
    expect(screen.queryByTestId('feed-view-narrated')).toBeNull();
  });

  it('a LIVE run has no Inspect control — the feed is the only surface', async () => {
    renderPanel(makeView({ status: 'executing' }, [
      makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'distributed', assigned_cli: 'claude' }),
    ]));
    expect(await screen.findByTestId('thread')).toBeInTheDocument();
    expect(screen.queryByTestId('run-inspect')).toBeNull();
  });
});

describe('ChatPanel — the condensed one-row header (§8, revised)', () => {
  it('one header row: back + derived runTitle + status chip; the times strip is gone from the page chrome', async () => {
    renderPanel();
    const header = await screen.findByTestId('run-header');
    // Back, derived title (runTitle: intent · short-id · #attempt) and the
    // status chip all live in the ONE row.
    expect(within(header).getByLabelText('Back to run list')).toBeInTheDocument();
    expect(within(header).getByText('do the thing · run-1 · #1')).toBeInTheDocument();
    expect(within(header).getByText('Completed')).toBeInTheDocument();
    // The raw intent stays one hover away.
    expect(within(header).getByTitle('do the thing')).toBeInTheDocument();
    // started/ended/took moved into the What/Where insights panel — the run
    // page chrome no longer renders it.
    expect(screen.queryByTestId('run-times')).toBeNull();
  });

  it('Retry (post-mortem) renders inside the one header row', async () => {
    renderPanel(makeView({ status: 'failed' }, [
      makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'rejected', denial_reason: 'nope' }),
    ]));
    const header = await screen.findByTestId('run-header');
    expect(within(header).getByTestId('run-retry')).toBeInTheDocument();
    expect(within(header).getByTestId('run-inspect')).toBeInTheDocument();
  });
});
