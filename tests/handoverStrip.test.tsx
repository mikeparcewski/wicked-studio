import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AuditEntry } from '../src/api/types.js';
import {
  handoverChips, handoverSections, handoverSettled, listedKeys, type HandoverSection,
} from '../src/board/handover.js';
import { HandoverPanel } from '../src/components/HandoverPanel.js';
import { useQueueReveal } from '../src/store/queueReveal.js';
import { PROGRESS_KEY, useHandoverProgress, useVisitStore } from '../src/store/visit.js';
import { makeView } from './factories.js';

/**
 * The handover as a STRIP (operator feedback: the four-column panel pushed every section off the
 * page). One line of chips — decisions due / broke reveal their Needs You rows, finished / done
 * for you open overlays — and it clears once every item it listed is acted on or resolved.
 */

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const since = NOW - 3 * HOUR;

const sys = (ts: number, action: string, runId: string, actor = 'crew.stall-watchdog', detail?: Record<string, unknown>): AuditEntry => ({
  ts, action, runId, actor: { id: actor, kind: 'system', trust: 'admin' }, ...(detail !== undefined ? { detail } : {}),
});

const runs = [
  makeView({ id: 'g1', status: 'awaiting_human', project_id: 'alpha' }),
  makeView({ id: 'f1', status: 'failed', ended_at: (NOW - HOUR) / 1000 }),
  makeView({ id: 'd1', status: 'completed', ended_at: (NOW - 2 * HOUR) / 1000 }),
  makeView({ id: 'd2', status: 'completed', ended_at: (NOW - HOUR) / 1000 }),
  makeView({ id: 'r1', status: 'executing' }),
];

function sectionsWith(audit: readonly AuditEntry[] | 'loading' | null, rs = runs): HandoverSection[] {
  return handoverSections({
    runs: rs,
    gates: { g1: { prompt: 'Approve?', receivedAt: NOW - 20 * MIN, ord: 0 } },
    elicitations: {},
    failedAt: {},
    projectIds: {},
    audit,
    since,
  });
}

const ORDER_ENTRY = sys(NOW - 50 * MIN, 'gate.decided', 'g1', 'standing-order:so-1', {
  approve: true, standingOrder: { id: 'so-1', text: 'Auto-approve intake on alpha' },
});
const trail = [sys(NOW - 30 * MIN, 'run.stall.escalated', 'r1'), ORDER_ENTRY];

describe('handoverChips — the strip folds the sections into four chips', () => {
  it('decisions · broke · finished · done for you; orders and system fold into "done for you", grouped', () => {
    const chips = handoverChips(sectionsWith(trail));
    expect(chips.map((c) => [c.key, c.items.length])).toEqual([['decisions', 1], ['broke', 1], ['finished', 2], ['done', 2]]);
    const done = chips[3]!;
    expect(done.groups.map((g) => [g.key, g.title, g.items.length])).toEqual([
      ['orders', 'What your standing orders did', 1],
      ['system', 'What the system did for you', 1],
    ]);
    // Newest first across both.
    expect(done.items.map((i) => i.runId)).toEqual(['r1', 'g1']);
  });

  it('an audit item carries its entry (the receipt the overlay shows)', () => {
    const done = handoverChips(sectionsWith(trail))[3]!;
    expect(done.items[0]!.audit).toMatchObject({ action: 'run.stall.escalated', actor: 'crew.stall-watchdog', ts: NOW - 30 * MIN });
  });

  it('"done for you" is loading while the trail is read, and says it cannot when the read failed', () => {
    expect(handoverChips(sectionsWith('loading'))[3]!.state).toBe('loading');
    expect(handoverChips(sectionsWith(null))[3]!.state).toBe('failed');
    expect(handoverChips(sectionsWith(null))[0]!.state).toBe('ready');
  });
});

describe('handoverSettled — clearing once everything listed is acted on or resolved', () => {
  const secs = sectionsWith(trail);
  const all = listedKeys(secs);

  it('not before anything was listed, and not while a section is still being read', () => {
    expect(handoverSettled(sectionsWith([], []), [], [])).toBe(false);
    expect(handoverSettled(sectionsWith('loading'), all, all)).toBe(false);
  });

  it('open while any listed item is neither acted on nor resolved', () => {
    expect(handoverSettled(secs, all, all.slice(1))).toBe(false);
  });

  it('settled when every item still listed was acted on', () => {
    expect(handoverSettled(secs, all, all)).toBe(true);
  });

  it('a resolved item (the gate answered: no longer listed) needs no act', () => {
    const answered = runs.map((v) => (v.session.id === 'g1' ? makeView({ id: 'g1', status: 'executing' }) : v));
    const now = sectionsWith([sys(NOW - 30 * MIN, 'run.stall.escalated', 'r1')], answered);
    const acted = listedKeys(now);
    expect(acted).not.toContain('gate:g1');
    expect(handoverSettled(now, all, acted)).toBe(true);
  });
});

