import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionsApi } from '../src/api/decisions.js';
import { WatchtowerPage } from '../src/components/watch/WatchtowerPage.js';
import { useRoute } from '../src/hooks/useRoute.js';
import { useWatchStore } from '../src/store/watch.js';

const NOW = 1_800_000_000_000;
function RoutedWatchtower(): React.ReactElement {
  const { search, navigate } = useRoute();
  return <>
    <button onClick={() => navigate('/watch')}>Palette Watchtower</button>
    <button onClick={() => navigate('/watch?filter=problem')}>Open problems address</button>
    <WatchtowerPage count={0} runs={[]} navigate={navigate} search={search} now={NOW} />
  </>;
}
const visibleKinds = (): (string | null)[] => screen.getAllByTestId('watchtower-row').map((r) => r.getAttribute('data-kind')).sort();

beforeEach(() => {
  useWatchStore.getState().reset();
  window.history.replaceState(null, '', '/watch?filter=decision');
  vi.spyOn(decisionsApi, 'list').mockResolvedValue({ mode: 'ledger', decisions: [] } as never);
  useWatchStore.getState().hydrate({ findings: ['decision', 'problem'].map((kind, i) => ({
    run_id: `run-${i}`, ord: 0, attempt: 1, by: 'watch:x@1', at: NOW - i * 60_000,
    re: 'r', watch_id: `watch-${i}`, entry_id: 'claim', entry_version: 1,
    check: 'deterministic:x', kind: 'finding', severity: 'medium', watch_kind: kind,
    attach: null, project_id: 'p', sentence: `Finding ${kind}`, facts: {}, anchor: null,
    evidence: [], model: null, rolled_up: 0,
  })) } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('Watchtower r4 route query synchronization', () => {
  it('follows palette navigation and Back/Forward without remounting the page', async () => {
    render(<RoutedWatchtower />);
    expect(visibleKinds()).toEqual(['decision']);
    expect(screen.getByRole('button', { name: 'Decisions' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Palette Watchtower' }));
    expect(window.location.search).toBe('');
    expect(visibleKinds()).toEqual(['decision', 'problem']);
    expect(screen.getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');
    window.history.back();
    await waitFor(() => expect(visibleKinds()).toEqual(['decision']));
    expect(window.location.search).toBe('?filter=decision');
    window.history.forward();
    await waitFor(() => expect(visibleKinds()).toEqual(['decision', 'problem']));
    fireEvent.click(screen.getByRole('button', { name: 'Open problems address' }));
    expect(visibleKinds()).toEqual(['problem']);
    window.history.back();
    await waitFor(() => expect(visibleKinds()).toEqual(['decision', 'problem']));
    window.history.forward();
    await waitFor(() => expect(visibleKinds()).toEqual(['problem']));
    expect(decisionsApi.list).toHaveBeenCalledTimes(1);
  });

  it('uses router replacement for chips, preserving unrelated query parameters and the hash', async () => {
    window.history.replaceState(null, '', '/watch?filter=decision&project=studio#feed');
    render(<RoutedWatchtower />);
    const historyLength = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    expect(window.location.search).toBe('?filter=problem&project=studio');
    expect(window.location.hash).toBe('#feed');
    expect(window.history.length).toBe(historyLength);
    expect(visibleKinds()).toEqual(['problem']);
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    expect(window.location.search).toBe('?project=studio');
    expect(visibleKinds()).toEqual(['decision', 'problem']);
    await waitFor(() => expect(decisionsApi.list).toHaveBeenCalledTimes(1));
  });

  it('synchronizes missing and unsupported filter queries on the same mounted component', async () => {
    const props = { count: 0, runs: [], navigate: vi.fn(), now: NOW };
    const { rerender } = render(<WatchtowerPage {...props} search="?filter=decision" />);
    expect(visibleKinds()).toEqual(['decision']);
    rerender(<WatchtowerPage {...props} search="?filter=invalid" />);
    expect(visibleKinds()).toEqual(['decision', 'problem']);
    rerender(<WatchtowerPage {...props} search="?filter=problem" />);
    expect(visibleKinds()).toEqual(['problem']);
    rerender(<WatchtowerPage {...props} search="" />);
    expect(visibleKinds()).toEqual(['decision', 'problem']);
    await waitFor(() => expect(decisionsApi.list).toHaveBeenCalledTimes(1));
  });
});
