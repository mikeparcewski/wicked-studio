import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionView } from '../src/api/types.js';
import type { NerveState } from '../src/board/nerveCenter.js';

/**
 * THE SIDEBAR'S HEADINGS AND ICON RAIL (operator 2026-11-04, studio-sidebar-1104):
 *  1. Learn sits above Build & settings at the foot, always, unmarked (Home does the first run).
 *  2. Every heading (Work, Insight, Govern, Recent) folds: a real button with aria-expanded and aria-controls.
 *     What is open is this viewer's last session's (studio.sidebar.v1); nothing saved, or nothing readable:
 *     Work open, the rest shut. The heading holding the page on screen is marked and opened for this view
 *     only (not saved).
 *  3. The rail folds to its headings' icons: a group's icon opens its home page, Recent's unfolds the rail,
 *     and Nerve Center keeps its state's fill.
 */

const RUNS: SessionView[] = Array.from({ length: 3 }, (_, i) => ({
  session: { id: `u${i}`, status: 'completed', title: `Job ${i}`, problem: `Job ${i}`, created_at: 1_789_000_000 - i * 86_400, unit_ix: 0 },
  units: [],
} as unknown as SessionView));

// One stable model (a real board model keeps its arrays while nothing changes), so a re-render alone re-runs no effect.
const MODEL = { items: [], unfiled: RUNS, loading: false, error: null, failedAt: null };
vi.mock('../src/hooks/useBoardModel.js', () => ({ useBoardModel: () => MODEL }));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
let nerve: NerveState = { tone: 'green', read: 'ok', words: 'all clear', attention: [] } as unknown as NerveState;
vi.mock('../src/hooks/useNerveState.js', () => ({ useNerveState: () => nerve }));

const { SessionRail, railWidthPx, RAIL_ICONS_PX, SESSION_RAIL_PX } = await import('../src/components/desk/SessionRail.js');
const { NAV_GROUPS, groupHome, navGroups, SIDEBAR_SECTIONS } = await import('../src/board/navModel.js');
const { SIDEBAR_KEY, parseSidebar, resetSidebar, useSidebar } = await import('../src/store/sidebar.js');
const { RAIL_COLLAPSED_KEY } = await import('../src/hooks/useRailCollapsed.js');

const stored = (): unknown => JSON.parse(window.localStorage.getItem(SIDEBAR_KEY) ?? 'null');
const save = (v: unknown): void => { window.localStorage.setItem(SIDEBAR_KEY, typeof v === 'string' ? v : JSON.stringify(v)); resetSidebar(); };
const expanded = (): Record<string, string | null> => Object.fromEntries(
  [...screen.getByTestId('session-rail').querySelectorAll('[aria-expanded]')]
    .filter((b) => b.id.startsWith('rail-sec-') || b.id === 'rail-recent-label')
    .map((b) => [b.textContent?.replace(/\d.*$/u, '').trim() ?? '', b.getAttribute('aria-expanded')]),
);

function rail(pathname = '/', navigate = vi.fn()): ReturnType<typeof render> & { navigate: ReturnType<typeof vi.fn> } {
  return { ...render(<SessionRail runs={RUNS} needRows={[]} navigate={navigate} pathname={pathname} />), navigate };
}

