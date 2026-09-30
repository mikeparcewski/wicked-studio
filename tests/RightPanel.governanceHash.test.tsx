import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RightPanel } from '../src/components/RightPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView } from '../src/api/types.js';

/**
 * `#governance` on a run's address opens its Governance section (DES-MCP-TOOLS-001 §7, slice S7):
 * MCP tools → Usage links each run there, where every brokered call's claim is shown. It holds on
 * mount and when the already-mounted panel is handed another run.
 */

function view(id: string): SessionView {
  const v = makeView({ status: 'executing', unit_ix: 0 }, [makeUnit({ id: `${id}:u0`, ord: 0, status: 'distributed', assigned_cli: 'claude' })]);
  return { ...v, session: { ...v.session, id } };
}

const expanded = (id: string): string | null => screen.getByTestId(`rail-accordion-${id}`).getAttribute('aria-expanded');

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: view('run-1') });
  // The panel mounts GovernanceAudit, which loads on mount. Unmocked, its two requests settle
  // AFTER the file's jsdom environment is torn down, and the `finally { setLoading(false) }` then
  // throws `ReferenceError: window is not defined` out of React as an unhandled rejection — which
  // reds the whole run while every test passes. It surfaced when an unrelated new test file
  // changed vitest's scheduling; the race was always here. Mocked so the load settles, and
  // `cleanup()` unmounts before teardown so nothing sets state into a dead environment.
  // `getRunAcceptance` is typed non-nullable; the component's own fallback path is the
  // "older daemon answered nothing usable" case, which a rejection reaches identically.
  vi.spyOn(client.api, 'getRunAcceptance').mockRejectedValue(new Error('no acceptance wire'));
  vi.spyOn(client.api, 'listClaims').mockResolvedValue({ claims: [] });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('RightPanel: #governance opens the Governance section', () => {
  it('without the fragment, What/Where is open', () => {
    window.history.replaceState(null, '', '/runs/run-1');
    render(<RightPanel view={view('run-1')} />);
    expect(expanded('whatwhere')).toBe('true');
    expect(expanded('governance')).toBe('false');
  });

  it('on mount', () => {
    window.history.replaceState(null, '', '/runs/run-1#governance');
    render(<RightPanel view={view('run-1')} />);
    expect(expanded('governance')).toBe('true');
  });

  it('when the mounted panel is handed another run with the fragment', () => {
    window.history.replaceState(null, '', '/runs/run-1');
    const { rerender } = render(<RightPanel view={view('run-1')} />);
    expect(expanded('governance')).toBe('false');
    window.history.replaceState(null, '', '/runs/run-2#governance');
    rerender(<RightPanel view={view('run-2')} />);
    expect(expanded('governance')).toBe('true');
  });
});
