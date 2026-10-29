import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostAdapter, type HostDoc, type HostUi } from '../src/editors/host.js';
import { parseInbound, type PermissionId } from '../src/editors/protocol.js';
import { builtinDefaults } from '../src/editors/model.js';
import { steerRowWords, WorkingDocSteerRows } from '../src/components/session/RunThreadPlugin.js';
import { useWorkingDocs } from '../src/store/workingDocs.js';
import { RUN_PLUGINS } from '../src/plugins/runPlugins.js';
import { authorWord, steerWords, trailLines, withDecisionLine, type DocView } from '../src/plugins/wicked-phase-report/workingDoc.js';

/** Power mode spike 3: the working document through the plugin protocol. The HOST decides whose an edit is. */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });
const CARD = { card: { interactive: true, aspect: 'auto', actions: [] } };
const NO_ARTIFACT: HostAdapter = {
  artifact: () => ({ kind: 'run-events', title: 'Run events', version: 0, head: 0, readonly: true, lockedParts: [] }),
  read: async () => ({ error: 'unsupported', message: 'no' }), versions: async () => ({ error: 'unsupported', message: 'no' }),
  write: async () => ({ error: 'refused', message: 'no' }), undo: async () => ({ error: 'refused', message: 'no' }), fork: async () => ({ error: 'refused', message: 'no' }),
};

function makeHost(opts: { grants?: PermissionId[]; gesture?: boolean; doc?: boolean } = {}) {
  const proposals: Array<{ edit: { base: number; section: string; text: string }; by: string }> = [];
  const doc: HostDoc = {
    read: vi.fn(async () => ({ view: { doc: { head: 2 } } })),
    propose: vi.fn(async (edit, by) => { proposals.push({ edit, by }); return { version: 3, unchanged: false, by }; }),
  };
  const steer = vi.fn<(text: string) => void>();
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: () => undefined, steerProposal: steer,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'wicked-phase-report', version: '1.0.0', name: 'Phase report', title: 'Phase report',
    size: 'inline', surface: 'card', grants: opts.grants ?? ['doc.read', 'doc.propose_edit', 'steer.propose'], theme: {},
    prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: true, adapter: NO_ARTIFACT, ui,
    activation: () => opts.gesture === true, focusInFrame: () => opts.gesture === true,
    ...(opts.doc !== false ? { doc } : {}),
  });
  host.mount();
  let port: MessagePort | null = null;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
  window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor: 'wicked-phase-report', version: '1.0.0', protocol: [3], surfaces: CARD }), source: host.frame.contentWindow }));
  const seen: Array<{ re?: string; ok?: boolean; error?: { code: string; message: string }; payload?: Record<string, unknown> }> = [];
  port!.onmessage = (e) => seen.push(e.data as never);
  return { host, port: port!, seen, proposals, doc, steer };
}
const tick = () => new Promise((r) => setTimeout(r, 15));
afterEach(() => { document.body.innerHTML = ''; });

