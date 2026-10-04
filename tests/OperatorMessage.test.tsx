import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OperatorMessage } from '../src/components/OperatorMessage.js';
import { PACK_JOIN, PACK_OPENING, splitAskContext } from '../src/components/askContext.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';

/**
 * studio#468: Ask's context pack rides the operator's first message and is stored with it. A
 * transcript shows what the operator typed; the pack is one quiet line that opens — and a pack
 * stored before it dropped its paths still shows them as `~/…` in the default layer.
 */
const PACK = `${PACK_OPENING}2026-10-03T14:00:00.000Z]\nwhere: Desk (/)\n  stores: core.db 11.8 MB (/Users/reel-operator/.wicked-crew/core.db)`;
const STORED = `why is the build slow?${PACK_JOIN}${PACK}`;

describe('splitAskContext', () => {
  it('splits a stored message at the pack\'s own opening', () => {
    expect(splitAskContext(STORED)).toStrictEqual({ typed: 'why is the build slow?', pack: PACK });
  });
  it('a message with no pack — even one with its own --- line — is all the operator\'s', () => {
    expect(splitAskContext('plain')).toStrictEqual({ typed: 'plain', pack: null });
    const own = 'first part\n\n---\nsecond part';
    expect(splitAskContext(own)).toStrictEqual({ typed: own, pack: null });
  });
});

describe('OperatorMessage', () => {
  beforeEach(() => {
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
  });

  it('shows what was typed; the pack is folded behind one line and names no home directory', () => {
    const { container } = render(<p><OperatorMessage text={STORED} /></p>);
    expect(container.textContent).toContain('why is the build slow?');
    expect(container.textContent).not.toContain('studio context pack');
    expect(container.textContent).not.toContain('reel-operator');
    fireEvent.click(screen.getByTestId('context-sent-toggle'));
    const pack = screen.getByTestId('context-sent-pack').textContent ?? '';
    expect(pack).toContain('[studio context pack');
    expect(pack).toContain('(~/.wicked-crew/core.db)');
    expect(pack).not.toContain('reel-operator');
  });

  it('a message with no pack renders as it is, with no extra line', () => {
    const { container } = render(<p><OperatorMessage text="just a question" /></p>);
    expect(container.textContent).toBe('just a question');
    expect(screen.queryByTestId('context-sent')).toBeNull();
  });
});
