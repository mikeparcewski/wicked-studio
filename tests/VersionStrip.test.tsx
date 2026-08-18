// The version strip — DES-MERGE-001 §4.2, §6.3 slice 9, §7.6.
//
// Four concerns, one per AC:
//   1. Ordering + highlight: oldest → newest, the ROUTED version highlighted.
//   2. Selection is a navigation to `?v=N` (the frame swap follows the route).
//   3. §7.6 the cross-link: an anchored version scrolls the thread to its message and
//      focuses it; a NULL anchor disables the affordance with a stated reason — the
//      one thing the design forbids is guessing (or a dead control).
//   4. Fork calls the service and shows the branch the SERVICE reports.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionStrip } from '../src/components/VersionStrip.js';
import type { VersionEntry, VersionManifest } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';

const postFork = vi.hoisted(() => vi.fn());
vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  postFork,
}));

function entry(version: number, over: Partial<VersionEntry> = {}): VersionEntry {
  return {
    version,
    parent: version - 1 || null,
    feedback_file: null,
    html_file: `v${version}.html`,
    created_at: `2026-08-1${version}T09:00:00Z`,
    ...over,
  };
}

function manifest(versions: VersionEntry[], head = versions[versions.length - 1]!.version): VersionManifest {
  return { head, versions };
}

function mountThread(...messageIds: string[]): void {
  const thread = document.createElement('div');
  thread.setAttribute('data-testid', 'thread');
  thread.innerHTML = messageIds
    .map((id) => `<div data-message-id="${id}">message ${id}</div>`).join('');
  document.body.append(thread);
}

function strip(over: Partial<Parameters<typeof VersionStrip>[0]> = {}) {
  const navigate = vi.fn();
  const onForked = vi.fn();
  render(
    <VersionStrip
      projectId={PROJECT}
      docId={DOC}
      manifest={manifest([entry(1), entry(2), entry(3)])}
      selected={3}
      navigate={navigate}
      onForked={onForked}
      {...over}
    />,
  );
  return { navigate, onForked };
}

const versions = (): number[] =>
  screen.getAllByTestId('version-entry').map((el) => Number(el.getAttribute('data-version')));