beforeEach(() => { window.localStorage.clear(); resetSidebar(); nerve = { tone: 'green', read: 'ok', words: 'all clear', attention: [] } as unknown as NerveState; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Learn sits above Build & settings', () => {
  it('in the foot, before Build & settings, then Nerve Center; never in a group, never marked', () => {
    save({ open: SIDEBAR_SECTIONS });
    rail();
    const foot = screen.getByTestId('session-rail').querySelector('.wk-rail-foot')!;
    expect([...foot.querySelectorAll('a')].map((a) => a.dataset.testid)).toEqual(['nav-learn', 'desk-rail-build']);
    expect(screen.getByTestId('nav-learn')).toHaveAttribute('href', '/learn');
    expect(screen.getByTestId('nav-learn')).toHaveTextContent(/^Learn$/);
    expect(screen.getByTestId('rail-nav').querySelector('[data-testid="nav-learn"]')).toBeNull();
    expect(screen.getByTestId('session-rail').textContent).not.toContain('Start here');
    expect(navGroups({ sources: true }).flatMap((g) => g.items).some((i) => i.id === 'learn')).toBe(false);
    expect(screen.getByTestId('session-rail').lastElementChild).toContainElement(screen.getByTestId('desk-rail-nerve'));
  });

  it('is the current page on /learn', () => {
    rail('/learn');
    expect(screen.getByTestId('nav-learn')).toHaveAttribute('aria-current', 'page');
  });
});

