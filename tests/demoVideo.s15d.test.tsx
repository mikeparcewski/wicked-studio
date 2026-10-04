import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S15d — Amendment 5 item 2: a demo run's recording is an artifact of its session. The operator
 * opened the released 0.6.0 Desk on a finished demo and found "no video or video editor anywhere":
 * the inline card was a text list ("✓ Ready to watch · 3 chapters") and the player lived only behind
 * the unlabelled ⤢. Read against a real crew 0.8.0 `GET /runs/:id/demo` answer (tests/fixtures):
 *
 *  - the inline preview IS the video (rule 1): a `<video>` on the demo's file route, playable in place;
 *  - a chapter is a seek point at every size, and picking one makes it the subject of the next
 *    message (rule 2: an "about: chapter 2 · …" chip on the session's composer);
 *  - the script is editable only while crew accepts the edit (the plan gate; recording.ts answers
 *    409 after) — a finished demo's narration reads as fixed and says where to ask.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...mod, apiFetch: (...a: unknown[]) => apiFetch(...a), apiBase: () => 'http://d/api/v1' };
});

const { WalkthroughEditor } = await import('../src/components/session/WalkthroughEditor.js');
const { resetRecordingsForTest } = await import('../src/store/recordings.js');
const { chipsOf, clearAboutChips, useComposerChips } = await import('../src/store/composerChips.js');
type DemoView = import('../src/api/demo.js').DemoView;

const DONE = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/demo-crew-0.8.0-done.json`, 'utf8')) as DemoView;
const RUN = DONE.runId;

function editor(size: 'inline' | 'pane' | 'full' = 'inline', morph = vi.fn()) {
  return render(<WalkthroughEditor runId={RUN} kind="demo-video" step={null} size={size} morph={morph} units={[]} runStatus="completed" composerKey="s:demo" />);
}

beforeEach(() => {
  apiFetch.mockReset();
  resetRecordingsForTest();
  clearAboutChips('s:demo');
});
afterEach(() => cleanup());

describe('the inline preview is the video', () => {
  it('plays the take in place from the demo file route, with its chapters as seek points', async () => {
    apiFetch.mockResolvedValue(DONE);
    editor('inline');
    const video = await screen.findByTestId('walkthrough-video');
    expect(video.getAttribute('src')).toBe(`http://d/api/v1/runs/${RUN}/demo/file?path=demo-video%2Fdemo.mp4`);
    expect(video.hasAttribute('controls')).toBe(true);
    expect(screen.getByTestId('walkthrough').getAttribute('data-size')).toBe('inline');
    // The chapters seek the inline player too — not only the pane's.
    const markers = screen.getAllByTestId('walkthrough-marker');
    expect(markers.map((m) => m.getAttribute('data-sec'))).toStrictEqual(['7', '42', '75']);
    fireEvent.click(markers[1]!);
    expect((video as HTMLVideoElement).currentTime).toBe(42);
  });

  it('says what it is in one line: ready, how many chapters, how long', async () => {
    apiFetch.mockResolvedValue(DONE);
    editor('inline');
    const video = await screen.findByTestId('walkthrough-video');
    Object.defineProperty(video, 'duration', { value: 105.067, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(screen.getByTestId('walkthrough-state').textContent).toContain('Ready to watch · 3 chapters · 1:45');
  });
});

describe('a chapter is the subject of the next message', () => {
  it('picking one adds an about-chip for it on the session composer and seeks', async () => {
    apiFetch.mockResolvedValue(DONE);
    editor('pane');
    const video = await screen.findByTestId('walkthrough-video');
    fireEvent.click(screen.getAllByTestId('walkthrough-marker')[2]!);
    expect((video as HTMLVideoElement).currentTime).toBe(75);
    const chips = chipsOf(useComposerChips.getState(), 's:demo');
    expect(chips).toStrictEqual([{ kind: 'about', key: `chapter:${RUN}:03-shipped`, label: 'chapter 3 · Shipped with lead times' }]);
  });
});

describe('the script', () => {
  it('is editable at the plan gate and saved through PUT /runs/:id/demo/script', async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve({ bytes: 12 });
      return Promise.resolve({ ...DONE, stage: 'plan_gate', video: null, markers: [], sheets: [], review: { verdict: null, findings: [], text: null, rejected: false } });
    });
    editor('pane');
    const box = await screen.findByTestId('demo-script');
    expect((box as HTMLTextAreaElement).value.startsWith('# Request Board demo script')).toBe(true);
    fireEvent.change(box, { target: { value: 'A new script' } });
    fireEvent.click(screen.getByTestId('demo-script-save'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`/runs/${RUN}/demo/script`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ content: 'A new script' }) })));
    await screen.findByText('Script saved — the recorder reads it when you approve the plan.');
  });

  it('reads as fixed once recorded, and says where to ask', async () => {
    apiFetch.mockResolvedValue(DONE);
    editor('pane');
    await screen.findByTestId('walkthrough-video');
    expect(screen.queryByTestId('demo-script')).toBeNull();
    expect(screen.getByTestId('walkthrough-narration').textContent).toContain('# Request Board demo script');
    expect(screen.getByTestId('demo-script-fixed').textContent).toBe('Fixed when the demo recorded — pick a chapter and ask in the composer for another take.');
  });
});
