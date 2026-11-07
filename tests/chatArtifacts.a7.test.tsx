import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CHAT-ARTIFACTS-001 slice A7 (studio): theme via chat (§9, §13 A7, §13.2 #7). No governed run (§15.2).
 *  - The card shows every key that changes, what a theme can't change, the contrast of the merged result measured on a
 *    rendered probe, and the disclosure. A low-contrast patch can't be previewed.
 *  - Preview is tab-local (nothing posted, nothing saved); a second preview accumulates; Apply merges only the delta's
 *    keys, says Saving / Saved / failed with Retry, and only then answers Go with the applied delta.
 *  - Undo restores only the patch keys still holding what Apply set; a slider moved since stays.
 */
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { foldChatProposals, proposalAsk, changeRoute, proposalRecordLine, proposalResultWords, resetSettledProposals, themeChangeWords } = await import('../src/board/artifactProposal.js');
const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');
const { contrastRatio, measureTheme, parseCssColor, setThemeProbe } = await import('../src/theming/themeContrast.js');
const { appearanceContext } = await import('../src/components/AskDock.js');
const { ThemePreviewBar } = await import('../src/components/ThemePreviewBar.js');
const { ThemeProposalPanel } = await import('../src/components/ThemePage.js');
const { useAmbientMood } = await import('../src/hooks/useAmbientMood.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;

const T0 = 1_700_000_000_000;
const RUN = 'r-ask';
const PID = 'chat-ask:t1';

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    pid: PID, chatId: 'chat-ask', turnId: 't1', kind: 'theme', seat: 'claude',
    what: { entry: 'document-static', title: 'Release note', label: 'Document · Release note', outcome: 'A document in studio you can edit in place and export as PDF.' },
    brief: 'what changed', reason: null,
    sources: [
      { token: 'chat', label: 'this conversation', status: 'ok' },
      { token: 'run:29bbbfb1-0000', label: 'run 29bbbfb1 · stopped', status: 'ok', projectId: null },
      { token: 'run:1a2b3c4d-0000', label: 'run 1a2b3c4d', status: 'struck', reason: 'not named in this chat', projectId: null },
    ],
    repos: ['wicked-crew'],
    helpers: { seats: ['codex', 'claude'], label: 'Codex and Claude Code: one writes, the other checks' },
    time: { minutes: [10, 20], cost: 'medium', steps: 3, median: { runs: 4, minutes: 9, costUsd: 0.62, costRuns: 4 }, label: 'About 10–20 min · 3 agent steps · median of 4 past documents here: 9 min, $0.62' },
    stops: 'Stops for you if the check fails. The plan or an escalation may also ask.',
    filedIn: { projectId: null, label: 'Not in a project · this chat' },
    blocked: null,
    ...over,
  };
}

/** A theme proposal as crew resolves it (no helpers, time or stops). */
function themeProposal(patch: Record<string, string | number | boolean> = { theme: 'wicked-dark', accent_h: 210, accent_s: 14, accent_l: 70, ambient: false }, over: Partial<Proposal> = {}): Proposal {
  return proposal({
    kind: 'theme', what: { entry: null, title: 'Calm night', label: 'Theme · Calm night', outcome: 'A studio appearance you preview, then apply. Nothing else changes.' },
    brief: null, sources: [], repos: [], helpers: null, time: null, stops: null, filedIn: { projectId: null, label: 'Your studio settings' },
    theme: { name: 'Calm night', patch, changes: Object.keys(patch) }, ...over,
  });
}

const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'release note', unit_ix: 1, chat_id: 'chat-ask', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1' }),
]);
const TURN = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'Write a release note from runs 29bbbfb1 and 1a2b3c4d' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'I can make that into a document.' },
];

let chatBody: Record<string, unknown> = {};
const posts: Array<{ path: string; body: unknown }> = [];
let decideAnswer: () => Response | Promise<Response> = () => new Response('{}', { status: 500 });
/** `GET /chats/:id/messages` (an ended chat's kept history): its body, or an error status. */
let keptBody: Record<string, unknown> | number = 404;
/** `GET /chats/:id` fails with this status (the chat's own status read). */
let chatFail: number | null = null;
/** `PUT /settings`: the appearance save. */
let putAnswer: () => Response = () => ok({ settings: {} });

