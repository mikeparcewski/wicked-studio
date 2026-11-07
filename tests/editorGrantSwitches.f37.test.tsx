import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginsPage, deepLinkOf } from '../src/components/editors/PluginsPage.js';
import { grantLabel, grantRows } from '../src/components/editors/EditorGrantSwitches.js';
import { grantNote } from '../src/components/editorHost/GrantNote.js';
import { fetchGrants } from '../src/editors/model.js';

// F37 (e2e W9 P10): an installed editor that asks to change documents could open and render one but never save, and
// its note sent the person to a page with no way to allow it. Now: a switch per asked permission on the editor's
// details (Plugins page), crew's human-only POST behind it, and the note links straight to that switch.

const SHA = 'c'.repeat(64);
const PAGE_SHA = 'a'.repeat(64);
const EDITORS = {
  installs: 'conformance_required',
  editors: [
    { id: 'wicked-page', title: 'Page editor', version: '1.0.0', protocol: [1], kinds: ['page'], sizes: ['inline', 'pane', 'full'],
      permissions: [{ id: 'artifact.read', why: 'r' }, { id: 'artifact.write', why: 'w' }], sha256: PAGE_SHA, bytes: 10,
      first_party: true, enabled: true, source: 'studio-bundle', entry_url: '/api/v1/editors/wicked-page/1.0.0/entry' },
    { id: 'e2e-checklist', title: 'Checklist', version: '1.0.0', protocol: [1], kinds: ['page'], sizes: ['inline', 'full'],
      permissions: [{ id: 'artifact.read', why: 'r' }, { id: 'artifact.write', why: 'tick items' }, { id: 'checks.read', why: 'c' }, { id: 'ui.fullscreen', why: 'f' }],
      sha256: SHA, bytes: 10, first_party: false, enabled: true, source: 'pack', entry_url: '/api/v1/editors/e2e-checklist/1.0.0/entry' },
  ],
};

type Decision = 'allow' | 'ask' | 'deny';
function decided(id: string, d: Record<string, [Decision, string[]]>): unknown {
  return {
    editorId: id, version: '1.0.0', sha256: SHA, project: null, firstParty: false,
    grants: Object.entries(d).map(([permission, [decision, ruleIds]]) => ({ permission, decision, ruleIds, token: `editor:${id}@1.0.0#${SHA}/${permission}` })),
  };
}
const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

/** A crew with a ledger: GET answers from it, POST changes it (the human-only route). */
function crew(opts: { deny?: boolean; refuse?: string } = {}): { fetch: ReturnType<typeof vi.fn>; ledger: Set<string> } {
  const ledger = new Set<string>();
  const now = (): unknown => decided('e2e-checklist', {
    'artifact.read': ['allow', ['EDITOR-OPEN-DEFAULTS']],
    'artifact.write': opts.deny === true ? ['deny', ['KESTREL-NO-WRITE']] : ledger.has('artifact.write') ? ['allow', ['EDITOR-GRANTS']] : ['ask', []],
    'checks.read': ledger.has('checks.read') ? ['allow', ['EDITOR-GRANTS']] : ['ask', []],
    'ui.fullscreen': ['allow', ['EDITOR-OPEN-DEFAULTS']],
  });
  const f = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/editors/e2e-checklist/grants')) {
      if (init?.method === 'POST') {
        if (opts.refuse !== undefined) return json({ error: opts.refuse }, 403);
        const body = JSON.parse(String(init.body)) as { permission: string; allow: boolean };
        if (body.allow) ledger.add(body.permission); else ledger.delete(body.permission);
      }
      return json(now());
    }
    if (url.includes('/editors/wicked-page/grants')) {
      return json(decided('wicked-page', { 'artifact.read': ['allow', ['EDITOR-BUILTIN']], 'artifact.write': ['allow', ['EDITOR-BUILTIN']] }));
    }
    if (url.includes('/editors')) return json(EDITORS);
    return json({});
  });
  vi.stubGlobal('fetch', f);
  return { fetch: f, ledger };
}
const posts = (f: ReturnType<typeof vi.fn>): unknown[] =>
  f.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').map(([u, init]) => ({ url: String(u).replace(/^.*\/api\/v1/u, ''), body: JSON.parse(String((init as RequestInit).body)) }));

