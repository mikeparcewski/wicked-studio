/**
 * J6 S1: the scope card read only (a chat job, whose Start carries its words alone) and the finished job's line that
 * says the model. Crew's own answer shapes (tests/fixtures/domain-v3/README.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DomainModel, DomainScopeCard as Card } from '../src/api/domainModel-wire.js';
import { DomainScopeCard } from '../src/components/launch/DomainScopeCard.js';
import { domainResultWords } from '../src/components/session/JobPassage.js';
import { domainJobResultOf } from '../src/board/requirementsState.js';

const fx = <T,>(n: string): T => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'domain-v3', n), 'utf8')) as T;
const CARD = fx<Card>('scope-mini-cobol.crew.json');
const RULED = fx<DomainModel>('model-after-rulings.crew.json');

describe('the scope card on a chat job', () => {
  it('shows what the words cover, offers no edits, and says how to change it', () => {
    render(<DomainScopeCard scope={{ status: 'ready', card: CARD }} writer={{ name: 'Claude Code', signedOut: false }} checker={{ name: 'Codex', signedOut: true }} />);
    expect(screen.getByTestId('domain-scope-phrase')).toHaveTextContent('PAYCALC1');
    expect(screen.queryByTestId('domain-scope-drop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('domain-scope-add-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('domain-scope-readonly')).toHaveTextContent('Start maps what these words cover. To change it, change the words.');
    expect(screen.getByTestId('domain-scope-seats')).toHaveTextContent('Writer: Claude Code · Checker: Codex (signed out)');
  });
});

describe('a finished domain job', () => {
  it('says the model as the model view does, and an older graph as before', () => {
    const r = domainJobResultOf({ items: [], model: RULED });
    expect(domainResultWords(r)).toBe('Mapped the domain: 1 rule · 2 checked statements · 1 follow-up · 3 of 4 targets accounted.');
    expect(domainResultWords(domainJobResultOf({ items: [] }))).toBe('The requirements map is built.');
  });
});