/** The probe (jsdom resolves no stylesheet colours): the action colour is the accent's lightness on a fixed ground, so a
 *  dark accent on the dark ground fails, and anything light passes. */
const grey = (l: number): string => { const v = Math.round((l / 100) * 255); return `rgb(${v}, ${v}, ${v})`; };
function probe(a: { theme: string; accent_l: number }): { ground: string; card: string; action: string; onAction: string; body: string } {
  const dark = a.theme === 'wicked-dark';
  return dark
    ? { ground: 'rgb(18, 18, 18)', card: 'rgb(26, 26, 26)', action: grey(a.accent_l), onAction: 'rgb(20, 20, 20)', body: 'rgb(207, 207, 202)' }
    : { ground: 'rgb(250, 250, 249)', card: 'rgb(255, 255, 255)', action: grey(100 - a.accent_l), onAction: 'rgb(250, 250, 249)', body: 'rgb(60, 60, 56)' };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  putAnswer = () => ok({ settings: {} });
  setThemeProbe(probe as never);
  localStorage.clear();
  useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, theme: 'wicked-light' }, preview: null, save: { state: 'idle', name: null }, answered: null });
  keptBody = 404;
  chatFail = null;
  resetSettledProposals();
  chatBody = { chatId: 'chat-ask', seats: ['claude'], scope: { kind: 'none' }, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: themeProposal() }], path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } };
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: true, chatProposals: true, chatArtifactsStub: false, chatList: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: { [RUN]: [1] } });
  useAskThreadStore.getState().recordTurnGate(RUN, 1);
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never, { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  decideAnswer = () => ok({ view: { proposal: themeProposal(), state: 'decided', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: null, adopted: false, stub: false }, decidedAt: T0 + 3000 } });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'PUT') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return Promise.resolve(putAnswer());
    }
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return path.includes('/proposals/') ? Promise.resolve(decideAnswer()) : Promise.resolve(ok({}));
    }
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/') && path.endsWith('/messages')) {
      if (keptBody === -1) return new Promise<Response>(() => undefined); // a read still in flight
      return Promise.resolve(typeof keptBody === 'number' ? new Response(JSON.stringify({ error: 'read failed' }), { status: keptBody }) : ok(keptBody));
    }
    if (path.startsWith('/chats/') && chatFail !== null) return Promise.resolve(new Response(JSON.stringify({ error: 'unavailable' }), { status: chatFail }));
    if (path.startsWith('/chats/')) return Promise.resolve(ok(chatBody));
    if (path.endsWith('/team')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(ok({}));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function page(onAsk: (text: string, opts: unknown) => void = () => {}, runs = [ASK_RUN], sessionId = 'chat-ask') {
  return render(<SessionPage sessionId={sessionId} runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={onAsk} />);
}
const text = (id: string): string => screen.getByTestId(id).textContent?.replace(/\s+/g, ' ').trim() ?? '';


const decidePath = `/chats/chat-ask/proposals/${encodeURIComponent(PID)}`;
const appearanceOf = (): Record<string, unknown> => useAppearanceStore.getState().appearance as unknown as Record<string, unknown>;

describe('the contrast check (rendered probe)', () => {
  it('reads computed colours and measures WCAG ratios; an unreadable colour is not passed', () => {
    expect(parseCssColor('rgb(0, 0, 0)')).toStrictEqual([0, 0, 0, 1]);
    expect(parseCssColor('rgba(255 255 255 / 0.5)')).toStrictEqual([255, 255, 255, 0.5]);
    expect(parseCssColor('color(srgb 1 0 0)')).toStrictEqual([255, 0, 0, 1]);
    expect(parseCssColor('#121212')).toStrictEqual([18, 18, 18, 1]);
    expect(parseCssColor('var(--accent)')).toBeNull();
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(measureTheme({ ...DEFAULT_APPEARANCE, theme: 'wicked-dark', accent_l: 70 }).ok).toBe(true);
    const low = measureTheme({ ...DEFAULT_APPEARANCE, theme: 'wicked-dark', accent_l: 10 });
    expect(low.ok).toBe(false);
    expect(low.failing.join(' ')).toMatch(/action colour on the ground \d\.\d:1, needs 3:1/);
    setThemeProbe(() => null);
    expect(measureTheme({ ...DEFAULT_APPEARANCE, accent_l: 71 })).toMatchObject({ ok: false, ratios: null });
    // jsdom's own probe resolves no stylesheet: unmeasured, never passed.
    setThemeProbe(null);
    expect(measureTheme({ ...DEFAULT_APPEARANCE, accent_l: 72 }).ok).toBe(false);
  });
});

describe('the theme card model', () => {
  it('every key that changes in words, against what the tab shows; a theme record line and result say applied, no job', () => {
    const light = { ...DEFAULT_APPEARANCE, theme: 'wicked-light' as const };
    expect(themeChangeWords(light, { theme: 'wicked-dark', accent_h: 210, accent_s: 14, accent_l: 70, ambient: false }))
      .toStrictEqual(['Wicked Light → Wicked Dark', 'action colour hue 210, saturation 14, lightness 70', 'Ambient off']);
    expect(themeChangeWords({ ...light, theme: 'wicked-dark' }, { theme: 'wicked-dark', ambient: true, ambient_still: true })).toStrictEqual(['Already Wicked Dark', 'Ambient on, still']);
    // The still flag is its own key: said even with Ambient off.
    expect(themeChangeWords(light, { ambient: false, ambient_still: true })).toStrictEqual(['Ambient off (still when on)']);
    const [e] = foldChatProposals([
      { at: 1, turnId: 't1', kind: 'proposal', proposal: themeProposal() },
      { at: 2, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'go', result: { runId: 'aaaaaaaa', artifactRef: null, adopted: false, stub: false } },
    ]);
    expect(proposalRecordLine(e!)).toBe('You applied this theme');
    expect(proposalResultWords(e!)).toBe('Saved to your studio settings · no job was started');
    expect(changeRoute('theme')).toStrictEqual({ kind: 'theme' });
  });

  it('a refused contrast disables Preview and Open in Theme; Not now is the default', () => {
    const [e] = foldChatProposals([{ at: 1, turnId: 't1', kind: 'proposal', proposal: themeProposal() }]);
    const ok = proposalAsk(e!, { stub: false, themeRefused: null });
    expect(ok.options?.map((o) => o.label)).toStrictEqual(['Preview', 'Open in Theme', 'Not now']);
    expect(ok.default).toBe('go');
    const refused = proposalAsk(e!, { stub: false, themeRefused: 'Can’t preview: body text 2.0:1, needs 4.5:1' });
    expect(refused.options?.[0]?.disabled).toMatch(/Can’t preview/);
    expect(refused.options?.[1]?.disabled).toMatch(/Can’t preview/);
    expect(refused.default).toBe('not_now');
  });
});

describe('the preview, Apply and Undo (the appearance store)', () => {
  it('Preview paints only this tab (nothing saved or cached); a second preview adds its patch to the delta', () => {
    const st = useAppearanceStore.getState();
    st.startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { theme: 'wicked-dark', accent_l: 70 } });
    expect(document.documentElement.getAttribute('data-theme')).toBe('wicked-dark');
    expect(appearanceOf()['theme']).toBe('wicked-light');
    expect(localStorage.getItem('studio.appearance.cache')).toBeNull();
    useAppearanceStore.getState().startPreview({ name: 'A bit warmer', seat: 'Claude Code', chatId: 'chat-ask', pid: 'chat-ask:t2', patch: { accent_h: 30 } });
    expect(useAppearanceStore.getState().preview).toMatchObject({ name: 'A bit warmer', pid: 'chat-ask:t2', delta: { theme: 'wicked-dark', accent_l: 70, accent_h: 30 } });
    expect(appearanceContext()).toMatchObject({ theme: 'wicked-dark', accent_h: 30, accent_l: 70, previewOf: 'A bit warmer' });
    useAppearanceStore.getState().endPreview();
    expect(document.documentElement.getAttribute('data-theme')).toBe('wicked-light');
    expect(appearanceContext().previewOf).toBeUndefined();
    expect(posts).toStrictEqual([]);
  });

  it('Apply saves only the delta’s keys, then answers Go with the applied delta; Undo restores only keys still holding Apply’s values', async () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, theme: 'wicked-dark', accent_h: 200, accent_s: 47, accent_l: 70, logo_url: 'https://x.test/l.svg' } });
    useAppearanceStore.getState().startPreview({ name: 'Still ambient', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { ambient: true, ambient_still: true } });
    expect(await useAppearanceStore.getState().applyPreview()).toBe(true);
    const put = posts.find((p) => p.path === '/settings')!.body as { 'studio.appearance': Record<string, unknown> };
    // "Keep my accent": the accent and the logo are untouched; only the patch keys moved.
    expect(put['studio.appearance']).toMatchObject({ theme: 'wicked-dark', accent_h: 200, accent_s: 47, accent_l: 70, logo_url: 'https://x.test/l.svg', ambient: true, ambient_still: true });
    expect(posts.at(-1)).toStrictEqual({ path: decidePath, body: { decision: 'go', edits: { name: 'Still ambient', patch: { ambient: true, ambient_still: true } } } });
    expect(useAppearanceStore.getState()).toMatchObject({ preview: null, save: { state: 'saved', name: 'Still ambient' } });
    // A key moved since Apply (Ambient still turned off by hand) is the person's: Undo leaves it and restores the rest.
    useAppearanceStore.getState().update({ ambient_still: false });
    useAppearanceStore.getState().undoApply();
    expect(appearanceOf()).toMatchObject({ ambient: false, ambient_still: false, accent_h: 200 });
    expect(useAppearanceStore.getState().save.state).toBe('idle');
  });

  it('a slider moved after Apply is not reverted by Undo (§13.2 #7)', async () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, theme: 'wicked-light', accent_h: 200, accent_s: 47, accent_l: 25 } });
    useAppearanceStore.getState().startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { theme: 'wicked-dark', accent_h: 210, accent_l: 70 } });
    await useAppearanceStore.getState().applyPreview();
    useAppearanceStore.getState().update({ accent_h: 120 });
    useAppearanceStore.getState().undoApply();
    expect(appearanceOf()).toMatchObject({ theme: 'wicked-light', accent_h: 120, accent_l: 25 });
  });

  it('a failed save shows the failure, keeps the preview and the saved appearance, and answers nothing; Retry saves', async () => {
    putAnswer = () => new Response(JSON.stringify({ error: 'settings store is read-only' }), { status: 503 });
    useAppearanceStore.getState().startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { theme: 'wicked-dark', accent_l: 70 } });
    expect(await useAppearanceStore.getState().applyPreview()).toBe(false);
    expect(useAppearanceStore.getState().save).toMatchObject({ state: 'failed', error: expect.stringMatching(/read-only/) });
    expect(useAppearanceStore.getState().preview).not.toBeNull();
    expect(appearanceOf()['theme']).toBe('wicked-light');
    expect(posts.filter((p) => p.path.includes('/proposals/'))).toStrictEqual([]);
    putAnswer = () => ok({ settings: {} });
    expect(await useAppearanceStore.getState().applyPreview()).toBe(true);
    expect(appearanceOf()['theme']).toBe('wicked-dark');
  });

  it('Apply re-measures the exact merged result: a base that moved into low contrast is not saved', async () => {
    useAppearanceStore.getState().startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { theme: 'wicked-dark' } });
    // The saved accent moved meanwhile (another surface): dark ground + a dark accent fails.
    useAppearanceStore.setState({ appearance: { ...useAppearanceStore.getState().appearance, accent_l: 8 } });
    expect(await useAppearanceStore.getState().applyPreview()).toBe(false);
    expect(useAppearanceStore.getState().save).toMatchObject({ state: 'failed', error: expect.stringMatching(/^Not applied: action colour on the ground/) });
    expect(posts).toStrictEqual([]);
  });
});