// A bare `() => postFork.mockReset()` would return the mock, which vitest takes as the
// hook's teardown function and then CALLS — so the block form is load-bearing.
beforeEach(() => { postFork.mockReset(); });
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('VersionStrip — ordering and highlight (§6.3)', () => {
  it('AC: a 3-version doc shows 3 entries, OLDEST → NEWEST', () => {
    strip({ manifest: manifest([entry(3), entry(1), entry(2)], 3) });

    expect(screen.getByTestId('version-strip')).toBeInTheDocument();
    expect(versions()).toEqual([1, 2, 3]);
  });

  it('AC: the ROUTED version is the highlighted one — not the head', () => {
    strip({ selected: 1 });

    const [v1, v2, v3] = screen.getAllByTestId('version-entry');
    expect(v1).toHaveAttribute('data-selected', 'true');
    expect(v2).toHaveAttribute('data-selected', 'false');
    expect(v3).toHaveAttribute('data-selected', 'false');
    expect(screen.getAllByTestId('version-select')[0]).toHaveAttribute('aria-current', 'true');
  });

  it('shows each version’s number and its timestamp', () => {
    strip({ manifest: manifest([entry(1, { created_at: '2026-08-16T09:00:00Z' })], 1) });

    expect(screen.getByTestId('version-entry')).toHaveTextContent('v1');
    const stamp = screen.getByTestId('version-stamp').textContent ?? '';
    expect(stamp.length).toBeGreaterThan(0);
    expect(stamp).toContain(new Date('2026-08-16T09:00:00Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }));
  });

  it('falls back to the raw stamp rather than rendering "Invalid Date"', () => {
    strip({ manifest: manifest([entry(1, { created_at: 'not-a-date' })], 1) });
    expect(screen.getByTestId('version-stamp')).toHaveTextContent('not-a-date');
  });
});

describe('VersionStrip — selecting a version (§4.2)', () => {
  it('AC: selecting v1 navigates to ?v=1 — URL-addressed, so Back rewinds it', async () => {
    const { navigate } = strip();

    await userEvent.click(screen.getAllByTestId('version-select')[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=1`);
  });

  it('never mutates the manifest locally — selection only routes', async () => {
    const { navigate } = strip({ selected: 1 });

    await userEvent.click(screen.getAllByTestId('version-select')[2]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=3`);
    // Still highlighting what the ROUTE says; the parent re-renders with the new prop.
    expect(screen.getAllByTestId('version-entry')[0]).toHaveAttribute('data-selected', 'true');
  });
});

describe('VersionStrip — the version → message cross-link (§7.6)', () => {
  it('AC: selecting an ANCHORED version scrolls the thread to its message and focuses it', async () => {
    mountThread('msg-a', 'msg-b');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { navigate } = strip({
      manifest: manifest([
        entry(1, { meta: { sourceMessageId: 'msg-a' } }),
        entry(2, { meta: { sourceMessageId: 'msg-b' } }),
      ], 2),
      selected: 2,
    });

    await userEvent.click(screen.getAllByTestId('version-select')[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=1`);
    expect(scroll).toHaveBeenCalled();
    expect((document.activeElement as HTMLElement).getAttribute('data-message-id')).toBe('msg-a');
    scroll.mockRestore();
  });

  it('AC: a NULL anchor DISABLES the affordance and says why — never a dead control', () => {
    strip({ manifest: manifest([entry(1), entry(2, { meta: { sourceMessageId: null } })], 2) });

    for (const button of screen.getAllByTestId('version-scroll')) {
      expect(button).toBeDisabled();
      expect(button.getAttribute('title') ?? '').toMatch(/no source message|nothing to scroll to/i);
      expect(button.getAttribute('title') ?? '').toMatch(/before the merge/i);
    }
  });

  it('the affordance is enabled — and scrolls on its own — where the anchor exists', async () => {
    mountThread('msg-a');
    const { navigate } = strip({
      manifest: manifest([entry(1, { meta: { sourceMessageId: 'msg-a' } })], 1),
      selected: 1,
    });

    const button = screen.getByTestId('version-scroll');
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect((document.activeElement as HTMLElement).getAttribute('data-message-id')).toBe('msg-a');
    // Scrolling the thread is not a navigation — the frame stays where it is.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('selecting an unanchored version still swaps the frame (the link is additive)', async () => {
    const { navigate } = strip({ selected: 3 });

    await userEvent.click(screen.getAllByTestId('version-select')[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=1`);
  });
});

describe('VersionStrip — fork (§4.2)', () => {
  it('AC: Fork from v1 posts the fork to the SERVICE and reports its result', async () => {
    postFork.mockResolvedValue({ version: 4, parent: 1 });
    const { onForked } = strip();

    await userEvent.click(screen.getAllByTestId('version-fork')[0]!);
    expect(postFork).toHaveBeenCalledWith(PROJECT, DOC, 1);
    await waitFor(() => expect(onForked).toHaveBeenCalledWith({ version: 4, parent: 1 }));
  });

  it('AC: the forked version shows its parent relationship — "continues from v1"', () => {
    // The manifest AFTER the fork, exactly as the service reports it.
    strip({
      manifest: manifest([entry(1), entry(2), entry(3), entry(4, { parent: 1 })], 4),
      selected: 4,
    });

    const forked = screen.getAllByTestId('version-entry')[3]!;
    expect(forked).toHaveAttribute('data-parent', '1');
    expect(forked).toHaveTextContent('continues from v1');
    // A linear version is not a branch — the label would be noise on every entry.
    expect(screen.getAllByTestId('version-lineage')).toHaveLength(1);
  });

  it('a failed fork states what happened and leaves the document alone (§3.3)', async () => {
    postFork.mockImplementation(() => Promise.reject(new Error('API 409: version 1 is locked')));
    const { onForked } = strip();

    await userEvent.click(screen.getAllByTestId('version-fork')[0]!);
    const error = await screen.findByTestId('version-fork-error');
    expect(error).toHaveTextContent('version 1 is locked');
    expect(error).toHaveTextContent(/unchanged/i);
    expect(onForked).not.toHaveBeenCalled();
    // Recoverable: the control comes back rather than staying stuck in "Forking…".
    expect(screen.getAllByTestId('version-fork')[0]).toBeEnabled();
  });

  it('one fork at a time — the strip does not race two branches off one manifest', async () => {
    postFork.mockReturnValue(new Promise(() => {}));
    strip();

    await userEvent.click(screen.getAllByTestId('version-fork')[0]!);
    expect(screen.getAllByTestId('version-fork')[0]).toHaveTextContent('Forking…');
    for (const button of screen.getAllByTestId('version-fork')) expect(button).toBeDisabled();
  });
});
