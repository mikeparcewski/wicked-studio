import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * studio#509 — Esc shrinks the artifact (DESIGN-interaction rule 1) from a focused native player too.
 * With the keyboard focus on the Demo video's `<video controls>` (Shift+Tab from the first chapter
 * mark lands there), the media controls took the Esc keydown and it never reached the document —
 * `ArtifactMorph`'s listener counted 0 events — so the artifact did not shrink until the focus moved.
 * Now the artifact listens in the CAPTURE phase on its own element, which sees the key before the
 * player's controls do; the browser's own fullscreen is left alone (Esc leaves it first).
 *
 * The player's behaviour is modelled: a keydown listener on the `<video>` that stops propagation,
 * which is what the native controls amount to from the document's point of view.
 */

vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/store/editors.js', () => ({
  useEditorFor: () => null,
  useEditors: (sel: (s: { reason: null }) => unknown) => sel({ reason: null }),
}));

const { ArtifactMorph } = await import('../src/components/session/ArtifactMorph.js');
const { artifactSizeOf, resetArtifactSizes, setArtifactSize, useArtifactSizes } = await import('../src/store/artifactSizes.js');

const KEY = 'p1/run:r1/demo';

function Player(): React.ReactElement {
  return (
    <ArtifactMorph
      artifactKey={KEY} title="Demo video" projectId="p1" docId="run:r1" composerKey="s:run:r1"
      slot={{ kind: 'demo-video', body: () => <video data-testid="player" controls tabIndex={0} /> }}
    />
  );
}

beforeEach(() => { resetArtifactSizes(); });
afterEach(() => { cleanup(); resetArtifactSizes(); });

describe('Esc from the native player (studio#509)', () => {
  it('shrinks one step even when the player swallows the key before it bubbles to the document', () => {
    render(<Player />);
    act(() => setArtifactSize(KEY, 'pane'));
    expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('pane');
    const video = screen.getByTestId('player');
    video.addEventListener('keydown', (e) => e.stopPropagation()); // the native controls, as the document sees them
    video.focus();
    fireEvent.keyDown(video, { key: 'Escape' });
    expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('inline');
  });

  it('full → pane → inline, one step per Esc from the player', () => {
    render(<Player />);
    act(() => setArtifactSize(KEY, 'full'));
    const video = screen.getByTestId('player');
    video.addEventListener('keydown', (e) => e.stopPropagation());
    video.focus();
    fireEvent.keyDown(video, { key: 'Escape' });
    expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('pane');
    fireEvent.keyDown(video, { key: 'Escape' });
    expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('inline');
  });

  it('leaves the browser fullscreen alone: Esc while the player is fullscreen does not also shrink', () => {
    render(<Player />);
    act(() => setArtifactSize(KEY, 'pane'));
    const video = screen.getByTestId('player');
    Object.defineProperty(document, 'fullscreenElement', { value: video, configurable: true });
    try {
      video.focus();
      fireEvent.keyDown(video, { key: 'Escape' });
      expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('pane');
    } finally {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    }
  });

  it('a player in ANOTHER artifact is the document\'s key: Esc from it still shrinks the topmost open artifact (codex round 1)', () => {
    render(
      <>
        <Player />
        <ArtifactMorph
          artifactKey="p1/run:r2/demo" title="Other video" projectId="p1" docId="run:r2" composerKey="s:run:r2"
          slot={{ kind: 'demo-video', body: () => <video data-testid="other-player" controls tabIndex={0} /> }}
        />
      </>,
    );
    act(() => setArtifactSize(KEY, 'pane'));
    const other = screen.getByTestId('other-player');
    other.focus();
    fireEvent.keyDown(other, { key: 'Escape' });
    expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('inline');
    expect(artifactSizeOf(useArtifactSizes.getState(), 'p1/run:r2/demo')).toBe('inline');
  });

  it('a field inside the artifact still owns its Esc (unchanged)', () => {
    render(
      <ArtifactMorph
        artifactKey={KEY} title="Demo video" projectId="p1" docId="run:r1" composerKey="s:run:r1"
        slot={{ kind: 'demo-video', body: () => <input data-testid="field" /> }}
      />,
    );
    act(() => setArtifactSize(KEY, 'pane'));
    const field = screen.getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(artifactSizeOf(useArtifactSizes.getState(), KEY)).toBe('pane');
  });
});
