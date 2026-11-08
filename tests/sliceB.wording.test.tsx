/**
 * SLICE B — plain words where a new user would be lost: the helper no one signed in, the composer that
 * refused, the picker's label, estate's raw index output, and the floating chat button at a phone width.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliOption } from '../src/board/chatCli.js';
import { ChatCliPicker } from '../src/components/chat/ChatCliPicker.js';
import { noHelperNotice } from '../src/components/AskDock.js';
import { estateStepSummary } from '../src/components/session/RunConversation.js';
import { isHelperSeat } from '../src/board/responder.js';
import { composerSendRefusal, NO_HELPER_AVAILABLE, NO_HELPER_SIGNED_IN } from '../src/board/launchModel.js';
import type { RosterSeat } from '../src/api/types.js';

afterEach(cleanup);

const opt = (over: Partial<CliOption>): CliOption => ({ key: 'k', label: 'K', ok: true, reason: null, signInPath: null, optIn: false, ...over });

describe('B-P8: the picker says helper, never CLI', () => {
  it('no options reads “No helper”; options with nothing picked read “Pick a helper”', () => {
    const { rerender } = render(<ChatCliPicker options={[]} value={null} onChange={() => {}} locked={false} />);
    expect(screen.getByTestId('chat-cli')).toHaveTextContent('No helper');
    rerender(<ChatCliPicker options={[opt({ key: 'claude', label: 'Claude Code' })]} value={null} onChange={() => {}} locked={false} />);
    expect(screen.getByTestId('chat-cli')).toHaveTextContent('Pick a helper');
    // No stray "CLI" jargon in the picker's words.
    expect(screen.getByTestId('chat-cli').textContent).not.toMatch(/CLI/);
  });
});

describe('B-C6a: noHelperNotice is ONE plain line, never the per-helper list', () => {
  it('all signed out → “No helper is signed in yet.”; mixed → “No helper can answer right now.”', () => {
    const allOut = [opt({ key: 'a', label: 'Claude', ok: false, reason: 'signed out', signInPath: '/agents?fix=a' }),
      opt({ key: 'b', label: 'Codex', ok: false, reason: 'signed out', signInPath: '/agents?fix=b' })];
    expect(noHelperNotice(allOut)?.line).toBe(NO_HELPER_SIGNED_IN);
    const mixed = [opt({ key: 'a', label: 'Claude', ok: false, reason: 'signed out', signInPath: '/agents?fix=a' }),
      opt({ key: 'b', label: 'Copilot', ok: false, reason: 'out of quota' })];
    expect(noHelperNotice(mixed)?.line).toBe(NO_HELPER_AVAILABLE);
    // The reasons ride a disclosure list, never the line.
    expect(noHelperNotice(mixed)?.reasons).toEqual(['Claude: signed out', 'Copilot: out of quota']);
    // At least one can answer → no notice; an empty roster is a different surface.
    expect(noHelperNotice([opt({ ok: true }), opt({ key: 'z', ok: false, reason: 'x' })])).toBeNull();
    expect(noHelperNotice([])).toBeNull();
  });
});

describe('B-C6b: composerSendRefusal keeps the line plain and the reasons apart', () => {
  it('signed-out seats → the signed-in line + a sign-in link, reasons listed separately', () => {
    const out = (reason: string) => ({ ok: false, reason });
    const so = (key: string, name: string): RosterSeat => ({
      key, display_name: name, binary: key, enabled_for_council: true, auth: 'signed_out', signed_in: false,
      chat_admission: { unscoped: out('signed out'), scoped: out('signed out') },
    } as unknown as RosterSeat);
    const r = composerSendRefusal([so('claude', 'Claude Code'), so('codex', 'Codex')], false);
    expect(r?.line).toBe(NO_HELPER_SIGNED_IN);
    expect(r?.signIn).toBe(true);
    expect(r?.line).not.toMatch(/signed out/); // the per-helper words stay out of the line
    expect(r?.reasons).toEqual(['Claude Code: signed out', 'Codex: signed out']);
  });
});

describe('B-P7: estate’s own tool seat is not a helper, and its raw output reads plainly', () => {
  it('isHelperSeat is false for wicked-estate, true for a coding helper', () => {
    expect(isHelperSeat('wicked-estate')).toBe(false);
    expect(isHelperSeat('claude')).toBe(true);
  });
  it('estateStepSummary summarises index / annotate output; other steps stay raw (null)', () => {
    const raw = 'annotated 6 member(s) across 1 community/communities … modularity=0.000';
    expect(estateStepSummary('wicked-estate', 'Annotate', raw)).toBe('Annotated the code map');
    expect(estateStepSummary('wicked-estate', 'Index', 'indexed 42 members')).toBe('Mapped the code');
    // A helper's own step is never summarised.
    expect(estateStepSummary('claude', 'Build', raw)).toBeNull();
  });
});
