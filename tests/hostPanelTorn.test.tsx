import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostPanel } from '../src/components/editorHost/HostPanel.js';
import { FakeSurfaceAdapter } from '../src/editors/adapters/fake.js';
import { RUN_TAB, groupKey, useHostChrome, useHostPanel, type OptionsGroup } from '../src/editors/hostApi.js';
import type { Surfaces } from '../src/editors/surfaces.js';

/**
 * The options frame's "This part didn't start" line is for a frame that failed, never for the instance's own close.
 * React StrictMode (the dev server) mounts every effect twice: the first instance is closed ("The options were
 * closed") and a second one made. That close used to stay on screen under a working Style tab (plugins S5 look,
 * g24-doc/07); the production build never double-mounts, so the rig never showed it.
 */

const SURF: Surfaces = {
  card: { interactive: true, aspect: '16:9', actions: [] },
  options: { tabs: [{ id: 'style', label: 'Style', render: 'plugin' }] },
  full: { modes: ['simple', 'advanced'], default: 'simple' },
};

function group(): OptionsGroup {
  return {
    key: groupKey('acme-v2', 'k1'), binding: { artifactKey: 'k1', title: 'T', kind: 'page', source: 'fake', projectId: '', composerKey: 'c' },
    editor: { id: 'acme-v2', title: 'Sample', version: '0.1.0', sha256: 'a'.repeat(64), protocol: [1, 2], kinds: ['page'], sizes: ['inline'], first_party: false } as never,
    surfaces: SURF, protocol: 2, src: 'about:blank', grants: [], adapter: new FakeSurfaceAdapter({ kind: 'page', title: 'T' }),
  };
}

beforeEach(() => {
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false, overlay: false });
  useHostChrome.setState({ navCollapsed: false, full: null, chatOpen: false, navBefore: false });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the options frame’s torn line', () => {
  it('a StrictMode re-mount (its own close) shows no "didn’t start" line, and the frame is there', () => {
    render(<StrictMode><HostPanel runTab={<p>run</p>} /></StrictMode>);
    act(() => { useHostPanel.getState().openGroup(group()); });
    expect(screen.getByTestId('host-panel-frame').querySelector('iframe')).not.toBeNull();
    expect(screen.queryByTestId('host-panel-torn')).toBeNull();
  });
});