async function openDetails(id: string): Promise<void> {
  const tile = await waitFor(() => {
    const t = screen.getAllByTestId('plugin-tile').find((x) => x.dataset['plugin'] === id);
    if (t === undefined) throw new Error(`no card for ${id}`);
    return t;
  });
  fireEvent.click(tile);
}
const switchOf = (p: string): HTMLElement =>
  screen.getAllByTestId('plugin-grant-switch').find((x) => x.dataset['permission'] === p) ?? (() => { throw new Error(`no switch for ${p}`); })();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('F37: what an installed editor asks for is a switch the person turns', () => {
  it('"Can change documents (you can undo)" starts off; on allows it through crew, off revokes it, and May do follows', async () => {
    const c = crew();
    render(<PluginsPage navigate={() => undefined} />);
    await openDetails('e2e-checklist');
    await waitFor(() => expect(switchOf('artifact.write').getAttribute('aria-checked')).toBe('false'));
    // The write switch leads, in words, never the id.
    const rows = screen.getAllByTestId('plugin-grant-row');
    expect(rows.map((r) => r.dataset['permission'])).toEqual(['artifact.write', 'checks.read']);
    expect(rows[0]!.textContent).toContain('Can change documents (you can undo)');
    expect(rows[0]!.textContent).not.toContain('artifact.write');
    // May do no longer ticks what it only asks for.
    expect(screen.getByTestId('editor-plugin-permissions').textContent).not.toContain('change it');
    fireEvent.click(switchOf('artifact.write'));
    await waitFor(() => expect(switchOf('artifact.write').getAttribute('aria-checked')).toBe('true'));
    expect(c.ledger.has('artifact.write')).toBe(true);
    expect(screen.getByTestId('editor-plugin-permissions').textContent).toContain('change it (you can undo)');
    fireEvent.click(switchOf('artifact.write'));
    await waitFor(() => expect(switchOf('artifact.write').getAttribute('aria-checked')).toBe('false'));
    expect(c.ledger.has('artifact.write')).toBe(false);
    expect(posts(c.fetch)).toEqual([
      { url: '/editors/e2e-checklist/grants', body: { permission: 'artifact.write', allow: true, version: '1.0.0', sha256: SHA } },
      { url: '/editors/e2e-checklist/grants', body: { permission: 'artifact.write', allow: false, version: '1.0.0', sha256: SHA } },
    ]);
  });

  it('a built-in editor allowed by default has no switch; a rule that denies shows the rule and no switch; a refusal says Not changed', async () => {
    crew({ deny: true });
    render(<PluginsPage navigate={() => undefined} />);
    await openDetails('wicked-page');
    await waitFor(() => expect(screen.getByTestId('plugin-details-title').textContent).toBe('Page editor'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('plugin-details-grants')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    crew({ deny: true });
    render(<PluginsPage navigate={() => undefined} />);
    await openDetails('e2e-checklist');
    const denied = await waitFor(() => screen.getAllByTestId('plugin-grant-row').find((r) => r.dataset['permission'] === 'artifact.write')!);
    expect(denied.dataset['state']).toBe('denied');
    expect(denied.textContent).toContain('Not allowed by the KESTREL-NO-WRITE rule');
    expect(denied.querySelector('[role="switch"]')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    const c = crew({ refuse: 'only a human operator can install, remove, enable or disable an editor, or allow what it asks for (you are agent/operator)' });
    render(<PluginsPage navigate={() => undefined} />);
    await openDetails('e2e-checklist');
    await waitFor(() => switchOf('artifact.write'));
    fireEvent.click(switchOf('artifact.write'));
    await waitFor(() => expect(screen.getByTestId('plugin-grant-error').textContent).toMatch(/^Not changed: /u));
    expect(switchOf('artifact.write').getAttribute('aria-checked')).toBe('false');
    expect(c.ledger.size).toBe(0);
  });

  it('the deep link ?editor=&allow= opens that editor’s details and puts the keyboard on that switch', async () => {
    crew();
    expect(deepLinkOf('?editor=e2e-checklist&allow=artifact.write')).toEqual({ editor: 'e2e-checklist', allow: 'artifact.write' });
    expect(deepLinkOf('')).toBeNull();
    render(<PluginsPage navigate={() => undefined} search="?editor=e2e-checklist&allow=artifact.write" />);
    await waitFor(() => expect(screen.getByTestId('plugin-details').dataset['plugin']).toBe('e2e-checklist'));
    await waitFor(() => expect(document.activeElement).toBe(switchOf('artifact.write')));
  });
});

describe('F37: the host note goes straight to the switch', () => {
  it('names what it asks in words and links to /plugins?editor=<id>&allow=<permission>', async () => {
    crew();
    const got = await fetchGrants('e2e-checklist', '1.0.0', SHA, 'proj-1');
    expect(got.grants).toEqual(['artifact.read', 'ui.fullscreen']);
    expect(got.note).toBe('This editor asks to change it (you can undo) and see the checks. Allow it in Plugins.');
    expect(got.allow).toEqual({ href: '/plugins?editor=e2e-checklist&allow=artifact.write', permission: 'artifact.write' });
    const go = vi.fn();
    render(<p data-testid="note">{grantNote(got, go)}</p>);
    expect(screen.getByTestId('note').textContent).toBe('This editor asks to change it (you can undo) and see the checks. Allow it in Plugins');
    const a = screen.getByTestId('editor-grants-allow');
    expect(a.getAttribute('href')).toBe('/plugins?editor=e2e-checklist&allow=artifact.write');
    fireEvent.click(a);
    expect(go).toHaveBeenCalledWith('/plugins?editor=e2e-checklist&allow=artifact.write');
  });

  it('nothing asked, no note; only the install consent’s grant asked, no link (no switch exists for it)', async () => {
    expect(grantNote({ note: null, allow: null })).toBeNull();
    expect(grantNote({ note: 'This editor asks to start and talk to the MCP servers you connect it to.', allow: null })).toBe('This editor asks to start and talk to the MCP servers you connect it to.');
    expect(grantRows({ grants: [{ permission: 'mcp.session', decision: 'ask', ruleIds: [], token: 't' }] })).toEqual([]);
    expect(grantLabel('artifact.write')).toBe('Can change documents (you can undo)');
    expect(grantLabel('checks.read')).toBe('Can see the checks');
  });
});
