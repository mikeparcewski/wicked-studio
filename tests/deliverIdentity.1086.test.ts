import { describe, expect, it } from 'vitest';
import { deliverIdentityOf, deliverTargetOf } from '../src/components/gateMoveModel.js';
import { makeUnit } from './factories.js';

const TARGET = 'Pushes the run branch wicked/r1 to origin (github.com/acme/shop) and opens a pull request there.';
const SENTENCES = [
  { shape: 1, login: 'mikeparcewski', source: 'the deliver identity setting', text: "Push identity: mikeparcewski (the deliver identity setting) — the phase pushes and opens the pull request with mikeparcewski's own gh token, whatever account gh has active." },
  { shape: 2, login: 'repo-bot', source: "this repository's push identity", text: "Push identity: repo-bot (this repository's push identity), pinned by GH_TOKEN — the phase refuses if that token authenticates as anyone else." },
  { shape: 3, login: null, source: null, text: 'Push identity: host-bot (GH_ACCOUNT) applies to github.com origins only; this push uses whatever credential the remote\'s host takes.' },
  { shape: 4, login: null, source: null, text: "Push identity: none configured — pushes as whatever login gh holds (set the deliver identity in system settings, or this repository's push identity, to pin it)." },
  { shape: 5, login: null, source: null, text: 'Push identity: the login of the exported GH_TOKEN (no push identity configured).' },
];

describe('studio#1086 — the push identity on the deliver card', () => {
  describe.each(['structured', 'legacy'] as const)('%s card', (kind) => {
    it.each(SENTENCES)('reads shape $shape without guessing a login', ({ login, source, text }) => {
      for (const tail of ['git pushes with the same token, not its own configured credential.', 'It refuses if the push identity changes.', '']) {
        const card = `${TARGET} ${text} ${tail}`.trim();
        const units = [makeUnit({ ord: 3, ...(kind === 'structured'
          ? { structured_description: true, instructions: card, description: 'deliver — intent ||| not the card' }
          : { description: `deliver — intent ||| APPROVED INTENT AMENDMENT (gate 2): keep the footer ||| ${card}` }) })];
        expect(deliverIdentityOf(units, 3)).toEqual({ login, source, text });
        expect(deliverTargetOf(units, 3)).toBe(TARGET);
      }
    });
  });

  it('returns null with no identity sentence, card, unit or ord', () => {
    const units = [makeUnit({ ord: 3, structured_description: true, instructions: TARGET })];
    expect(deliverIdentityOf(units, 3)).toBeNull();
    expect(deliverIdentityOf([makeUnit({ ord: 3, description: `deliver — intent ||| ${TARGET}` })], 3)).toBeNull();
    expect(deliverIdentityOf([makeUnit({ ord: 3, structured_description: true })], 3)).toBeNull();
    expect(deliverIdentityOf(units, 9)).toBeNull();
    expect(deliverIdentityOf(units, null)).toBeNull();
    expect(deliverIdentityOf(units, undefined)).toBeNull();
  });
});