describe('the preview, Apply and Undo: edges (review r1)', () => {
  const start = (o: { chatId?: string; pid?: string; patch?: Record<string, unknown> } = {}): void =>
    useAppearanceStore.getState().startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: o.chatId ?? 'chat-ask', pid: o.pid ?? PID, patch: (o.patch ?? { theme: 'wicked-dark', accent_l: 70 }) as never });

  it('Go records the values studio saved (rounded), the one delta saved, recorded and undone', async () => {
    start({ patch: { theme: 'wicked-dark', accent_s: 47.4, accent_l: 70.4 } });
    await useAppearanceStore.getState().applyPreview();
    expect(posts.at(-1)?.body).toStrictEqual({ decision: 'go', edits: { name: 'Calm night', patch: { theme: 'wicked-dark', accent_s: 47, accent_l: 70 } } });
    expect(useAppearanceStore.getState().save.undo?.applied).toStrictEqual({ theme: 'wicked-dark', accent_s: 47, accent_l: 70 });
  });

  it('a pending debounced write never lands after Apply’s own', async () => {
    vi.useFakeTimers();
    try {
      useAppearanceStore.getState().update({ site_name: 'Mine' });
      start();
      const done = useAppearanceStore.getState().applyPreview();
      await vi.runAllTimersAsync();
      await done;
      const puts = posts.filter((p) => p.path === '/settings').map((p) => (p.body as { 'studio.appearance': Record<string, unknown> })['studio.appearance']);
      expect(puts).toHaveLength(1);
      expect(puts[0]).toMatchObject({ theme: 'wicked-dark', site_name: 'Mine' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('while saving, the preview is frozen; a late settings read keeps the preview on screen', async () => {
    let release: (r: Response) => void = () => undefined;
    putAnswer = () => new Promise<Response>((r) => { release = r; }) as unknown as Response;
    start();
    const done = useAppearanceStore.getState().applyPreview();
    useAppearanceStore.getState().adjustPreview({ accent_h: 10 });
    useAppearanceStore.getState().endPreview();
    start({ pid: 'chat-ask:t9', patch: { accent_h: 99 } });
    expect(useAppearanceStore.getState().preview).toMatchObject({ pid: PID, delta: { theme: 'wicked-dark', accent_l: 70 } });
    release(ok({ settings: {} }));
    expect(await done).toBe(true);
    // A preview started before the startup read answered survives it.
    start({ patch: { theme: 'wicked-dark' } });
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(ok({ settings: { 'studio.appearance': { ...DEFAULT_APPEARANCE, theme: 'wicked-light' } } })));
    await useAppearanceStore.getState().load();
    expect(document.documentElement.getAttribute('data-theme')).toBe('wicked-dark');
    expect(appearanceOf()['theme']).toBe('wicked-light');
  });

  it('a preview from another chat starts fresh; a refused Go after the save says so, on that save only', async () => {
    start({ patch: { accent_h: 30 } });
    start({ chatId: 'other-chat', pid: 'other-chat:t1', patch: { theme: 'wicked-dark', accent_l: 70 } });
    expect(useAppearanceStore.getState().preview?.delta).toStrictEqual({ theme: 'wicked-dark', accent_l: 70 });
    decideAnswer = () => new Response(JSON.stringify({ code: 'proposal_superseded', error: 'a newer proposal in this chat replaced this one' }), { status: 409 });
    expect(await useAppearanceStore.getState().applyPreview()).toBe(true);
    expect(useAppearanceStore.getState().save).toMatchObject({ state: 'saved', pid: 'other-chat:t1', recordError: expect.stringMatching(/^Saved, but the chat did not record it: a newer proposal/) });
  });

  it('a previewed Ambient gets its mood; Back to mine takes it away again', () => {
    document.documentElement.removeAttribute('data-mood');
    renderHook(() => useAmbientMood([], 0));
    expect(document.documentElement.hasAttribute('data-mood')).toBe(false);
    act(() => start({ patch: { theme: 'wicked-dark', accent_l: 70, ambient: true } }));
    expect(document.documentElement.getAttribute('data-mood')).not.toBeNull();
    act(() => useAppearanceStore.getState().endPreview());
    expect(document.documentElement.hasAttribute('data-mood')).toBe(false);
  });

  it('an edit made while Apply saves is kept and persisted after it (the theme keys take the saved values)', async () => {
    let release: (r: Response) => void = () => undefined;
    putAnswer = () => new Promise<Response>((r) => { release = r; }) as unknown as Response;
    start();
    const done = useAppearanceStore.getState().applyPreview();
    useAppearanceStore.getState().update({ site_name: 'Mine' });
    release(ok({ settings: {} }));
    await done;
    expect(appearanceOf()).toMatchObject({ theme: 'wicked-dark', accent_l: 70, site_name: 'Mine' });
    // ...and reaches the daemon: the next write carries both the edit and the applied theme.
    putAnswer = () => ok({ settings: {} });
    await waitFor(() => {
      const last = posts.filter((p) => p.path === '/settings').at(-1)?.body as { 'studio.appearance': Record<string, unknown> } | undefined;
      expect(last?.['studio.appearance']).toMatchObject({ theme: 'wicked-dark', accent_l: 70, site_name: 'Mine' });
    }, { timeout: 3000 });
  });

  it('a failed Apply puts back the saved edit’s write it cancelled', async () => {
    vi.useFakeTimers();
    try {
      useAppearanceStore.getState().update({ site_name: 'Mine' });
      putAnswer = () => new Response(JSON.stringify({ error: 'busy' }), { status: 503 });
      start();
      const done = useAppearanceStore.getState().applyPreview();
      await vi.advanceTimersByTimeAsync(10);
      expect(await done).toBe(false);
      putAnswer = () => ok({ settings: {} });
      await vi.advanceTimersByTimeAsync(1000);
      const puts = posts.filter((p) => p.path === '/settings').map((p) => (p.body as { 'studio.appearance': Record<string, unknown> })['studio.appearance']);
      expect(puts.at(-1)).toMatchObject({ theme: 'wicked-light', site_name: 'Mine' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late refused record of an earlier Apply never lands on a newer save', async () => {
    let releaseA: (r: Response) => void = () => undefined;
    decideAnswer = () => new Promise<Response>((r) => { releaseA = r; }) as unknown as Response;
    start({ pid: 'chat-ask:tA' });
    const a = useAppearanceStore.getState().applyPreview();
    await waitFor(() => expect(posts.some((p) => p.path.includes('tA'))).toBe(true));
    decideAnswer = () => ok({ view: { proposal: themeProposal(), state: 'decided', decision: 'go', result: null, decidedAt: T0 } });
    start({ pid: 'chat-ask:tB', patch: { accent_h: 30 } });
    await useAppearanceStore.getState().applyPreview();
    releaseA(new Response(JSON.stringify({ code: 'proposal_superseded', error: 'x' }), { status: 409 }));
    await a;
    expect(useAppearanceStore.getState().save).toMatchObject({ state: 'saved', pid: 'chat-ask:tB', recorded: true });
    expect(useAppearanceStore.getState().save.recordError).toBeUndefined();
  });

  it('Undo expires on screen even when the record error keeps the bar up', async () => {
    decideAnswer = () => new Response(JSON.stringify({ error: 'no' }), { status: 500 });
    start();
    await useAppearanceStore.getState().applyPreview();
    vi.useFakeTimers();
    try {
      render(<ThemePreviewBar />);
      expect(screen.queryByTestId('theme-preview-undo')).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
      expect(screen.queryByTestId('theme-preview-undo')).toBeNull();
      expect(text('theme-preview-bar')).toMatch(/did not record it/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the preview bar offers no Apply for a preview whose merged result fails contrast', () => {
    start({ patch: { theme: 'wicked-dark', accent_l: 8 } });
    render(<ThemePreviewBar />);
    expect((screen.getByTestId('theme-preview-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(text('theme-preview-bar')).toMatch(/Contrast too low: action colour on the ground/);
  });
});

describe('the theme card in a chat thread', () => {
  it('shows the changes, the contrast, the limits and the disclosure; Preview posts nothing and offers Apply', async () => {
    page();
    const card = await screen.findByTestId('artifact-proposal');
    expect(card.getAttribute('data-kind')).toBe('theme');
    expect(text('artifact-proposal-theme')).toBe('ChangesWicked Light → Wicked Dark · action colour hue 210, saturation 14, lightness 70 · Ambient off');
    expect(text('artifact-proposal-theme-contrast')).toMatch(/^ContrastAction colour on the ground \d+\.\d:1 and on cards \d+\.\d:1 · text on it \d+\.\d:1 · body text \d+\.\d:1$/);
    expect(text('artifact-proposal-theme-limits')).toContain('Fonts and spacing are fixed.');
    expect(text('artifact-proposal-theme-disclosure')).toBe('CheckedProposed by Claude Code · checked by the contrast check · no second agent reviewed it');
    expect(screen.getAllByTestId('theme-swatches')).toHaveLength(1);
    expect(card.contains(document.activeElement)).toBe(false);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await screen.findByTestId('artifact-proposal-previewing');
    expect(posts).toStrictEqual([]);
    expect(document.documentElement.getAttribute('data-theme')).toBe('wicked-dark');
    expect(useAppearanceStore.getState().preview).toMatchObject({ pid: PID, seat: 'Claude Code', name: 'Calm night' });
    // Crew records the answer; the card reads it back (the store answered, not the card).
    const answer = decideAnswer;
    decideAnswer = () => {
      chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: T0 + 3000, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: null, adopted: false, stub: false } }] };
      return answer();
    };
    fireEvent.click(screen.getByTestId('artifact-proposal-theme-apply'));
    await waitFor(() => expect(posts.map((p) => p.path)).toStrictEqual(['/settings', decidePath]));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    expect(text('artifact-proposal-record')).toBe('You applied this theme');
  });

  it('Back to mine ends the preview and gives focus back to Preview; Not now then records the decline', async () => {
    page();
    await screen.findByTestId('artifact-proposal');
    // Keyboard path: focus on the card's confirm, Preview → focus moves to the preview's Apply.
    screen.getByTestId('artifact-proposal-confirm').focus();
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('artifact-proposal-theme-apply'));
    fireEvent.click(screen.getByTestId('artifact-proposal-theme-back'));
    expect(useAppearanceStore.getState().preview).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('wicked-light');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-ask-option')).toBe('go'));
    decideAnswer = () => ok({ view: { proposal: themeProposal(), state: 'decided', decision: 'not_now', result: null, decidedAt: T0 + 3000 } });
    fireEvent.click(card().querySelector('[data-ask-option="not_now"]')!);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(posts).toStrictEqual([{ path: decidePath, body: { decision: 'not_now' } }]));
  });

  it('while previewing, the card describes and measures what Apply saves (the Theme page’s moves included)', async () => {
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await screen.findByTestId('artifact-proposal-previewing');
    act(() => useAppearanceStore.getState().adjustPreview({ accent_h: 30 }));
    await waitFor(() => expect(text('artifact-proposal-theme')).toBe('ChangesWicked Light → Wicked Dark · action colour hue 30, saturation 14, lightness 70 · Ambient off'));
  });

  it('while previewing, the card measures the adjusted preview (a move into low contrast shows there)', async () => {
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await screen.findByTestId('artifact-proposal-previewing');
    act(() => useAppearanceStore.getState().adjustPreview({ accent_l: 8 }));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-theme-contrast').querySelector('[data-ok]')?.getAttribute('data-ok')).toBe('false'));
  });

  it('an Apply from the bar re-reads the card’s chat once the answer is recorded, not before', async () => {
    page();
    await screen.findByTestId('artifact-proposal');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await screen.findByTestId('artifact-proposal-previewing');
    let release: () => void = () => undefined;
    decideAnswer = () => new Promise<Response>((r) => {
      release = () => {
        chatBody = { ...chatBody, messages: [...(chatBody['messages'] as unknown[]), { at: T0 + 3000, turnId: 't1', kind: 'proposal_decided', pid: PID, actor: 'local', decision: 'go', result: { runId: 'aaaaaaaa-1111-5222-8333-444444444444', artifactRef: null, adopted: false, stub: false } }] };
        r(ok({ view: { proposal: themeProposal(), state: 'decided', decision: 'go', result: null, decidedAt: T0 + 3000 } }));
      };
    }) as unknown as Response;
    render(<ThemePreviewBar />);
    fireEvent.click(screen.getByTestId('theme-preview-apply'));
    await waitFor(() => expect(posts.some((p) => p.path === decidePath)).toBe(true));
    // The person dismisses the Saved strip before the answer settles: the card still re-reads after it.
    fireEvent.click(await screen.findByTestId('theme-preview-dismiss'));
    release();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
  });

  it('a theme record with a name but no usable patch is not drawn', async () => {
    const bad = themeProposal();
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: { ...bad, theme: { name: 'Calm night', patch: 'x', changes: [] } } }] };
    page();
    await screen.findAllByTestId('session-turn');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
  });

  it('a theme record without a name or a patch is not drawn (nothing to preview or apply)', async () => {
    const bad = themeProposal();
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: { ...bad, theme: { changes: ['theme'] } } }] };
    page();
    await screen.findAllByTestId('session-turn');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
  });

  it('a low-contrast patch can’t be previewed: the card shows the numbers and Preview is disabled', async () => {
    chatBody = { ...chatBody, messages: [...TURN, { at: T0 + 1500, turnId: 't1', kind: 'proposal', proposal: themeProposal({ theme: 'wicked-dark', accent_l: 8 }) }] };
    page();
    await screen.findByTestId('artifact-proposal');
    expect(screen.getByTestId('artifact-proposal-theme-contrast').querySelector('[data-ok]')?.getAttribute('data-ok')).toBe('false');
    expect(text('artifact-proposal-theme-contrast')).toMatch(/too low: action colour on the ground/);
    const go = card().querySelector<HTMLButtonElement>('[data-ask-option="go"]')!;
    expect(go.disabled || go.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(go);
    expect(useAppearanceStore.getState().preview).toBeNull();
  });
});

