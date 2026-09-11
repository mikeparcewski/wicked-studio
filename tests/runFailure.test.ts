// F-4R2-014 — the crew seams' run-failure line, read for a human. The line is the operator
// dump verbatim (absolute state-home paths, issue ids, a raw GET); the customer gets one
// sentence derived from the floor's own EXPECTED path, the run id for a link, and the dump
// kept whole for the details fold. Anything else parses to null and stays plain narration.
import { describe, expect, it } from 'vitest';
import { parseRunFailure, stepOf, summarize } from '../src/interactive/runFailure.js';

const RUN = '37f020cc-e42c-48aa-b3ec-aa18ec6f9f63';

/** The phase4-r2 chat1b line, privacy-scrubbed paths (`/w5/state/…`). */
const FLOOR_LINE =
  `The crew run answering your ask failed (run ${RUN}). Reason: [wicked-crew] deliverable floor: this phase declared ` +
  `1 artifact(s); this run launched at 2026-09-11T10:32:54.984Z. [wicked-crew] EXPECTED: ` +
  `/w5/state/interactive-chats/wicked-studio-brochure-r2-m-dmsg-7/revised.html [wicked-crew] FOUND: (nothing) ` +
  `[wicked-crew] MISSING: /w5/state/interactive-chats/wicked-studio-brochure-r2-m-dmsg-7/revised.html (does not exist) ` +
  `[wicked-crew] DELIVERABLE FLOOR FAILED — the run reported done without producing the artifact(s) it was launched ` +
  `to produce. A prose reply is not a deliverable (crew#311), and a prior run's leftover file is not this run's. ` +
  `Inspect it via the crew API (GET /api/v1/runs/${RUN}), then resend the message.`;

describe('parseRunFailure — the seams\' spelling', () => {
  it('reads the ask seam\'s deliverable-floor failure into run id, step and the customer sentence', () => {
    const f = parseRunFailure(FLOOR_LINE);
    expect(f).not.toBeNull();
    expect(f!.runId).toBe(RUN);
    expect(f!.cancelled).toBe(false);
    expect(f!.seam).toBe('ask');
    expect(f!.expected).toBe('/w5/state/interactive-chats/wicked-studio-brochure-r2-m-dmsg-7/revised.html');
    expect(f!.step).toBe('revise');
    expect(f!.summary).toBe(
      'The revise step produced no file, so this turn did not land — nothing changed in your document.');
    // The remedy tail (the raw GET + "resend") is not part of the reason the details show twice.
    expect(f!.reason).not.toContain('Inspect it via the crew API');
    expect(f!.reason).toContain('DELIVERABLE FLOOR FAILED');
  });

  it('a draft seam failure names the draft step; a demo names the demo; an edit the edit', () => {
    const draft = parseRunFailure(
      `The crew run answering this document failed (run ${RUN}). Reason: [wicked-crew] deliverable floor: ` +
      `[wicked-crew] EXPECTED: /w5/state/interactive-drafts/launch-deck/launch-deck-v1.html [wicked-crew] FOUND: (nothing). ` +
      `Inspect it via the crew API (GET /api/v1/runs/${RUN}); the assist loop can still take over.`);
    expect(draft?.seam).toBe('document');
    expect(draft?.step).toBe('draft');
    expect(draft?.summary).toContain('The draft step produced no file');
    expect(draft?.summary).toContain('in your document.');

    const demo = parseRunFailure(
      `The crew run answering this demo failed (run ${RUN}). Reason: deliverable floor: EXPECTED: ` +
      `/w5/state/interactive-demos/checkout-demo-v2/demo.spec.mjs FOUND: (nothing). ` +
      `Inspect it via the crew API (GET /api/v1/runs/${RUN}); no recording was triggered.`);
    expect(demo?.seam).toBe('demo');
    expect(demo?.step).toBe('demo spec');
    expect(demo?.summary).toContain('in your demo.');

    expect(stepOf('/w5/state/interactive-edits/launch-deck-v3/edited-fragments.json')).toBe('edit');
    expect(stepOf(null)).toBeNull();
  });

  it('a cancelled run and a non-floor failure each get their own honest sentence', () => {
    const cancelled = parseRunFailure(`The crew run answering your ask was cancelled (run ${RUN}). Inspect it via the crew API (GET /api/v1/runs/${RUN}), then resend the message.`);
    expect(cancelled?.cancelled).toBe(true);
    expect(cancelled?.summary).toBe('The run was cancelled before it produced anything — nothing changed in your document.');
    expect(cancelled?.reason).toBe('');

    const other = parseRunFailure(`The crew run answering your ask failed (run ${RUN}). Reason: worker exited 137 (out of memory). Inspect it via the crew API (GET /api/v1/runs/${RUN}), then resend the message.`);
    expect(other?.summary).toBe('The run failed before it produced the new version — nothing changed in your document.');
    expect(other?.reason).toBe('worker exited 137 (out of memory).');
    // A floor that names no EXPECTED path still says the honest generic thing.
    expect(summarize('ask', false, 'deliverable floor: nothing declared', null))
      .toBe('The run finished without producing the new version, so this turn did not land — nothing changed in your document.');
  });

  it('any other narration is NOT a run failure', () => {
    expect(parseRunFailure('A governed crew picked up your ask — revising the document…')).toBeNull();
    expect(parseRunFailure('Crew could not start a run for this document: engine busy. The assist loop can still take over.')).toBeNull();
    expect(parseRunFailure('')).toBeNull();
  });
});