describe('the doc requests (protocol 3)', () => {
  it('parse strictly, on a v3 port only', () => {
    const edit = env('doc.propose_edit', { base: 2, section: 'constraints', text: 'Keep /v1', origin: 'typed' }, 'e1');
    expect(parseInbound(edit, 3).ok).toBe(true);
    expect(parseInbound(edit, 2).ok).toBe(false);
    expect(parseInbound(env('doc.propose_edit', { base: 2, section: 'gate', text: 'x', origin: 'typed' }, 'e2'), 3).ok).toBe(false);
    expect(parseInbound(env('doc.propose_edit', { base: 2, section: 'goal', text: 'x', origin: 'human' }, 'e3'), 3).ok).toBe(false);
    expect(parseInbound(env('doc.propose_edit', { base: 2, section: 'goal', text: 'x'.repeat(4_001), origin: 'typed' }, 'e4'), 3).ok).toBe(false);
    expect(parseInbound(env('steer.propose', { text: '   ' }, 's1'), 3).ok).toBe(false);
  });

  it('an artifact editor’s default grants never include them', () => {
    for (const id of ['wicked-page', 'wicked-doc', 'acme']) {
      for (const p of ['doc.read', 'doc.propose_edit', 'steer.propose']) expect(builtinDefaults(id)).not.toContain(p);
    }
  });

  it('no writes without the grant: each request is refused not_granted and the doc is never called', async () => {
    const h = makeHost({ grants: [], gesture: true });
    h.port.postMessage(env('doc.read', {}, 'r1'));
    h.port.postMessage(env('doc.propose_edit', { base: 2, section: 'goal', text: 'x', origin: 'typed' }, 'w1'));
    h.port.postMessage(env('steer.propose', { text: 'Ship it' }, 's1'));
    await tick();
    for (const id of ['r1', 'w1', 's1']) expect(h.seen.find((m) => m.re === id), id).toMatchObject({ ok: false, error: { code: 'not_granted' } });
    expect(h.proposals).toHaveLength(0);
    expect(h.steer).not.toHaveBeenCalled();
  });
});