describe('the preview bar and the Theme page panel', () => {
  it('render the same preview; Apply from the bar saves, then Saved · Undo', async () => {
    useAppearanceStore.getState().startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { theme: 'wicked-dark', accent_l: 70 } });
    render(<><ThemePreviewBar /><ThemeProposalPanel /></>);
    expect(text('theme-preview-bar')).toBe('Previewing Calm night on this tab onlyApplyBack to mine');
    expect(text('theme-proposal-changes')).toContain('Wicked Light → Wicked Dark · action colour lightness 70');
    expect(screen.getByTestId('theme-proposal-contrast').getAttribute('data-ok')).toBe('true');
    fireEvent.click(screen.getByTestId('theme-preview-apply'));
    await screen.findByTestId('theme-preview-undo');
    expect(text('theme-preview-bar')).toContain('Saved Calm night to your studio settings.');
    expect(screen.queryByTestId('theme-proposal-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('theme-preview-undo'));
    expect(appearanceOf()['theme']).toBe('wicked-light');
    expect(screen.queryByTestId('theme-preview-bar')).toBeNull();
  });

  it('a failed save says so in the bar with Retry', async () => {
    putAnswer = () => new Response(JSON.stringify({ error: 'disk full' }), { status: 500 });
    useAppearanceStore.getState().startPreview({ name: 'Calm night', seat: 'Claude Code', chatId: 'chat-ask', pid: PID, patch: { theme: 'wicked-dark', accent_l: 70 } });
    render(<ThemePreviewBar />);
    fireEvent.click(screen.getByTestId('theme-preview-apply'));
    await waitFor(() => expect(screen.getByTestId('theme-preview-bar').getAttribute('data-state')).toBe('failed'));
    expect(text('theme-preview-bar')).toMatch(/Couldn’t save Calm night: .*disk full/);
    expect(text('theme-preview-apply')).toBe('Retry');
  });
});

const card = (): HTMLElement => screen.getByTestId('artifact-proposal');
