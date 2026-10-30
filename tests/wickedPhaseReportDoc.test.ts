import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Phase report plugin's working-document editor (spike 3, review of #928): the real plugin entry, driven over a
 * stand-in host port. A refresh never moves a draft's base, text typed while a save is in flight is kept, only the
 * newest read is shown, a failed read keeps the document and offers a retry, an unsaved draft is never thrown away,
 * and the plugin's own Decisions lines are written one at a time.
 */

type Msg = { p?: string; v?: number; type?: string; id?: string; re?: string; ok?: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string } };
type Answer = { ok: true; payload: Record<string, unknown> } | { ok: false; error: { code: string; message: string } };

type SectionId = 'goal' | 'approach' | 'decisions' | 'constraints' | 'questions' | 'next';
const view = (head: number, over: Partial<Record<SectionId, string>> = {}) => ({
  doc: { head }, sections: { goal: 'g', approach: '', decisions: '', constraints: '', questions: '', next: '', ...over }, trail: [], steers: [],
});

let handlers: [string, EventListenerOrEventListenerObject][] = [];
afterEach(() => {
  for (const [type, handler] of handlers) window.removeEventListener(type, handler);
  handlers = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Boot the plugin. `answer` decides each request's reply (sync or as a promise the test controls). */
async function boot(answer: (m: Msg) => Answer | Promise<Answer>, { waitDoc = true }: { waitDoc?: boolean } = {}) {
  vi.resetModules();
  document.head.innerHTML = '<meta name="wicked-editor" content="wicked-phase-report"><meta name="wicked-editor-version" content="1.0.0">';
  document.body.innerHTML = '<main id="root" class="folded"><button id="sum"><span id="dot"></span><span id="sum-text"></span></button><section id="dash" hidden></section><section id="wd" hidden></section></main>';
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe(): void {} disconnect(): void {} };
  }
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, h: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
    handlers.push([type, h]); add(type, h, o);
  }) as typeof window.addEventListener);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  await import('../src/plugins/wicked-phase-report/plugin.js');
  const sent: Msg[] = [];
  const port = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    start(): void {},
    close(): void {},
    postMessage(m: Msg) {
      sent.push(m);
      if (m.id === undefined) return;
      void Promise.resolve(answer(m)).then((a) => port.onmessage?.(new MessageEvent('message', { data: { p: 'wicked.editor', v: 1, re: m.id, ...a } })));
    },
  };
  const push = (type: string, payload: unknown) => port.onmessage?.(new MessageEvent('message', { data: { p: 'wicked.editor', v: 1, type, payload } }));
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { p: 'wicked.editor', v: 1, type: 'host.hello', payload: { protocol: 3, grants: ['doc.read', 'doc.propose_edit', 'steer.propose'], theme: {} } },
    ports: [port],
  }));
  push('host.fold', { folded: false });
  push('events.batch', { runId: 'r', replay: true, rows: [] });
  const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
  if (waitDoc) await vi.waitFor(() => expect($('#wd .wd-sec')).not.toBeNull());
  const edits = () => sent.filter((m) => m.type === 'doc.propose_edit');
  const openSection = (id: string) => { $(`.wd-sec[data-section="${id}"] .wd-text`)!.click(); return $(`.wd-sec[data-section="${id}"] textarea`) as HTMLTextAreaElement; };
  const save = (id: string) => ($(`.wd-sec[data-section="${id}"] button.primary`) as HTMLButtonElement).click();
  return { sent, edits, push, $, openSection, save };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the working-document editor', () => {
  it('a refresh while editing never moves the save’s base: a change made meanwhile is a conflict, then the person decides', async () => {
    let head = 1;
    let server = view(1);
    const b = await boot((m) => {
      if (m.type === 'doc.read') return { ok: true, payload: { view: server } };
      if (m.type === 'doc.propose_edit') return m.payload?.['base'] === head ? { ok: true, payload: { version: ++head } } : { ok: false, error: { code: 'head_moved', message: 'moved' } };
      return { ok: true, payload: {} };
    });
    const ta = b.openSection('constraints');
    ta.value = 'Keep /v1';
    // Someone else changes Constraints; the change frame refreshes the document under the open editor.
    head = 2;
    server = view(2, { constraints: 'Keep /v2' });
    b.push('doc.changed', { head: 2 });
    await vi.waitFor(() => expect(b.$('.wd-ver')?.textContent).toBe('version 2'));
    expect((b.$('.wd-sec[data-section="constraints"] textarea') as HTMLTextAreaElement).value).toBe('Keep /v1');
    b.save('constraints');
    await vi.waitFor(() => expect(b.$('.wd-status')?.textContent).toMatch(/changed the document meanwhile/u));
    expect(b.edits()[0]?.payload?.['base']).toBe(1);
    expect(b.$('.wd-now')?.textContent).toBe('Now: Keep /v2');
    expect((b.$('.wd-sec[data-section="constraints"] textarea') as HTMLTextAreaElement).value).toBe('Keep /v1');
    // Having seen it, the person saves again: on the version they now see.
    b.save('constraints');
    await vi.waitFor(() => expect(b.edits()).toHaveLength(2));
    expect(b.edits()[1]?.payload?.['base']).toBe(2);
  });

  it('text typed while a save is in flight is kept as the draft, and a second save waits for the first', async () => {
    let release: () => void = () => undefined;
    const b = await boot((m) => {
      if (m.type === 'doc.read') return { ok: true, payload: { view: view(1) } };
      if (m.type === 'doc.propose_edit') return new Promise<Answer>((res) => { release = () => res({ ok: true, payload: { version: 2 } }); });
      return { ok: true, payload: {} };
    });
    const ta = b.openSection('next');
    ta.value = 'first';
    b.save('next');
    await tick();
    expect((b.$('.wd-sec[data-section="next"] button.primary') as HTMLButtonElement).disabled).toBe(true);
    b.save('next');
    ta.value = 'first and more';
    release();
    await vi.waitFor(() => expect(b.$('.wd-status')?.textContent).toMatch(/Saved as version 2/u));
    expect(b.edits()).toHaveLength(1);
    expect((b.$('.wd-sec[data-section="next"] textarea') as HTMLTextAreaElement).value).toBe('first and more');
  });

  it('only the newest read is shown', async () => {
    const replies: Array<(a: Answer) => void> = [];
    let n = 0;
    const b = await boot((m) => {
      if (m.type !== 'doc.read') return { ok: true, payload: {} };
      n += 1;
      if (n === 1) return { ok: true, payload: { view: view(1) } };
      return new Promise<Answer>((res) => { replies.push(res); });
    });
    b.push('doc.changed', { head: 2 });
    b.push('doc.changed', { head: 3 });
    await tick();
    expect(replies).toHaveLength(2);
    replies[1]!({ ok: true, payload: { view: view(3, { goal: 'three' }) } });
    await vi.waitFor(() => expect(b.$('.wd-ver')?.textContent).toBe('version 3'));
    replies[0]!({ ok: true, payload: { view: view(2, { goal: 'two' }) } });
    await tick(); await tick();
    expect(b.$('.wd-ver')?.textContent).toBe('version 3');
    expect(b.$('.wd-sec[data-section="goal"] .wd-text')?.textContent).toBe('three');
  });

  it('a failed read keeps the document and offers a retry; only an unsupported service says it keeps none', async () => {
    let fail: string | null = null;
    const b = await boot((m) => (m.type === 'doc.read' ? (fail !== null ? { ok: false, error: { code: fail, message: 'x' } } : { ok: true, payload: { view: view(1, { goal: 'kept' }) } }) : { ok: true, payload: {} }));
    fail = 'unavailable';
    b.push('doc.changed', { head: 1 });
    await vi.waitFor(() => expect(b.$('#wd')?.textContent).toMatch(/could not be read just now/u));
    expect(b.$('.wd-sec[data-section="goal"] .wd-text')?.textContent).toBe('kept');
    fail = null;
    (Array.from(document.querySelectorAll<HTMLButtonElement>('#wd button')).find((x) => x.textContent === 'Try again'))!.click();
    await vi.waitFor(() => expect(b.$('#wd')?.textContent).not.toMatch(/could not be read/u));
    fail = 'unsupported';
    b.push('doc.changed', { head: 1 });
    await vi.waitFor(() => expect(b.$('#wd')?.textContent).toMatch(/keeps no working document/u));
  });

  it('a click elsewhere never throws an unsaved draft away; an untouched editor just moves', async () => {
    const b = await boot((m) => (m.type === 'doc.read' ? { ok: true, payload: { view: view(1) } } : { ok: true, payload: {} }));
    const ta = b.openSection('approach');
    ta.value = 'unsaved';
    b.$('.wd-sec[data-section="next"] .wd-text')!.click();
    expect(b.$('.wd-status')?.textContent).toBe('Save or cancel Approach first.');
    expect((b.$('.wd-sec[data-section="approach"] textarea') as HTMLTextAreaElement).value).toBe('unsaved');
    ta.value = '';
    b.$('.wd-sec[data-section="next"] .wd-text')!.click();
    expect(b.$('.wd-sec[data-section="next"] textarea')).not.toBeNull();
    expect((b.$('.wd-sec[data-section="next"] textarea') as HTMLTextAreaElement).value).toBe('');
    expect(b.$('.wd-sec[data-section="approach"] textarea')).toBeNull();
  });

  it('filled from events: before a document exists its lines show as not saved and nothing is written; once one exists they are saved as the plugin’s', async () => {
    let started = false;
    let questions = '';
    const b = await boot((m) => {
      if (m.type === 'doc.read') {
        return started ? { ok: true, payload: { view: view(1, { questions }) } } : { ok: true, payload: { view: { doc: null, sections: null, trail: [], steers: [] } } };
      }
      if (m.type === 'doc.propose_edit') { questions = String(m.payload?.['text']); return { ok: true, payload: { version: 2 } }; }
      return { ok: true, payload: {} };
    });
    b.push('events.batch', { runId: 'r', replay: false, rows: [{ id: 'g', topic: 'wicked.run.human.awaited', seq: 1, at: 1_000, ord: 4, data: { kind: 'deliver' } }] });
    await vi.waitFor(() => expect(b.$('.wd-sec[data-section="questions"] .wd-gen')?.textContent).toMatch(/^Waiting on you · /u));
    expect(b.$('.wd-sec[data-section="questions"] h4')?.textContent).toMatch(/Phase report \(plugin\)/u);
    expect(b.edits()).toHaveLength(0);
    // A person's edit started the document: the plugin's line is saved now, as generated text in its own section.
    started = true;
    b.push('doc.changed', { head: 1 });
    await vi.waitFor(() => expect(b.edits()).toHaveLength(1));
    expect(b.edits()[0]!.payload).toMatchObject({ section: 'questions', origin: 'generated' });
    expect(questions).toMatch(/^Waiting on you · .* · since \d\d:\d\d$/u);
  });

  it('a crew that writes the lines itself (eventLines): the plugin renders them, writes none, and still saves a person’s edit (ui-gaps-2, crew#1224)', async () => {
    let head = 1;
    // crew's own line, already in the document; the run also has an open gate the plugin would otherwise write.
    let questions = 'Waiting on you · Approve the plan · since 10:00';
    let constraints = '';
    const b = await boot((m) => {
      if (m.type === 'doc.read') return { ok: true, payload: { view: { ...view(head, { questions, constraints }), eventLines: true } } };
      if (m.type === 'doc.propose_edit') {
        if (m.payload?.['section'] === 'constraints') constraints = String(m.payload?.['text']);
        else questions = String(m.payload?.['text']);
        head += 1;
        return { ok: true, payload: { version: head } };
      }
      return { ok: true, payload: {} };
    });
    b.push('events.batch', { runId: 'r', replay: false, rows: [{ id: 'g', topic: 'wicked.run.human.awaited', seq: 1, at: 1_000, ord: 4, data: { kind: 'deliver' } }] });
    b.push('doc.changed', { head: 1 });
    await tick(); await tick();
    expect(b.$('.wd-sec[data-section="questions"]')?.textContent).toContain('Waiting on you · Approve the plan · since 10:00');
    // No "not saved yet" line of its own, and nothing written as the plugin.
    expect(b.$('.wd-sec[data-section="questions"] .wd-gen')).toBeNull();
    expect(b.edits()).toHaveLength(0);
    const ta = b.openSection('constraints');
    ta.value = 'Keep /v1';
    b.save('constraints');
    await vi.waitFor(() => expect(b.edits()).toHaveLength(1));
    expect(b.edits()[0]!.payload).toMatchObject({ section: 'constraints', origin: 'typed', text: 'Keep /v1' });
    await tick(); await tick();
    expect(b.edits()).toHaveLength(1);
  });

  it('the plugin’s own Decisions lines go one at a time, waiting for the first read, retried once after a conflict', async () => {
    let head = 1;
    let decisions = '';
    let firstRead: (a: Answer) => void = () => undefined;
    let reads = 0;
    const b = await boot((m) => {
      if (m.type === 'doc.read') {
        reads += 1;
        const v = { ok: true as const, payload: { view: view(head, { decisions }) } };
        return reads === 1 ? new Promise<Answer>((res) => { firstRead = res; }) : v;
      }
      if (m.type === 'doc.propose_edit') {
        if (m.payload?.['base'] !== head) return { ok: false, error: { code: 'head_moved', message: 'x' } };
        decisions = String(m.payload?.['text']); head += 1;
        return { ok: true, payload: { version: head } };
      }
      return { ok: true, payload: {} };
    }, { waitDoc: false });
    // Two gates opened earlier, both answered live, before the first read came back.
    b.push('events.batch', { runId: 'r', replay: true, rows: [
      { id: 's1', topic: 'wicked.run.human.awaited', seq: 1, at: 1_000, ord: 2, data: { kind: 'plan_approval' } },
      { id: 's2', topic: 'wicked.run.human.awaited', seq: 2, at: 2_000, ord: 6, data: { kind: 'escalation' } },
    ] });
    b.push('events.batch', { runId: 'r', replay: false, rows: [
      { id: 'l1', topic: 'wicked.run.session.resumed', seq: null, at: 3_000, ord: 2, data: {} },
      { id: 'l2', topic: 'wicked.run.session.resumed', seq: null, at: 4_000, ord: 6, data: {} },
    ] });
    firstRead({ ok: true, payload: { view: view(1, { decisions: '' }) } });
    await vi.waitFor(() => expect(decisions.split('\n')).toHaveLength(2));
    expect(b.edits().every((m) => m.payload?.['origin'] === 'generated' && m.payload?.['section'] === 'decisions')).toBe(true);
    expect(decisions).toMatch(/^Approve the plan · answered .*\nA failed check or review · answered /u);
  });
});
