// Video mode's wires — DES-MERGE-001 §4.5, §2.3, §7.7, §6.4 slice 14.
//
// Everything here is a claim about a REQUEST SHAPE or about what lands in the thread,
// because those are the two things the merge is made of: the service is model-free and
// must be told exactly what to record (ADR-0018), and an action the user took that leaves
// no trace in the transcript makes the transcript stop being the record (§2.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDemoFromDraft, demoBrief, demoDraftBody, draftReady, recordFromThread,
  recordingSubject, stepReady, stepTitle, stepWid, submitStepFeedback, type DemoDraft,
} from '../src/interactive/demoWire.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const createDoc = vi.fn();
const requestRecord = vi.fn();
const postEvent = vi.fn();
const injectDocMessage = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
  requestRecord: (...a: unknown[]) => requestRecord(...a),
  postEvent: (...a: unknown[]) => postEvent(...a),
  injectDocMessage: (...a: unknown[]) => injectDocMessage(...a),
}));

const PROJECT = 'proj-abc-123';
const DEMO = 'checkout-walkthrough';
const KEY = threadKey(PROJECT, DEMO);

const DRAFT: DemoDraft = {
  name: 'a demo of the checkout flow',
  targetUrl: 'https://shop.example/ ',
  steps: [
    { subject: 'the storefront', action: 'open it' },
    { subject: 'the cart', action: 'add a hoodie to it' },
    { subject: 'the card form', action: 'fill it in' },
  ],
};

function messages(key = KEY): DocMsg[] {
  return useDocThreadStore.getState().messages[key] ?? [];
}

beforeEach(() => {
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
  createDoc.mockResolvedValue({ name: DEMO, head: 1, kind: 'demo' });
  requestRecord.mockResolvedValue({ queued: true });
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  injectDocMessage.mockResolvedValue({ ok: true, event_id: 'e2', correlation_id: 'c1' });
});
afterEach(() => { vi.clearAllMocks(); });

// ── 1. The ordered wizard (§4.5, §4.1) ───────────────────────────────────────

