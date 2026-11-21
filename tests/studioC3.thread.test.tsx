import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as teamFold from '../src/hooks/useTeamFold.js';
import { api } from '../src/api/client.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { ChainLine } from '../src/components/session/ChainLine.js';
import { chainFromUnits } from '../src/board/chainModel.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView } from './factories.js';

beforeEach(() => {
  useCapabilities.setState({ loaded: true, runChatId: true } as never);
  useRunEventStore.setState({ byRun: { r1: [] } });
  vi.spyOn(api, 'getChat').mockResolvedValue({ chatId: 'chat-c3', seats: [], scope: null, messages: [] } as never);
  vi.spyOn(api, 'getWatch').mockRejectedValue(new Error('404'));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['Fix it.', ''])('a closed chat quotes only the person’s intent (%s)', async (intent) => {
  const view = makeView({ id: 'r1', status: 'completed', problem: `${intent}\n\n<!-- wicked-crew:linked-issues -->\n## Linked issues\n#995`, chat_id: 'chat-c3' } as never);
  render(<SessionPage sessionId="chat-c3" runs={[view]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
  await screen.findByTestId('session-closed-line');
  const bubbles = screen.queryAllByTestId('session-turn').filter((t) => t.dataset['who'] === 'you');
  expect(bubbles).toHaveLength(intent ? 1 : 0);
  if (intent) {
    expect(within(bubbles[0]!).getByText('Fix it.')).toBeInTheDocument();
    expect(bubbles[0]).not.toHaveTextContent(/wicked-crew|Linked issues|#995/);
  }
});

it.each(['units', 'team'] as const)('keeps the team read error behind Technical details (%s)', (source) => {
  const raw = 'the daemon refused this — w2 fixture: no team state for b1';
  render(<ChainLine runId="r1" chain={{ ...chainFromUnits(makeView()), source }} teamError={raw} onRetry={() => {}} />);
  const row = screen.getByTestId('chain-team-error');
  const details = within(row).getByTestId('tech-details');
  expect(details).toHaveTextContent(raw);
  expect(details).not.toHaveAttribute('open');
  const face = row.cloneNode(true) as HTMLElement;
  face.querySelector('details')?.remove();
  expect(face.textContent).not.toMatch(/daemon refused|w2 fixture/);
  expect(face.textContent).toContain(source === 'team' ? "Couldn’t read the team plan, so this is the plan as last read." : "Couldn’t read the team plan, so these are the run’s own steps.");
});

it('the Ask team error keeps the wire sentence in its folded detail', async () => {
  const raw = 'the daemon refused this — w2 fixture: no team state for b1';
  vi.spyOn(teamFold, 'useTeamFold').mockReturnValue({ fold: null, error: raw, retry: () => {} });
  render(<SessionPage sessionId="chat-c3" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
  const line = await screen.findByTestId('ask-line');
  expect(line).toHaveTextContent("Couldn’t read the team’s rows; the conversation shows without them.");
  expect(line).not.toHaveTextContent(/daemon refused|w2 fixture/);
  fireEvent.click(within(line).getByTestId('ask-line-toggle'));
  expect(within(line).getByTestId('ask-line-detail')).toHaveTextContent(raw);
});