describe('handover progress — persisted per absence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useVisitStore.setState({ lastSeenAt: NOW, handover: { since, at: NOW } });
    useHandoverProgress.setState({ since: null, listed: [], acted: [] });
  });

  it('records what was listed and acted on for THIS absence, and survives a reload', () => {
    const p = useHandoverProgress.getState();
    p.noteListed(since, ['gate:g1', 'fail:f1']);
    p.markActed('gate:g1');
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY)!)).toEqual({ since, listed: ['gate:g1', 'fail:f1'], acted: ['gate:g1'] });
  });

  it('a record for an older absence is ignored, not carried over', () => {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ since: since - HOUR, listed: ['x'], acted: ['x'] }));
    useHandoverProgress.getState().noteListed(since, ['gate:g1']);
    expect(useHandoverProgress.getState()).toMatchObject({ since, listed: ['gate:g1'], acted: [] });
  });

  it('acting with no handover open records nothing', () => {
    useVisitStore.setState({ handover: null });
    useHandoverProgress.getState().markActed('gate:g1');
    expect(window.localStorage.getItem(PROGRESS_KEY)).toBeNull();
  });
});

describe('HandoverPanel — the strip', () => {
  const navigate = vi.fn();
  beforeEach(() => {
    window.localStorage.clear();
    useVisitStore.setState({ lastSeenAt: NOW, handover: { since, at: NOW } });
    useHandoverProgress.setState({ since: null, listed: [], acted: [] });
    navigate.mockReset();
  });
  afterEach(cleanup);

  const mount = (dismiss = vi.fn()): ReturnType<typeof vi.fn> => {
    render(<HandoverPanel handover={{ since, sections: sectionsWith(trail), dismiss }} navigate={navigate} now={NOW} runs={runs} />);
    return dismiss;
  };

  it('is one line of chips: since, the four chips in order, Got it', () => {
    mount();
    expect(screen.getByTestId('handover-since')).toHaveTextContent('3h ago');
    expect(screen.getAllByTestId('handover-chip').map((c) => [c.dataset.section, c.textContent])).toEqual([
      ['decisions', '1decision due'], ['broke', '1broke'], ['finished', '2finished'], ['done', '2done for you'],
    ]);
    expect(screen.getByTestId('handover-dismiss')).toHaveTextContent('Got it');
  });

  it('decisions due / broke reveal their Needs You rows — no overlay, no duplicated verbs', () => {
    mount();
    const before = useQueueReveal.getState().nonce;
    fireEvent.click(screen.getAllByTestId('handover-chip')[0]!);
    expect(useQueueReveal.getState()).toMatchObject({ keys: ['gate:g1'], nonce: before + 1 });
    fireEvent.click(screen.getAllByTestId('handover-chip')[1]!);
    expect(useQueueReveal.getState().keys).toEqual(['fail:f1']);
    expect(screen.queryByTestId('handover-overlay')).toBeNull();
  });

  it('done for you: an overlay grouped by who acted; Open navigates and counts as acting', () => {
    mount();
    const chip = screen.getAllByTestId('handover-chip')[3]!;
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('handover-overlay-group').map((g) => g.dataset.group)).toEqual(['orders', 'system']);
    const system = within(screen.getAllByTestId('handover-overlay-group')[1]!);
    fireEvent.click(system.getByTestId('handover-item-audit'));
    expect(system.getByTestId('handover-item-audit-entry')).toHaveTextContent('run.stall.escalated');
    fireEvent.click(system.getByTestId('handover-item-open'));
    expect(navigate).toHaveBeenCalledWith('/runs/r1');
    expect(useHandoverProgress.getState().acted).toContain(`audit:${NOW - 30 * MIN}:run.stall.escalated:r1`);
    expect(screen.queryByTestId('handover-overlay')).toBeNull();
  });

  it('Escape closes the overlay and focus returns to its chip', () => {
    mount();
    const chip = screen.getAllByTestId('handover-chip')[2]!;
    fireEvent.click(chip);
    expect(screen.getByTestId('handover-overlay')).toHaveAttribute('data-section', 'finished');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('handover-overlay')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('clears itself once every listed item has been acted on', () => {
    const secs = sectionsWith(trail);
    const keys = listedKeys(secs);
    useHandoverProgress.setState({ since, listed: keys, acted: keys.slice(1) });
    const dismiss = mount();
    expect(dismiss).not.toHaveBeenCalled();
    cleanup();
    useHandoverProgress.setState({ since, listed: keys, acted: keys });
    const dismiss2 = mount();
    expect(dismiss2).toHaveBeenCalled();
  });
});