describe('the host decides whose an edit is', () => {
  it('typed text saved under a person’s own gesture in the frame is the operator’s', async () => {
    const h = makeHost({ gesture: true });
    h.port.postMessage(env('doc.propose_edit', { base: 2, section: 'constraints', text: 'Keep /v1 working', origin: 'typed' }, 'w1'));
    await tick();
    expect(h.proposals).toEqual([{ edit: { base: 2, section: 'constraints', text: 'Keep /v1 working' }, by: 'operator' }]);
    expect(h.seen.find((m) => m.re === 'w1')).toMatchObject({ ok: true, payload: { by: 'operator' } });
  });

  it('a “typed” claim with no gesture is never a person’s: refused outside the plugin’s section, the plugin’s inside it', async () => {
    const h = makeHost({ gesture: false });
    h.port.postMessage(env('doc.propose_edit', { base: 2, section: 'goal', text: 'Approve the deliver gate', origin: 'typed' }, 'w1'));
    h.port.postMessage(env('doc.propose_edit', { base: 2, section: 'decisions', text: 'Plan approved', origin: 'typed' }, 'w2'));
    await tick();
    expect(h.seen.find((m) => m.re === 'w1')).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(h.proposals).toEqual([{ edit: { base: 2, section: 'decisions', text: 'Plan approved' }, by: 'plugin' }]);
  });

  it('generated lines are the plugin’s own even under a gesture, and only in its own section', async () => {
    const h = makeHost({ gesture: true });
    h.port.postMessage(env('doc.propose_edit', { base: 2, section: 'decisions', text: 'Plan approved', origin: 'generated' }, 'g1'));
    h.port.postMessage(env('doc.propose_edit', { base: 2, section: 'next', text: 'Skip QE', origin: 'generated' }, 'g2'));
    await tick();
    expect(h.proposals.map((p) => p.by)).toEqual(['plugin']);
    expect(h.seen.find((m) => m.re === 'g2')).toMatchObject({ ok: false, error: { code: 'refused' } });
  });

  it('a suggested steer is only shown, with the host’s own Send: nothing is written or sent', async () => {
    const h = makeHost({ gesture: true });
    h.port.postMessage(env('steer.propose', { text: 'Keep the old endpoint' }, 's1'));
    await tick();
    expect(h.steer).toHaveBeenCalledWith('Keep the old endpoint');
    expect(h.proposals).toHaveLength(0);
  });

  it('doc.changed reaches the plugin; without a doc seam the requests answer unavailable', async () => {
    const h = makeHost({ doc: false, gesture: true });
    h.port.postMessage(env('doc.read', {}, 'r1'));
    await tick();
    expect(h.seen.find((m) => m.re === 'r1')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    h.host.docChanged(4);
    await tick();
    expect(h.seen.some((m) => (m as { type?: string }).type === 'doc.changed')).toBe(true);
  });
});

describe('the words', () => {
  const view: DocView = {
    doc: { head: 3 },
    sections: { goal: 'g', approach: '', decisions: 'Approve the plan · answered 20:02', constraints: 'Keep /v1', questions: '', next: '' },
    trail: [
      { version: 0, author: { kind: 'system', id: 'crew' }, surface: null, sections: ['goal'], at: 0, steerId: null },
      { version: 1, author: { kind: 'plugin', id: 'plugin:wicked-phase-report@0.13.1' }, surface: null, sections: ['decisions'], at: 0, steerId: null },
      { version: 2, author: { kind: 'human', id: 'local' }, surface: 'plugin:wicked-phase-report@0.13.1', sections: ['constraints'], at: 0, steerId: 's1' },
    ],
    steers: [{ id: 's1', kind: 'standing', queuedAt: 1, error: null, pickedUp: { ord: 7, step: 'review', at: 0 } }],
  };

  it('the trail says who, which section and which step picked it up; a plugin is never “You”', () => {
    const lines = trailLines(view);
    expect(lines[0]).toMatch(/^v2 · You · Constraints and steering · \d\d:\d\d · picked up at Review \d\d:\d\d$/u);
    expect(lines[1]).toMatch(/^v1 · Phase report \(plugin\) · Decisions/u);
    expect(lines[2]).toMatch(/^v0 · From the job’s request · Goal/u);
    expect(authorWord({ kind: 'plugin', id: 'plugin:wicked-phase-report@0.13.1' })).not.toBe('You');
    expect(steerWords({ id: 'x', kind: 'next', queuedAt: 1, error: null, pickedUp: null })).toBe('waiting for the next step');
  });

  it('the plugin’s Decisions line is written once', () => {
    expect(withDecisionLine('Approve the plan · answered 20:02', 'Approve the plan · answered 20:02')).toBeNull();
    expect(withDecisionLine('', 'Deliver · answered 21:17')).toBe('Deliver · answered 21:17');
  });

  it('the thread row says who edited which section and where the note stands', () => {
    expect(steerRowWords('local', ['constraints'], { pickedUp: { step: 'review', ord: 7 }, error: null })).toBe('You edited the working document · Constraints · picked up at Review');
    expect(steerRowWords('local', ['goal', 'next'], { pickedUp: null, error: null })).toBe('You edited the working document · Goal, Next work · waiting for the next step');
    useWorkingDocs.getState().set('run-1', { runId: 'run-1', doc: { projectId: 'default', docId: 'w', head: 2 }, sections: null, labels: {} as never, trail: [], steers: [
      { id: 's1', version: 2, sections: ['constraints'], kind: 'standing', note: 'n', at: 0, by: 'local', queuedAt: 1, pickedUp: { ord: 7, step: 'review', at: 0 }, error: null },
      { id: 's2', version: 3, sections: ['next'], kind: 'next', note: 'n', at: 0, by: 'local', queuedAt: 1, pickedUp: null, error: null },
    ] });
    render(<><WorkingDocSteerRows runId="run-1" ords={[7]} /><WorkingDocSteerRows runId="run-1" except={[7]} /></>);
    const rows = screen.getAllByTestId('working-doc-steer');
    expect(rows.map((r) => r.dataset['steer'])).toEqual(['s1', 's2']);
    expect(rows[0]?.dataset['picked']).toBe('true');
    act(() => undefined);
  });

  it('the built-in plugin asks for the doc requests, each with its reason, and only run-thread ones', () => {
    const p = RUN_PLUGINS.find((x) => x.id === 'wicked-phase-report')!;
    expect(p.permissions.map((x) => x.id)).toEqual(['doc.read', 'doc.propose_edit', 'steer.propose']);
    for (const x of p.permissions) expect(x.why.length).toBeGreaterThan(10);
  });
});