describe('the ordered demo wizard — order is the thing it exists to carry', () => {
  it('AC: `index` is the AUTHORING position, so spec order cannot drift from wizard order', () => {
    const body = demoDraftBody(PROJECT, DRAFT, 'dmsg-7');

    expect(body.demo_steps?.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(body.demo_steps?.map((s) => s.subject))
      .toEqual(['the storefront', 'the cart', 'the card form']);
    // Re-ordering the draft re-numbers the spec — position IS the index, always.
    const swapped = demoDraftBody(
      PROJECT, { ...DRAFT, steps: [DRAFT.steps[2]!, DRAFT.steps[0]!, DRAFT.steps[1]!] }, 'dmsg-7',
    );
    expect(swapped.demo_steps?.map((s) => s.subject))
      .toEqual(['the card form', 'the storefront', 'the cart']);
    expect(swapped.demo_steps?.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('AC: the submission is a demo, bound to its project, with its target and anchor', () => {
    const body = demoDraftBody(PROJECT, DRAFT, 'dmsg-7');

    expect(body).toMatchObject({
      name: 'a demo of the checkout flow',
      kind: 'demo',
      url: 'https://shop.example/',      // trimmed — the service gets what it can open
      project: PROJECT,
      source_message_id: 'dmsg-7',       // §7.6: the version this lands tags this message
    });
    expect(body.demo_steps).toHaveLength(3);
    expect(body.demo_steps?.[1]).toEqual({ index: 1, subject: 'the cart', action: 'add a hoodie to it' });
  });

  it('a step names WHAT and TO WHAT, or it is not authored', () => {
    expect(stepReady({ subject: 'the cart', action: 'add a hoodie' })).toBe(true);
    expect(stepReady({ subject: 'the cart', action: '   ' })).toBe(false);
    expect(stepReady({ subject: '', action: 'click it' })).toBe(false);
    expect(stepTitle({ subject: ' the cart ', action: ' add a hoodie ' })).toBe('the cart — add a hoodie');
  });

  it('is submittable only with a real target and at least one complete step', () => {
    expect(draftReady(DRAFT)).toBe(true);
    expect(draftReady({ ...DRAFT, steps: [] })).toBe(false);
    expect(draftReady({ ...DRAFT, targetUrl: 'shop.example' })).toBe(false);   // no scheme to open
    expect(draftReady({ ...DRAFT, targetUrl: '' })).toBe(false);
    expect(draftReady({ ...DRAFT, name: '  ' })).toBe(false);
    expect(draftReady({ ...DRAFT, steps: [...DRAFT.steps, { subject: 'x', action: '' }] })).toBe(false);
  });

  it('AC: completion opens the demo conversation with the authored spec as its first line', async () => {
    const { name, text } = await createDemoFromDraft(PROJECT, DRAFT, 'dmsg-7');

    expect(name).toBe(DEMO);
    expect(text).toBe(demoBrief(DRAFT));
    expect(text).toBe([
      'Record a demo of https://shop.example/:',
      '1. the storefront — open it',
      '2. the cart — add a hoodie to it',
      '3. the card form — fill it in',
    ].join('\n'));

    // The thread the messages land in is the CREATED demo's, not the typed name's.
    const thread = messages();
    expect(thread[0]).toMatchObject({ kind: 'user', id: 'dmsg-7', text });
    expect(thread[1]?.kind).toBe('narration');
    // §3.3: the line names the demo, the count, and the target — never a bare status.
    expect((thread[1] as Extract<DocMsg, { kind: 'narration' }>).text)
      .toBe(`Authored “${DEMO}” — 3 steps against https://shop.example/. `
        + 'Recording runs them in a real browser.');
    // §7.6: the version this generation lands tags the message that triggered it.
    expect(useDocThreadStore.getState().pending[KEY]).toContain('dmsg-7');
  });
});

// ── 2. Recording (§2.3, §3.3) ────────────────────────────────────────────────

describe('recording is a message, not a side channel (§2.3)', () => {
  it('AC: the ask and an INFORMATIVE opening line land, then the proxied wire is called', async () => {
    await recordFromThread({
      projectId: PROJECT, demoId: DEMO, ask: `Record “${DEMO}”.`, steps: 5, first: 'Open the storefront',
    });

    expect(requestRecord).toHaveBeenCalledWith(PROJECT, DEMO);
    const thread = messages();
    expect(thread[0]).toMatchObject({ kind: 'user', text: `Record “${DEMO}”.` });
    expect(thread[1]).toMatchObject({
      kind: 'narration',
      text: `Recording “${DEMO}” — 5 steps, starting at “Open the storefront”.`,
    });
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('every opening line names its subject, with or without a spec in hand', () => {
    expect(recordingSubject(DEMO)).toBe(`Recording “${DEMO}” — running its authored steps in a real browser.`);
    expect(recordingSubject(DEMO, 1)).toBe(`Recording “${DEMO}” — 1 step, in a real browser.`);
    expect(recordingSubject(DEMO, 4)).toBe(`Recording “${DEMO}” — 4 steps, in a real browser.`);
  });

  it('a refused request retires the working state and rethrows for its retry (§3.3)', async () => {
    requestRecord.mockRejectedValueOnce(new Error('API 503: recorder busy'));

    await expect(recordFromThread({ projectId: PROJECT, demoId: DEMO, ask: 'Record it.', steps: 2 }))
      .rejects.toThrow('recorder busy');

    // The ask STAYS: what was asked is not erased by the service refusing it.
    expect(messages().filter((m) => m.kind === 'user')).toHaveLength(1);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('terminal');
  });
});

// ── 3. Step-targeted feedback → a SPEC diff (§4.3, §4.5, §7.7) ───────────────

describe('commenting on a step asks for the SPEC to be re-authored', () => {
  it('AC: the request names the version, the step anchors, and demo_step as the target', async () => {
    await submitStepFeedback(PROJECT, DEMO, 2, [
      { index: 1, text: '  add TWO hoodies, not one  ' },
      { index: 3, text: 'pause on the receipt' },
    ]);

    expect(postEvent).toHaveBeenCalledTimes(1);
    const [project, event] = postEvent.mock.calls[0] as [string, {
      event_type: string; payload: Record<string, unknown>;
    }];
    expect(project).toBe(PROJECT);
    expect(event.event_type).toBe('wicked.interactive.feedback.submitted');
    expect(event.payload).toMatchObject({
      document_id: DEMO,
      version: 2,
      // What makes this a spec diff rather than an HTML fragment edit — and therefore
      // what keeps the re-record deterministic instead of a fresh take (ADR-0018).
      target: 'demo_step',
      items: [
        { wid: 'step-1', comment: 'add TWO hoodies, not one' },
        { wid: 'step-3', comment: 'pause on the receipt' },
      ],
    });
    expect(stepWid(1)).toBe('step-1');
  });

  it('AC: N step comments are ONE message and ONE regeneration (§4.3)', async () => {
    await submitStepFeedback(PROJECT, DEMO, 2, [
      { index: 1, text: 'two hoodies' }, { index: 3, text: 'pause here' },
    ]);

    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(injectDocMessage).toHaveBeenCalledTimes(1);
    const user = messages().filter((m) => m.kind === 'user');
    expect(user).toHaveLength(1);
    expect(user[0]?.text).toBe([
      'Feedback on 2 places in this demo:',
      '1. [step-1] two hoodies',
      '2. [step-3] pause here',
    ].join('\n'));
    // Each item stays deep-linkable to the step it targets (§4.3's jump-to affordance).
    expect((user[0] as Extract<DocMsg, { kind: 'user' }>).items?.map((i) => i.wid))
      .toEqual(['step-1', 'step-3']);
  });

  it('a failed inject leaves the batch standing with its retry (§7.7) — the spec still changed', async () => {
    injectDocMessage.mockRejectedValueOnce(new Error('API 500: run not found'));

    const { recorded } = await submitStepFeedback(PROJECT, DEMO, 2, [{ index: 1, text: 'two hoodies' }]);

    expect(recorded).toBe(false);
    expect(postEvent).toHaveBeenCalledTimes(1);   // write 1 landed: the demo IS re-authoring
    expect(messages()[0]).toMatchObject({ kind: 'user', notRecorded: true });
  });

  it('a failed bus event writes NOTHING — nothing was submitted', async () => {
    postEvent.mockRejectedValueOnce(new Error('API 403: not emittable'));

    await expect(submitStepFeedback(PROJECT, DEMO, 2, [{ index: 1, text: 'two hoodies' }]))
      .rejects.toThrow('not emittable');
    expect(injectDocMessage).not.toHaveBeenCalled();
    expect(messages()).toHaveLength(0);
  });
});
