/**
 * (J6 S1, DES-j6-build S2) The scope card on a domain model launch's review step: what the words matched in the code,
 * what matched nothing, the files and targets the run states rules for, where the code is reached from, and the two
 * helpers the run uses. A phrase can be dropped or one typed; either asks crew for the card again.
 */
import { useState } from 'react';
import type { DomainScopeCard as Card } from '../../api/domainModel-wire.js';
import { cardPhrases, matchedLine, scopeSizeLine } from '../../board/domainModel.js';
import type { RosterSeat } from '../../api/types.js';
import type { DomainScopeState } from '../../hooks/useDomainScope.js';
import { seatJoinStanding } from '../gateVerdictModel.js';

/** A helper the run uses, and whether it can take work now (null: not known). `missing`: the roster, once read, does
 *  not list it on this computer. */
export interface ScopeSeat { name: string; signedOut: boolean | null; missing?: boolean }

/** The roster's word on a helper the run uses: signed out, or not listed (nothing known before the roster is read). */
export function domainScopeSeat(roster: readonly RosterSeat[] | null, key: string, name: string): ScopeSeat {
  if (roster === null) return { name, signedOut: null };
  const s = roster.find((r) => r.key === key);
  return s === undefined ? { name, signedOut: null, missing: true } : { name, signedOut: seatJoinStanding(s).state === 'signed-out' };
}

export function DomainScopeCard({ scope, writer, checker, onDrop, onAdd }: {
  scope: DomainScopeState;
  writer: ScopeSeat;
  checker: ScopeSeat;
  /** Absent (a chat job, whose Start carries the words alone): the card is read only, and says how to change it. */
  onDrop?: (phrase: string) => void;
  onAdd?: (phrase: string) => void;
}): React.ReactElement | null {
  if (scope.status === 'off') return null;
  return (
    <section className="wk-scope-card" data-testid="domain-scope-card" data-state={scope.status} aria-live="polite">
      <h3 className="wk-scope-card-title">What the model covers</h3>
      {scope.status === 'loading' && <p data-testid="domain-scope-loading">Reading the code for these words… (no model is called)</p>}
      {scope.status === 'failed' && <p data-testid="domain-scope-error" className="wk-domain-error">No scope yet: {scope.error}</p>}
      {scope.status === 'ready' && <Ready card={scope.card} onDrop={onDrop} onAdd={onAdd} />}
      {scope.status === 'ready' && (onDrop === undefined || onAdd === undefined) && (
        <p className="wk-scope-card-size" data-testid="domain-scope-readonly">Start maps what these words cover. To change it, change the words.</p>
      )}
      <p className="wk-scope-seats" data-testid="domain-scope-seats">
        Writer: {seatWords(writer)} · Checker: {seatWords(checker)}
      </p>
    </section>
  );
}

function seatWords(s: ScopeSeat): string {
  return s.missing === true ? `${s.name} (not set up on this computer)` : s.signedOut === true ? `${s.name} (signed out)` : s.name;
}

function Ready({ card, onDrop, onAdd }: { card: Card; onDrop?: ((p: string) => void) | undefined; onAdd?: ((p: string) => void) | undefined }): React.ReactElement {
  const [typed, setTyped] = useState('');
  const phrases = cardPhrases(card);
  const add = (): void => {
    const t = typed.trim();
    if (t === '' || t.length > 200 || onAdd === undefined) return;
    onAdd(t);
    setTyped('');
  };
  return (
    <>
      <p className="wk-scope-card-size" data-testid="domain-scope-size">{scopeSizeLine(card)}</p>
      <ul className="wk-scope-phrases" data-testid="domain-scope-phrases">
        {phrases.map((p) => {
          const names = card.phrases[p] ?? [];
          const matched = names.length > 0;
          return (
            <li key={p} className="wk-scope-phrase" data-matched={matched ? 'true' : 'false'} data-testid="domain-scope-phrase">
              <span className="wk-scope-phrase-name">{p}</span>
              <span className="wk-scope-phrase-code">{matched ? matchedLine(names) : 'matched no code: name a file, program or function instead'}</span>
              {onDrop !== undefined ? (
                <button type="button" className="wk-link" data-testid="domain-scope-drop" aria-label={`Drop “${p}”`} disabled={phrases.length <= 1} onClick={() => onDrop(p)}>
                  Drop
                </button>
              ) : <span />}
            </li>
          );
        })}
      </ul>
      {onAdd !== undefined && <form className="wk-scope-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          className="wk-field"
          data-testid="domain-scope-add-input"
          aria-label="Add a phrase: a file, program or function name"
          placeholder="Add a file, program or function name"
          maxLength={200}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="wk-btn" data-testid="domain-scope-add" disabled={typed.trim() === ''}>Add</button>
      </form>}
      {card.files.length > 0 && (
        <details data-testid="domain-scope-files">
          <summary>{card.files.length === 1 ? '1 file' : `${card.files.length} files`} in scope</summary>
          <ul className="wk-scope-list">{card.files.map((f) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}
      {card.reachedFrom.length > 0 && (
        <div data-testid="domain-scope-reached">
          <span>Reached from</span>
          <ul className="wk-scope-list">
            {card.reachedFrom.map((r) => <li key={r}>{r}</li>)}
            {card.reachedMore > 0 && <li>+{card.reachedMore} more</li>}
          </ul>
        </div>
      )}
      {card.questions.length > 0 && (
        <div data-testid="domain-scope-questions">
          <span>Not settled by the code alone</span>
          <ul className="wk-scope-list">{card.questions.map((q) => <li key={q}>{q}</li>)}</ul>
        </div>
      )}
    </>
  );
}