describe('headings fold', () => {
  it('nothing saved: Work open, Insight, Govern and Recent shut, and nothing is written until you change it', () => {
    rail('/jobs');
    expect(expanded()).toEqual({ Work: 'true', Insight: 'false', Govern: 'false', Recent: 'false' });
    expect(screen.getByTestId('nav-jobs')).toBeVisible();
    expect(screen.queryByTestId('nav-report')).toBeNull();
    expect(screen.queryByTestId('nav-steering')).toBeNull();
    expect(screen.queryByTestId('rail-session')).toBeNull();
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it('each heading is a real button that names the list it controls; the list is there, hidden, while shut', () => {
    rail('/jobs');
    for (const id of ['work', 'insight', 'govern']) {
      const b = screen.getByTestId(`rail-sec-toggle-${id}`);
      expect(b.tagName).toBe('BUTTON');
      expect(b).toHaveAttribute('type', 'button');
      const list = document.getElementById(b.getAttribute('aria-controls')!);
      expect(list).not.toBeNull();
      expect(list!.hidden).toBe(b.getAttribute('aria-expanded') === 'false');
      // The group is named by its heading.
      expect(screen.getByRole('group', { name: NAV_GROUPS.find((g) => g.id === id)!.label })).toBe(screen.getByTestId(`rail-nav-${id}`));
    }
    const recent = screen.getByTestId('rail-recent-toggle');
    expect(document.getElementById(recent.getAttribute('aria-controls')!)!.hidden).toBe(true);
    // The chevron turns with aria-expanded (rail.css), so it is the same icon in both states.
    expect(recent.querySelector('.wk-rail-fold-chevron')).not.toBeNull();
  });

  it('a saved state is restored as it was', () => {
    save({ open: ['insight', 'recent'], icons: false });
    rail('/');
    expect(expanded()).toEqual({ Work: 'false', Insight: 'true', Govern: 'false', Recent: 'true' });
    expect(screen.getByTestId('nav-report')).toBeVisible();
    expect(screen.getAllByTestId('rail-session')).toHaveLength(3);
    expect(screen.queryByTestId('nav-projects')).toBeNull();
  });

  it.each([
    ['junk', '{not json'],
    ['a list, not the object', '["insight"]'],
    ['no open list', '{"icons":false}'],
    ['open is not a list', '{"open":"insight"}'],
    ['only names no heading has', '{"open":["apps-old",3,null]}'],
    ['nothing was open', '{"open":[]}'],
  ])('storage holding %s falls back: Work open, the rest shut', (_label, raw) => {
    save(raw);
    rail('/');
    expect(expanded()).toEqual({ Work: 'true', Insight: 'false', Govern: 'false', Recent: 'false' });
  });

  it('storage that throws falls back, and toggling still works for the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    resetSidebar();
    rail('/');
    expect(expanded()).toEqual({ Work: 'true', Insight: 'false', Govern: 'false', Recent: 'false' });
    act(() => { fireEvent.click(screen.getByTestId('rail-sec-toggle-insight')); });
    expect(screen.getByTestId('rail-sec-toggle-insight')).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggling is remembered: the next session opens what this one left open', () => {
    const { unmount } = rail('/');
    fireEvent.click(screen.getByTestId('rail-sec-toggle-govern'));
    fireEvent.click(screen.getByTestId('rail-recent-toggle'));
    fireEvent.click(screen.getByTestId('rail-sec-toggle-work'));
    expect(stored()).toEqual({ open: ['govern', 'recent'], icons: false });
    unmount();
    resetSidebar();
    rail('/');
    expect(expanded()).toEqual({ Work: 'false', Insight: 'false', Govern: 'true', Recent: 'true' });
  });

  it('shutting every heading holds for the session; the next one starts with Work open', () => {
    const { unmount } = rail('/');
    fireEvent.click(screen.getByTestId('rail-sec-toggle-work'));
    expect(expanded()).toEqual({ Work: 'false', Insight: 'false', Govern: 'false', Recent: 'false' });
    expect(stored()).toEqual({ open: [], icons: false });
    unmount();
    resetSidebar();
    rail('/');
    expect(expanded()['Work']).toBe('true');
  });

  it('Enter and Space toggle a heading from the keyboard', async () => {
    const user = userEvent.setup();
    rail('/');
    const b = screen.getByTestId('rail-sec-toggle-insight');
    b.focus();
    await user.keyboard('{Enter}');
    expect(b).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(b).toHaveFocus();
  });

  it('Recent, shut, still says how many of its sessions need you', () => {
    render(<SessionRail runs={RUNS} needRows={[{ key: 'fail:u0', kind: 'failed-run', severity: 100, stakes: 1, subject: 'x', text: 'Run failed', tone: 'fail', at: 1, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' } }] as never} navigate={() => {}} pathname="/" />);
    const t = screen.getByTestId('rail-recent-toggle');
    expect(t).toHaveAttribute('aria-expanded', 'false');
    expect(within(t).getByTestId('rail-recent-needs')).toHaveTextContent('1');
    expect(t).toHaveAccessibleName(/^Recent ?, 1 thing needs you$/u);
  });
});

describe('the page on screen is always findable', () => {
  it('under a shut heading: the heading opens for this view, is marked, and nothing is saved', () => {
    rail('/memory');
    const govern = screen.getByTestId('rail-sec-toggle-govern');
    expect(govern).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('nav-memory')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('rail-sec-home-govern')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('rail-nav-govern')).toHaveAttribute('data-here', 'true');
    // The other headings are not marked, and the view-only opening is not remembered.
    expect(screen.getByTestId('rail-sec-home-work')).not.toHaveAttribute('aria-current');
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it('shut again, it stays shut on that page and stays marked; the next page under it opens it again', () => {
    const { rerender } = rail('/memory');
    fireEvent.click(screen.getByTestId('rail-sec-toggle-govern'));
    expect(screen.getByTestId('rail-sec-toggle-govern')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('nav-memory')).toBeNull();
    expect(screen.getByTestId('rail-sec-home-govern')).toHaveAttribute('aria-current', 'true');
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
    rerender(<SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname="/agents" />);
    expect(screen.getByTestId('rail-sec-toggle-govern')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('nav-agents')).toHaveAttribute('aria-current', 'page');
    // Leaving the heading's pages shuts it again (it was only open for the view).
    rerender(<SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname="/jobs" />);
    expect(screen.getByTestId('rail-sec-toggle-govern')).toHaveAttribute('aria-expanded', 'false');
  });

  it('a session listed under Recent opens Recent for its view', () => {
    rail('/s/run%3Au1');
    const row = screen.getAllByTestId('rail-session').find((r) => r.getAttribute('href') === '/s/run%3Au1');
    expect(screen.getByTestId('rail-recent-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('rail-recent')).toHaveAttribute('data-here', 'true');
  });

  it('shutting a heading that is open and holds the page shuts it, on the first press (codex r1)', () => {
    // Nothing saved: Work is open by default and holds /jobs.
    const { rerender } = rail('/jobs');
    fireEvent.click(screen.getByTestId('rail-sec-toggle-work'));
    expect(screen.getByTestId('rail-sec-toggle-work')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('nav-jobs')).toBeNull();
    expect(stored()).toEqual({ open: [], icons: false });
    // Still marked, and a second press opens it again (and saves that).
    expect(screen.getByTestId('rail-sec-home-work')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByTestId('rail-sec-toggle-work'));
    expect(screen.getByTestId('rail-sec-toggle-work')).toHaveAttribute('aria-expanded', 'true');
    expect(stored()).toEqual({ open: ['work'], icons: false });
    // A restored heading holding the page: Govern on /memory.
    save({ open: ['work', 'govern'], icons: false });
    rerender(<SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname="/memory" />);
    fireEvent.click(screen.getByTestId('rail-sec-toggle-govern'));
    expect(screen.getByTestId('rail-sec-toggle-govern')).toHaveAttribute('aria-expanded', 'false');
    expect(stored()).toEqual({ open: ['work'], icons: false });
  });

  it('a project folded inside Recent opens for the view when it holds the session on screen; shutting it holds there, unsaved (codex r1)', () => {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, JSON.stringify(['']));
    const { rerender } = rail('/s/run%3Au1');
    const toggle = screen.getByTestId('rail-group-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('rail-session').find((r) => r.getAttribute('href') === '/s/run%3Au1')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(toggle);
    expect(screen.getByTestId('rail-group-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(window.localStorage.getItem(RAIL_COLLAPSED_KEY)!)).toEqual(['']);
    // Another session in it opens it again for its view; a page outside Recent leaves the saved fold alone.
    rerender(<SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname="/s/run%3Au2" />);
    expect(screen.getByTestId('rail-group-toggle')).toHaveAttribute('aria-expanded', 'true');
    save({ open: ['work', 'recent'], icons: false });
    rerender(<SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname="/jobs" />);
    expect(screen.getByTestId('rail-group-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('coming back to a page starts over: what you shut there opens again for the view (codex r2)', () => {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, JSON.stringify(['']));
    const at = (pathname: string) => <SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname={pathname} />;
    const { rerender } = render(at('/memory'));
    fireEvent.click(screen.getByTestId('rail-sec-toggle-govern'));
    expect(screen.getByTestId('rail-sec-toggle-govern')).toHaveAttribute('aria-expanded', 'false');
    rerender(at('/jobs'));
    rerender(at('/memory'));
    expect(screen.getByTestId('rail-sec-toggle-govern')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('nav-memory')).toHaveAttribute('aria-current', 'page');
    // The same for a project folded inside Recent: session A, then B, then A again.
    rerender(at('/s/run%3Au1'));
    fireEvent.click(screen.getByTestId('rail-group-toggle'));
    expect(screen.getByTestId('rail-group-toggle')).toHaveAttribute('aria-expanded', 'false');
    rerender(at('/s/run%3Au2'));
    rerender(at('/s/run%3Au1'));
    expect(screen.getByTestId('rail-group-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(window.localStorage.getItem(RAIL_COLLAPSED_KEY)!)).toEqual(['']);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it('shutting a project opened for the view re-measures the fade (codex r2)', () => {
    // The list overflows only while a session row is in it.
    const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('wk-rail-groups') ? (this.querySelector('[data-testid="rail-session"]') ? 600 : 100) : 0;
    });
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('wk-rail-groups') ? 200 : 0; });
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, JSON.stringify(['']));
    rail('/s/run%3Au1');
    const list = screen.getByTestId('session-rail').querySelector('.wk-rail-groups')!;
    expect(list).toHaveAttribute('data-more-below', 'true');
    fireEvent.click(screen.getByTestId('rail-group-toggle'));
    expect(list).toHaveAttribute('data-more-below', 'false');
    sh.mockRestore(); ch.mockRestore();
  });

  it('a heading opened by you stays open when you leave its pages', () => {
    rail('/memory');
    fireEvent.click(screen.getByTestId('rail-sec-toggle-govern')); // shut the view's opening
    fireEvent.click(screen.getByTestId('rail-sec-toggle-govern')); // open it for good
    expect(stored()).toEqual({ open: ['work', 'govern'], icons: false });
  });
});

describe('each heading has a home page', () => {
  it('Work: Projects, Insight: Report, Govern: Steering, each one of its own items', () => {
    expect(NAV_GROUPS.map((g) => [g.id, groupHome(g).path])).toEqual([['work', '/projects'], ['insight', '/report'], ['govern', '/rules']]);
    for (const g of navGroups({ sources: true })) expect(g.items.map((i) => i.id)).toContain(g.home);
    rail('/');
    expect(screen.getByTestId('rail-sec-home-insight')).toHaveAttribute('href', '/report');
    expect(screen.getByTestId('rail-sec-home-insight')).toHaveAccessibleName('Insight: Report');
  });
});

describe('the icon rail', () => {
  const icons = (): string[] => [...screen.getByTestId('session-rail').querySelectorAll('[data-rail-heading]')].map((e) => (e as HTMLElement).dataset.railHeading!);

  it('folds from the fold control, is remembered, and the shell lays it out narrower', () => {
    rail('/');
    expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'full');
    fireEvent.click(screen.getByTestId('rail-fold'));
    expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'icons');
    expect(screen.getByTestId('session-rail').style.width).toBe(`${RAIL_ICONS_PX}px`);
    expect(stored()).toEqual({ open: ['work'], icons: true });
    expect(railWidthPx(true, false)).toBe(RAIL_ICONS_PX);
    expect(railWidthPx(true, true)).toBe(SESSION_RAIL_PX);
    // Focus stays on the fold control, in its new place.
    expect(screen.getByTestId('rail-fold')).toHaveFocus();
    expect(screen.getByTestId('rail-fold')).toHaveAccessibleName('Expand the sidebar');
  });

  it('shows every heading as an icon with a name and a tooltip, in the sidebar\'s order', () => {
    save({ open: ['work'], icons: true });
    rail('/');
    expect(icons()).toEqual(['work', 'insight', 'govern', 'recent', 'learn', 'build', 'watch']);
    const named: Record<string, string> = {
      work: 'Work: Projects', insight: 'Insight: Report', govern: 'Govern: Steering', recent: 'Recent: expand the sidebar', learn: 'Learn', build: 'Build & settings',
    };
    for (const el of screen.getByTestId('session-rail').querySelectorAll<HTMLElement>('[data-rail-heading]')) {
      const id = el.dataset.railHeading!;
      if (id === 'watch') expect(el).toHaveAccessibleName(/^Nerve Center: all clear/u);
      else expect(el).toHaveAccessibleName(named[id]!);
      expect(el.title).not.toBe('');
      expect(el.querySelector('svg')).not.toBeNull();
      // Icons only: no words beside them.
      expect((el.textContent ?? '').trim()).toBe('');
    }
    // No heading's pages are listed in the icon rail.
    expect(screen.queryByTestId('rail-nav')).toBeNull();
  });

  it('a heading\'s icon opens its home page; Learn, Build & settings and Nerve Center open theirs', () => {
    save({ open: ['work'], icons: true });
    const { navigate } = rail('/');
    for (const [tid, path] of [['rail-sec-home-work', '/projects'], ['rail-sec-home-insight', '/report'], ['rail-sec-home-govern', '/rules'],
      ['nav-learn', '/learn'], ['desk-rail-build', '/build'], ['desk-rail-nerve', '/watch']] as const) {
      expect(screen.getByTestId(tid)).toHaveAttribute('href', path);
      fireEvent.click(screen.getByTestId(tid));
      expect(navigate).toHaveBeenLastCalledWith(path);
    }
    expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'icons');
  });

  it('Recent has no home page: its icon unfolds the rail with Recent open, and focus lands on its heading', () => {
    save({ open: ['work'], icons: true });
    const { navigate } = rail('/');
    fireEvent.click(screen.getByTestId('rail-recent-expand'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'full');
    expect(screen.getByTestId('rail-recent-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('rail-recent-toggle')).toHaveFocus();
    expect(stored()).toEqual({ open: ['work', 'recent'], icons: false });
  });

  it('the expand control and the brand unfold it (the brand is a pointer\'s way: out of the tab order, hidden from assistive tech)', () => {
    save({ open: ['work'], icons: true });
    rail('/');
    const brand = screen.getByTestId('desk-rail-brand-expand');
    expect(brand).toHaveAttribute('tabindex', '-1');
    expect(brand).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(brand);
    expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'full');
    expect(screen.getByTestId('rail-fold')).toHaveFocus();
    expect(screen.getByTestId('rail-fold')).toHaveAccessibleName('Collapse the sidebar');
    fireEvent.click(screen.getByTestId('rail-fold'));
    fireEvent.click(screen.getByTestId('rail-fold'));
    expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'full');
  });

  it('unfolding a rail that started folded still watches the list for more below (codex r1)', () => {
    const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('wk-rail-groups') ? 600 : 0; });
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('wk-rail-groups') ? 200 : 0; });
    save({ open: ['work'], icons: true });
    rail('/');
    fireEvent.click(screen.getByTestId('rail-fold'));
    expect(screen.getByTestId('session-rail').querySelector('.wk-rail-groups')).toHaveAttribute('data-more-below', 'true');
    sh.mockRestore(); ch.mockRestore();
  });

  it('the heading holding the page on screen is marked', () => {
    save({ open: ['work'], icons: true });
    rail('/understand');
    expect(screen.getByTestId('rail-sec-home-insight')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('rail-sec-home-work')).not.toHaveAttribute('aria-current');
  });

  it.each([
    ['green', 'ok', 'all clear', 'nothing needs you'],
    ['yellow', 'ok', 'disk low', 'needs a look'],
    ['red', 'ok', 'gateway down', 'work is blocked'],
  ] as const)('Nerve Center keeps its state colour (%s) at icon size, with the state in its name', (tone, read, words, said) => {
    nerve = { tone, read, words, attention: [] } as unknown as NerveState;
    save({ open: ['work'], icons: true });
    rail('/');
    const tile = screen.getByTestId('desk-rail-nerve');
    // The same tile class (its fill is `.wk-nc-tile[data-tone=…]`, sections/nerve.css), at icon size.
    expect(tile).toHaveClass('wk-nc-tile', 'wk-nc-tile--icon');
    expect(tile).toHaveAttribute('data-tone', tone);
    expect(tile).toHaveAccessibleName(`Nerve Center: ${words} — ${said}`);
    expect(screen.queryByTestId('nerve-center-words')).toBeNull();
  });

  it('a phone keeps its full drawer even when the rail was folded on a desktop', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      save({ open: ['work'], icons: true });
      rail('/');
      expect(screen.getByTestId('session-rail')).toHaveAttribute('data-rail', 'full');
      expect(screen.queryByTestId('rail-fold')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('studio.sidebar.v1, read', () => {
  it('keeps the headings it knows and the icon flag only when it is true', () => {
    expect([...parseSidebar('{"open":["govern","x","insight"],"icons":"yes"}').open]).toEqual(['govern', 'insight']);
    expect(parseSidebar('{"open":["govern"],"icons":"yes"}').icons).toBe(false);
    expect(parseSidebar(null)).toEqual({ open: new Set(['work']), icons: false });
    expect(useSidebar.getState().open).toEqual(new Set(['work']));
  });
});
