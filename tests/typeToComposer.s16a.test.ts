// S16a-2a: the session gate row is a radiogroup that picks by arrows / digits / Enter only — it
// declares `data-releases-letters`, so a typed LETTER goes on to the page's composer (§5.6 rule 4),
// while a digit stays with the row (it picks) and every other composite keeps its keys (rule 2).
import { afterEach, describe, expect, it } from 'vitest';
import { decideTyped, insideClaimingComposite } from '../src/hooks/useTypeToComposer.js';

afterEach(() => { document.body.innerHTML = ''; });

function key(k: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
}

describe('S16a-2a — letters leave a composite that releases them', () => {
  it('a letter typed on a gate choice goes to the page composer; a digit stays with the row', () => {
    document.body.innerHTML = `
      <div role="radiogroup" data-releases-letters="true"><button id="c" role="radio">Approve</button></div>
      <textarea data-type-target="page"></textarea>`;
    const choice = document.getElementById('c') as HTMLButtonElement;
    choice.focus();
    expect(insideClaimingComposite(choice, 'a')).toBe(false);
    expect(insideClaimingComposite(choice, '1')).toBe(true);
    expect(decideTyped(key('a')).kind).toBe('type');
    expect(decideTyped(key('1')).kind).toBe('none');
  });

  it('a composite that does not release letters keeps them', () => {
    document.body.innerHTML = `
      <div role="tablist"><button id="t" role="tab">One</button></div>
      <textarea data-type-target="page"></textarea>`;
    const tab = document.getElementById('t') as HTMLButtonElement;
    tab.focus();
    expect(insideClaimingComposite(tab, 'x')).toBe(true);
    expect(decideTyped(key('x')).kind).toBe('none');
  });
});
