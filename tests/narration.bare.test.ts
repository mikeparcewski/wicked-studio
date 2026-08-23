// The other banned status shape — DES-MERGE-001 §3.3, §3.4, §6.4 slice 14.
//
// §3.2 got the whimsy out at the seam (slice 10). §3.3 bans a second shape for exactly
// the same reason, and slice 14's AC pins it: a bare `Working…` is neither actionable
// (there is nothing to do) nor informative (it says nothing about THIS run). The reason
// it is never needed is rule 3 — there is always a truthful subject available from state
// the client already holds — so this file asserts both halves: the bare line never
// reaches a surface, and something with a subject is always there in its place.
import { describe, expect, it } from 'vitest';
import { isBare, isFiller, isWhimsy, statusLine } from '../src/store/narration.js';
import { useDocThreadStore } from '../src/store/docThread.js';
import { docActivityOf } from '../src/store/runtime.js';
import type { CoreEvent } from '../src/api/types.js';

const PROJECT = 'proj-abc';
const DEMO = 'checkout-walkthrough';
const KEY = `${PROJECT}:${DEMO}`;

/** The bare shapes an agent falls back to when it has nothing specific to say. */
const BARE = ['Working…', 'Working', 'working...', 'WORKING …', 'Processing…', 'Thinking…',
  'Running…', 'Busy…', 'Loading…', 'Please wait…', 'One moment…'];

/** …and the lines that merely START like one, which are real narration (§3.3). */
const REAL = [
  'Working on the hero section',
  'Processing step 2 of 5 — Add a hoodie to the cart',
  'Running the checkout spec in a real browser',
  'Loading the storefront',
];

function frame(payload: Record<string, unknown>): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: {
      event_type: 'wicked.interactive.status.posted',
      payload: { project_id: PROJECT, document_id: DEMO, ...payload },
    },
  } as unknown as CoreEvent;
}

describe('a status with no subject is filler (§3.3)', () => {
  it('recognizes the bare shapes, in any casing or punctuation', () => {
    for (const line of BARE) {
      expect(isBare(line), line).toBe(true);
      expect(isFiller(line), line).toBe(true);
    }
  });

  it('keeps every line that names what it is working ON', () => {
    for (const line of REAL) {
      expect(isBare(line), line).toBe(false);
      expect(isFiller(line), line).toBe(false);
    }
  });

  it('is a SECOND rule, not a renaming of the first', () => {
    expect(isWhimsy('Working…')).toBe(false);        // not on interactive's WHIMSY list
    expect(isBare('Reticulating splines…')).toBe(false);  // not subject-less, just nonsense
    expect(isFiller('Reticulating splines…')).toBe(true);
    expect(isFiller('Rewriting slide 3 — tightening the headline')).toBe(false);
  });
});

describe('the filter is applied at the seam, so no surface can render it', () => {
  it('AC: a bare status never reaches the transcript — but its state transition does', () => {
    const { ingest } = useDocThreadStore.getState();
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });

    for (const line of BARE) ingest(frame({ state: 'working', message: line }));
    expect(useDocThreadStore.getState().messages[KEY] ?? []).toEqual([]);
    // Dropping the LINE is not dropping the FACT that the recorder is running.
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');

    ingest(frame({ state: 'working', message: 'Step 2 of 5 — Add a hoodie to the cart' }));
    expect((useDocThreadStore.getState().messages[KEY] ?? [])
      .map((m) => (m.kind === 'narration' ? m.text : m.kind)))
      .toEqual(['Step 2 of 5 — Add a hoodie to the cart']);
  });

  it('drops it from the board headline too — one rule, both altitudes (§3.4)', () => {
    expect(docActivityOf(frame({ message: 'Working…' }))).toBeNull();
    expect(docActivityOf(frame({ message: 'Recording “checkout-walkthrough” — step 2' })))
      .toMatchObject({ projectId: PROJECT });
  });
});

describe('statusLine — §3.4 in its stated priority order', () => {
  const SUBJECT = 'Recording “checkout-walkthrough” — 5 steps, starting at “Open the storefront”.';

  it('takes the NEWEST line that names something', () => {
    expect(statusLine(['Opened the storefront', 'Step 2 — Add a hoodie to the cart'], SUBJECT))
      .toBe('Step 2 — Add a hoodie to the cart');
  });

  it('AC: never returns a bare "Working…" — it falls back to the derived subject (rule 3)', () => {
    expect(statusLine(BARE, SUBJECT)).toBe(SUBJECT);
    expect(statusLine(['Reticulating splines…', 'Working…'], SUBJECT)).toBe(SUBJECT);
    expect(statusLine([], SUBJECT)).toBe(SUBJECT);
    expect(statusLine(['   '], SUBJECT)).toBe(SUBJECT);
    // A real line followed by filler still resolves to the real line, not the fallback.
    expect(statusLine(['Step 3 — Enter the card details', 'Working…'], SUBJECT))
      .toBe('Step 3 — Enter the card details');
  });
});
