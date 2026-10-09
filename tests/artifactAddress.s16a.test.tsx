// S16a-4a: an artifact grown in a session has an address — /s/:sessionId/a/:artifactKey?size=pane|full.
// The key is the morph store's own (encodeURIComponent of `<runId>:<projectId>/<docId>`): no second
// key grammar. Grow pushes one entry per step; a shrink from a pushed entry goes Back; a shrink from
// a first-entry deep link replaces; an unknown key grows nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { addressFor, artifactPath, readArtifactAddress, sizeOf } from '../src/board/artifactAddress.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { ArtifactAddressProvider, useArtifactAddressWriter, useArtifactMissing } from '../src/components/session/ArtifactAddress.js';
import { artifactKey, registerArtifact, resetArtifactSizes, useArtifactSizes, useMountedArtifacts } from '../src/store/artifactSizes.js';

const KEY = artifactKey('alpha', 'brief/v2 doc', 'r1');

describe('the artifact address (pure)', () => {
  it('round-trips the store key, odd characters included (":", "/", spaces)', () => {
    const p = artifactPath('run:r1', KEY, 'full');
    expect(p).toBe('/s/run%3Ar1/a/r1%3Aalpha%2Fbrief%2Fv2%20doc?size=full');
    const [path, q] = p.split('?');
    expect(readArtifactAddress(path!, `?${q}`)).toStrictEqual({ sessionId: 'run:r1', key: KEY, size: 'full', version: null });
    expect(parseRoute(path!)).toMatchObject({ panel: 'session', artifactId: 'run:r1', artifactKey: KEY });
  });

  it('a bad or missing size reads as pane; a deeper path is no address and a dead route', () => {
    expect(sizeOf('?size=huge')).toBe('pane');
    expect(sizeOf('')).toBe('pane');
    expect(readArtifactAddress('/s/run%3Ar1/a/k1/extra', '')).toBeNull();
    expect(parseRoute('/s/run%3Ar1/a/k1/extra').panel).toBe('not-found');
    expect(parseRoute('/s/run%3Ar1/x/k1').panel).toBe('not-found');
    expect(parseRoute('/s/run%3Ar1')).toMatchObject({ panel: 'session', artifactKey: null });
  });

  it('inline is the session\'s own address', () => {
    expect(addressFor('chat-1', KEY, 'inline')).toBe('/s/chat-1');
    expect(addressFor('chat-1', KEY, 'pane')).toBe(artifactPath('chat-1', KEY, 'pane'));
  });
});

function Probe({ onWriter }: { onWriter: (w: ReturnType<typeof useArtifactAddressWriter>) => void }): React.ReactElement {
  onWriter(useArtifactAddressWriter());
  return <p />;
}

function Missing({ k }: { k: string | null }): React.ReactElement {
  const missing = useArtifactMissing(k, true);
  return <p data-testid="missing">{missing ? 'missing' : 'ok'}</p>;
}

describe('the morph and the address in step', () => {
  beforeEach(() => { resetArtifactSizes(); useMountedArtifacts.setState({ keys: {} }); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('grow pushes /a/<key>?size=pane, ⤢ pushes ?size=full; a shrink after them goes Back', () => {
    const navigate = vi.fn();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    let write: ReturnType<typeof useArtifactAddressWriter> = null;
    render(<ArtifactAddressProvider sessionId="run:r1" routeKey={null} routeSize="pane" navigate={navigate}><Probe onWriter={(w) => { write = w; }} /></ArtifactAddressProvider>);
    write!(KEY, 'inline', 'pane');
    write!(KEY, 'pane', 'full');
    expect(navigate.mock.calls).toEqual([[artifactPath('run:r1', KEY, 'pane')], [artifactPath('run:r1', KEY, 'full')]]);
    write!(KEY, 'full', 'pane');
    expect(back).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('a first-entry deep link shrinks by REPLACING (never leaves the app)', () => {
    const navigate = vi.fn();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    let write: ReturnType<typeof useArtifactAddressWriter> = null;
    render(<ArtifactAddressProvider sessionId="run:r1" routeKey={KEY} routeSize="full" navigate={navigate}><Probe onWriter={(w) => { write = w; }} /></ArtifactAddressProvider>);
    write!(KEY, 'full', 'pane');
    write!(KEY, 'pane', 'inline');
    expect(back).not.toHaveBeenCalled();
    expect(navigate.mock.calls).toEqual([[artifactPath('run:r1', KEY, 'pane'), { replace: true }], ['/s/run%3Ar1', { replace: true }]]);
  });

  it('the address grows a known artifact once it is on the page; the session\'s own address folds it back', () => {
    const { rerender } = render(<ArtifactAddressProvider sessionId="run:r1" routeKey={KEY} routeSize="full" navigate={vi.fn()}><p /></ArtifactAddressProvider>);
    expect(useArtifactSizes.getState().sizes[KEY]).toBeUndefined();
    act(() => { registerArtifact(KEY); });
    expect(useArtifactSizes.getState().sizes[KEY]).toBe('full');
    rerender(<ArtifactAddressProvider sessionId="run:r1" routeKey={null} routeSize="pane" navigate={vi.fn()}><p /></ArtifactAddressProvider>);
    expect(useArtifactSizes.getState().sizes[KEY]).toBeUndefined();
  });

  it('an unknown key grows nothing and is said', () => {
    render(<Missing k="r9:nope/none" />);
    expect(screen.getByTestId('missing')).toHaveTextContent('missing');
    expect(Object.keys(useArtifactSizes.getState().sizes)).toEqual([]);
  });
});
