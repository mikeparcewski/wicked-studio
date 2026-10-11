import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmptyState, OverflowMenu, Progress, Segmented, StatLine, StateBanner, Switch, Tabs, TechDetails } from '../src/components/ui/index.js';
import { displaySeats, seatLabel, seatRoleWord, userSeats } from '../src/board/seatNames.js';
import { chatStatusWord, statusWord } from '../src/board/statusWords.js';
import { relTime } from '../src/board/relTime.js';
import { ApiError, readErrorKind } from '../src/api/errors.js';

/** UI-CONTRACT §4/§5 (design/UI-CONTRACT.md): the shared primitives the section lanes build on. */
afterEach(cleanup);

describe('TechDetails (§4.3, studio#682)', () => {
  it('is closed by default and sanitizes home and temp paths', () => {
    render(<TechDetails text={'WICKED_SKILLS_SNAPSHOT=/Users/alice/.wicked/snap refused; tmp /var/folders/ab/xyz123/T/run'} />);
    const d = screen.getByTestId('tech-details') as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.textContent).toContain('~/.wicked/snap');
    expect(d.textContent).not.toContain('/Users/alice');
    expect(d.textContent).toContain('$TMPDIR');
  });
  it('renders nothing for empty text', () => {
    const { container } = render(<TechDetails text={['', '  ']} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('StateBanner (§4.7, studio#684)', () => {
  it('offline: plain sentence, a real Retry button, the raw error only inside the closed details', () => {
    const onRetry = vi.fn();
    render(<StateBanner kind="offline" error="TypeError: Failed to fetch" onRetry={onRetry} />);
    const b = screen.getByTestId('state-banner');
    const sentence = b.querySelector('.wk-state-banner-text')!.textContent!;
    expect(sentence).toBe('Studio can’t reach its service right now.');
    expect(sentence).not.toMatch(/fetch/i);
    const retry = screen.getByTestId('state-banner-retry');
    expect(retry.tagName).toBe('BUTTON');
    expect(retry.className).toContain('wk-btn');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    expect((screen.getByTestId('state-banner-detail') as HTMLDetailsElement).open).toBe(false);
  });
  it('error names what failed; retrying disables the button', () => {
    render(<StateBanner kind="error" what="skills" onRetry={() => {}} retrying />);
    expect(screen.getByText('Couldn’t load skills.')).toBeTruthy();
    expect((screen.getByTestId('state-banner-retry') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('state-banner-retry').textContent).toBe('Retrying…');
  });
  it('EmptyState says it once with an action', () => {
    render(<EmptyState title="No rules yet." action={<button type="button">Add a rule</button>} />);
    expect(screen.getAllByText('No rules yet.')).toHaveLength(1);
  });
});

describe('Tabs (§4.4)', () => {
  const tabs = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
  it('shows at most 5 tabs and puts the rest behind a More button that is not a tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="t0" onChange={onChange} aria-label="Session" idBase="s" />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    const more = screen.getByTestId('tabs-more-button');
    expect(more.getAttribute('role')).toBeNull();
    fireEvent.click(more);
    fireEvent.click(screen.getByText('Tab 7'));
    expect(onChange).toHaveBeenCalledWith('t7');
  });
  it('an active overflow tab is swapped into the tablist, selected, with its id', () => {
    render(<Tabs tabs={tabs} active="t8" onChange={() => {}} aria-label="Session" idBase="s" />);
    const sel = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(sel.map((t) => t.id)).toEqual(['s-tab-t8']);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });
  it('tabTestId stamps every tab button (with data-tab); absent by default', () => {
    render(<Tabs tabs={tabs.slice(0, 3)} active="t0" onChange={() => {}} aria-label="x" idBase="x" tabTestId="sheet-tab" />);
    expect(screen.getAllByTestId('sheet-tab').map((b) => b.dataset['tab'])).toEqual(['t0', 't1', 't2']);
    cleanup();
    render(<Tabs tabs={tabs.slice(0, 3)} active="t0" onChange={() => {}} aria-label="x" idBase="x" />);
    expect(screen.queryAllByTestId('sheet-tab')).toHaveLength(0);
  });
  it('few tabs: no More', () => {
    render(<Tabs tabs={tabs.slice(0, 3)} active="t0" onChange={() => {}} aria-label="x" idBase="x" />);
    expect(screen.queryByTestId('tabs-more-button')).toBeNull();
  });
});

describe('Progress, StatLine (§4.6, audit rows 8, 42)', () => {
  it('0 of 2 is an empty track, never full', () => {
    render(<Progress value={0} total={2} label="0 of 2 landed" />);
    expect((screen.getByTestId('progress-fill') as HTMLElement).style.width).toBe('0%');
  });
  it('1 of 4 fills a quarter; total 0 says Nothing yet', () => {
    render(<><Progress value={1} total={4} label="a" data-testid="p1" /><Progress value={0} total={0} label="b" data-testid="p2" /></>);
    expect((screen.getByTestId('p1-fill') as HTMLElement).style.width).toBe('25%');
    expect(screen.getByTestId('p2').textContent).toContain('Nothing yet');
  });
  it('StatLine hides zeros and unknowns, no placeholder', () => {
    render(<StatLine items={[{ label: 'repositories', value: 10 }, { label: 'failing', value: 0 }, { label: 'active', value: null }]} />);
    expect(screen.getByTestId('stat-line').textContent).toBe('10 repositories');
  });
});

describe('Switch, Segmented, OverflowMenu', () => {
  it('Switch is role=switch with its label inside', () => {
    const on = vi.fn();
    render(<Switch label="Show technical details" checked={false} onChange={on} />);
    const s = screen.getByRole('switch', { name: 'Show technical details' });
    fireEvent.click(s);
    expect(on).toHaveBeenCalledWith(true);
  });
  it('Segmented: arrows select the next option', () => {
    const on = vi.fn();
    render(<Segmented label="Theme" value="a" options={[{ value: 'a', label: 'Light' }, { value: 'b', label: 'Dark' }]} onChange={on} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Light' }), { key: 'ArrowRight' });
    expect(on).toHaveBeenCalledWith('b');
  });
  it('OverflowMenu: Escape closes and returns focus to the button', () => {
    const pick = vi.fn();
    render(<OverflowMenu label="More actions for run" items={[{ id: 'a', label: 'Archive', onSelect: pick }]} />);
    const btn = screen.getByTestId('overflow-menu-button');
    fireEvent.click(btn);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe('copy rules (§5)', () => {
  const roster = [
    { key: 'claude', display_name: 'Claude Code', binary: 'claude' },
    { key: 'claude-judge', display_name: 'Claude Code (judge)', binary: 'claude' },
    { key: 'pi', display_name: '', binary: 'pi' },
    { key: 'wicked-estate', display_name: 'wicked-estate' },
  ];
  it('one name per helper; judge and non-CLI never addressable', () => {
    expect(userSeats(roster).map(seatLabel)).toEqual(['Claude Code', 'Pi']);
    expect(displaySeats(roster).map(seatLabel)).toEqual(['Claude Code', 'Claude Code', 'Pi']);
    expect(seatRoleWord(roster[1]!)).toBe('Reviewer only');
  });
  it('one status word per state, archived first', () => {
    const v = (status: string, archived_at: number | null = null) => ({ session: { status, archived_at } }) as never;
    expect(statusWord(v('cancelled')).word).toBe('Cancelled');
    expect(statusWord(v('awaiting_human')).word).toBe('Waiting on you');
    expect(statusWord(v('completed', 5)).word).toBe('Archived');
    expect(statusWord(v('weird')).word).toBe('Unknown');
    expect(chatStatusWord([]).word).toBe('Unknown');
  });
  it('relative time in words', () => {
    const now = 1_000_000_000_000;
    expect(relTime(now - 3 * 7 * 86400_000, now)).toBe('3 weeks ago');
    expect(relTime(now - 10_000, now)).toBe('just now');
    expect(relTime(now - 2 * 3600_000, now)).toBe('2 hours ago');
  });
  it('readErrorKind: a network failure is offline, a refusal is an error', () => {
    expect(readErrorKind(new TypeError('Failed to fetch'))).toBe('offline');
    expect(readErrorKind(new ApiError(503, 'unavailable'))).toBe('offline');
    expect(readErrorKind(new ApiError(409, 'conflict'))).toBe('error');
  });
});
