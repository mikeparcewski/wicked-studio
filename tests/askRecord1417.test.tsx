import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ask } from '../src/api/ask.js';
import { AskCard, AskRecord } from '../src/components/ask/AskCard.js';

/**
 * studio#1417: a proposal card's record row that is still in progress ("Making the new version…", "Still making the
 * new version…") showed the same green check as a finished one, and so did an interrupted one; and an option that went
 * disabled after the person picked it still said "If you choose this: …". The records are the ones crew itself wrote
 * (tests/fixtures/chat-cut/go.json, `_source`), folded the way the chat folds them.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));
const { foldChatProposals, proposalRecordState, resetSettledProposals } = await import('../src/board/artifactProposal.js');
const { ArtifactProposalCard } = await import('../src/components/chat/ArtifactProposalCard.js');

type Fixture = { records: Array<Record<string, unknown>> };
const GO = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/chat-cut/go.json'), 'utf8')) as Fixture;

afterEach(() => { cleanup(); vi.restoreAllMocks(); resetSettledProposals(); });

const row = (): HTMLElement => screen.getByTestId('ask-record-row');
const card = (records: Array<Record<string, unknown>>) => {
  const [entry] = foldChatProposals(records);
  return render(<ArtifactProposalCard chatId={String(entry!.proposal.chatId)} entry={entry!} seatName="Claude Code" stub={false} onChanged={() => {}} />);
};

describe('a record row says whether it is done (studio#1417)', () => {
  it('done, in progress, or stopped: only done shows the check', () => {
    const { rerender } = render(<AskRecord line="You chose: Change the video" />);
    expect(row()).toHaveAttribute('data-state', 'done');
    expect(row().querySelector('.wk-ask-record-ok')).not.toBeNull();
    rerender(<AskRecord line="Making the new version…" state="progress" />);
    expect(row()).toHaveAttribute('data-state', 'progress');
    expect(row().querySelector('.wk-ask-record-ok')).toBeNull();
    expect(row().querySelector('.wk-ask-record-progress')).not.toBeNull();
    rerender(<AskRecord line="Interrupted before the new version was recorded." state="stopped" />);
    expect(row()).toHaveAttribute('data-state', 'stopped');
    expect(row().querySelector('.wk-ask-record-ok')).toBeNull();
  });

  it('a proposal\'s record: starting and still making are in progress, interrupted is stopped, decided is done', () => {
    const [accepting] = foldChatProposals(GO.records.slice(0, 2));
    const [decided] = foldChatProposals(GO.records);
    expect(proposalRecordState(accepting!, true, false)).toBe('progress');
    expect(proposalRecordState(accepting!, false, true)).toBe('progress');
    expect(proposalRecordState(accepting!, false, false)).toBe('stopped');
    expect(proposalRecordState(decided!, false, false)).toBe('done');
  });

  it('the cut card right after Go: "Making the new version…" with no check', () => {
    const [accepting] = foldChatProposals(GO.records.slice(0, 2));
    vi.spyOn(Date, 'now').mockReturnValue(accepting!.acceptingAt! + 1_000);
    card(GO.records.slice(0, 2));
    expect(screen.getByTestId('artifact-proposal-record')).toHaveTextContent('Making the new version…');
    expect(row()).toHaveAttribute('data-state', 'progress');
    expect(row().querySelector('.wk-ask-record-ok')).toBeNull();
  });

  it('the cut card long after an unrecorded Go: interrupted, with no check', () => {
    card(GO.records.slice(0, 2));
    expect(screen.getByTestId('artifact-proposal-record')).toHaveTextContent(/^Interrupted/);
    expect(row()).toHaveAttribute('data-state', 'stopped');
    expect(row().querySelector('.wk-ask-record-ok')).toBeNull();
  });

  it('the cut card once crew recorded the change: the check', () => {
    card(GO.records);
    expect(row()).toHaveAttribute('data-state', 'done');
    expect(row().querySelector('.wk-ask-record-ok')).not.toBeNull();
  });
});

describe('a disabled option says no consequence (studio#1417)', () => {
  const ask = (goDisabled?: string): Ask => ({
    id: 'a1', host: 'chat', from: { kind: 'seat', id: 'claude', label: 'Claude Code' }, prompt: 'Change the video?', kind: 'choose',
    answeredBy: 'person', record: 'You chose: {label}',
    options: [
      { id: 'go', token: 'go', label: 'Change the video', consequence: 'The new version plays in the editor.', recommended: true, ...(goDisabled !== undefined ? { disabled: goDisabled } : {}) },
      { id: 'later', token: 'later', label: 'Not now', consequence: 'Nothing changes.' },
    ],
  } as unknown as Ask);

  it('the picked option goes disabled: its "If you choose this" goes, and why it is off stays', async () => {
    const { rerender } = render(<AskCard ask={ask()} header={false} onAnswer={() => undefined} />);
    // The person's own pick: the card keeps it even when the option is refused afterwards.
    await act(async () => { fireEvent.click(screen.getAllByTestId('ask-option').find((el) => el.textContent?.includes('Change the video'))!); });
    expect(screen.getByTestId('ask-consequence')).toHaveTextContent('If you choose this: The new version plays in the editor.');
    rerender(<AskCard ask={ask('The video moved on; open it again to change it.')} header={false} onAnswer={() => undefined} />);
    expect(screen.getByTestId('ask-consequence')).toBeEmptyDOMElement();
    expect(screen.getByTestId('ask-option-why')).toHaveTextContent('The video moved on');
  });

  // Pins today's behaviour (a disabled card hears no hover), so the fix keeps it.
  it('a disabled option is no preview either', async () => {
    render(<AskCard ask={{ ...ask('Not available now'), default: 'later' } as Ask} header={false} onAnswer={() => undefined} />);
    const go = screen.getAllByTestId('ask-option').find((el) => el.textContent?.includes('Change the video'))!;
    await act(async () => { fireEvent.mouseEnter(go); });
    expect(screen.getByTestId('ask-consequence-preview')).toBeEmptyDOMElement();
    expect(screen.getByTestId('ask-consequence')).toHaveTextContent('If you choose this: Nothing changes.');
  });
});
