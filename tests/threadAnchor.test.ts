// The version → message cross-link resolver — DES-MERGE-001 §7.6.
//
// The anchor is `meta.sourceMessageId` and the thread publishes the other half of the
// contract (`data-testid="thread"` + `data-message-id`). What is asserted here is the
// resolution itself: a hit scrolls AND focuses, a miss is reported rather than thrown,
// and an id that would otherwise break a selector still resolves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollThreadToMessage } from '../src/components/threadAnchor.js';

function mountThread(...messageIds: string[]): void {
  document.body.innerHTML =
    `<div data-testid="thread">${messageIds
      .map((id) => `<div data-message-id="${id}">message ${id}</div>`)
      .join('')}</div>`;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('scrollThreadToMessage (§7.6)', () => {
  it('puts the anchored message in view (smoothly, §5.5) and focuses it', () => {
    mountThread('msg-1', 'msg-2');
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');

    expect(scrollThreadToMessage('msg-2')).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('data-message-id')).toBe('msg-2');
    // Focusable programmatically only — the cross-link target is not a new tab stop.
    expect(focused).toHaveAttribute('tabindex', '-1');
  });

  it('flashes the anchored message once — wk-anchor-flash on, removed on animationend (§5.5, §1.6)', () => {
    mountThread('msg-1');
    expect(scrollThreadToMessage('msg-1')).toBe(true);
    const el = document.querySelector('[data-message-id="msg-1"]') as HTMLElement;
    expect(el.classList.contains('wk-anchor-flash')).toBe(true);
    // The class retires with its one animation run, so a later select flashes again.
    el.dispatchEvent(new Event('animationend'));
    expect(el.classList.contains('wk-anchor-flash')).toBe(false);
    expect(scrollThreadToMessage('msg-1')).toBe(true);
    expect(el.classList.contains('wk-anchor-flash')).toBe(true);
  });

  it('leaves an existing tabindex alone', () => {
    document.body.innerHTML =
      '<div data-testid="thread"><div data-message-id="m" tabindex="0">m</div></div>';
    expect(scrollThreadToMessage('m')).toBe(true);
    expect(document.querySelector('[data-message-id="m"]')).toHaveAttribute('tabindex', '0');
  });

  it('reports a miss instead of throwing when the message is not in the thread', () => {
    mountThread('msg-1');
    expect(scrollThreadToMessage('msg-9')).toBe(false);
  });

  it('reports a miss when no thread is mounted (Document mode before slice 10)', () => {
    document.body.innerHTML = '<div data-message-id="msg-1">orphan</div>';
    expect(scrollThreadToMessage('msg-1')).toBe(false);
  });

  it('resolves an id that would otherwise break the selector', () => {
    mountThread('a b&quot;c');
    expect(scrollThreadToMessage('a b"c')).toBe(true);
  });
});
