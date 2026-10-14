import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemoView } from '../src/api/demo.js';
import type { WalkthroughView } from '../src/api/walkthrough.js';
import { recordingOf, recordingOfDemo } from '../src/board/walkthroughModel.js';
import { cutOfRecording, RecordingSurfaceAdapter } from '../src/editors/adapters/recording.js';
import type { ArtifactBinding } from '../src/editors/hostApi.js';
import { changedBy } from '../src/editors/model.js';

/** A Blob's text in any realm (jsdom's Blob has no text(); undici's does). */
const textOf = (b: Blob): Promise<string> => (typeof (b as { text?: unknown }).text === 'function'
  ? b.text()
  : new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(b); }));

const binding: ArtifactBinding = { artifactKey: 'recording', title: 'Run recording', kind: 'demo-video', source: 'demo', projectId: 'p', composerKey: 'run', runId: 'run one' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function demo(over: Partial<DemoView> = {}): DemoView {
  return {
    runId: 'run one', url: null, audience: null, stage: 'done', script: null,
    chapters: ['Scope', 'Plan'].map((title, i) => ({ key: `ch${i + 1}`, title, blurb: `Say ${title}`, tags: [], resets: [], recorded: true })),
    markers: [{ at: '0:00', sec: 0, title: 'Scope' }, { at: '0:08', sec: 8, title: 'Plan' }],
    sheets: [], video: { path: 'demo-video/demo.mp4', bytes: 20 }, recording: { readOnly: true },
    review: { verdict: 'accept', findings: [], text: null, rejected: false },
    seats: { recorder: 'recorder', reviewer: 'reviewer' }, syntheticLabelled: true,
    ...over,
  };
}
function walkthrough(over: Partial<WalkthroughView> = {}): WalkthroughView {
  return {
    runId: 'run one', stepId: 'review one', planStepId: 'plan', state: 'passed', cause: null,
    seat: { evaluator: 'reviewer', builders: [] }, tree: null, stale: false, sealed: true,
    video: { mp4: 'take/video.mp4', poster: 'take/poster.jpg', markers: [] }, chapters: [], steps: [],
    ...over,
  };
}
function proofWalkthrough(): WalkthroughView {
  return walkthrough({
    state: 'failed',
    video: { mp4: 'take/video.mp4', poster: null, markers: [{ at: '0:00', sec: 0, title: 'Scope' }, { at: '0:12', sec: 12, title: 'Plan' }] },
    chapters: ['Scope', 'Missing', 'Plan'].map((title, i) => ({
      key: `ch${i + 1}`, title, blurb: `Say ${title}`, tags: [], resets: [], recorded: i !== 1,
      index: i + 1, total: 3, verdict: i === 2 ? 'FAIL' : i === 0 ? 'PASS' : null, takes: 1,
      failedAtSec: i === 2 ? 4 : null, failedFrame: i === 2 ? 'plan/fail.png' : null, proves: [], legs: [],
      checks: [{ id: 'screen', kind: 'on_screen', sentence: `Check ${title}`, passed: i === 2 ? false : i === 0 ? true : null,
        atSec: i === 2 ? 4 : i === 0 ? 3 : null, evidence: i === 2 ? ['plan/screen.png'] : [],
        vaultEntry: i === 2 ? 'proof-1' : null, detail: i === 2 ? '<b>Wrong plan</b>' : null }],
    })),
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('recording cut timing', () => {
  it('keeps marker starts, narration and an unknown final duration without title/end cards', () => {
    const cut = cutOfRecording(recordingOfDemo(demo()), 'Run recording');
    expect(cut.chapters).toMatchObject([
      { startSec: 0, durationSec: 8, say: 'Say Scope' },
      { startSec: 8, durationSec: -1, outSec: -1, say: 'Say Plan' },
    ]);
    expect(cut.style.theme.titleCard.on).toBe(false); expect(cut.style.theme.endCard.on).toBe(false);
    expect(cut.ffmpeg?.burnIn).toBe(false); expect(cut.style.captions.on).toBe(true);
  });
  it('uses a known recording duration or a final end marker', () => {
    const rec = recordingOfDemo(demo());
    expect(cutOfRecording({ ...rec, durationSec: 20 }, 'Run').chapters.at(-1)).toMatchObject({ startSec: 8, durationSec: 12, outSec: 12 });
    rec.markers.push({ at: '0:21', sec: 21, title: 'End' });
    expect(cutOfRecording(rec, 'Run').chapters.at(-1)?.durationSec).toBe(13);
  });
  it('handles a single chapter with known or unknown duration', () => {
    const rec = recordingOfDemo(demo()); rec.chapters = rec.chapters.slice(0, 1); rec.markers = rec.markers.slice(0, 1);
    expect(cutOfRecording(rec, 'Run').chapters[0]?.durationSec).toBe(-1);
    expect(cutOfRecording({ ...rec, durationSec: 11 }, 'Run').chapters[0]?.durationSec).toBe(11);
  });
  it('keeps starts [0, null, 12] unknown and times known chapters to the next known start', () => {
    const rec = recordingOf(proofWalkthrough());
    expect(rec.chapters.map(c => c.startSec)).toEqual([0, null, 12]);
    expect(cutOfRecording({ ...rec, durationSec: 20 }, 'Run').chapters).toMatchObject([
      { startSec: 0, durationSec: 12, outSec: 12 },
      { startSec: -1, durationSec: -1, outSec: -1 },
      { startSec: 12, durationSec: 8, outSec: 8 },
    ]);
    expect(cutOfRecording(rec, 'Run').chapters.at(-1)?.durationSec).toBe(-1);
  });
});

describe('recording proof', () => {
  it('carries chapter verdicts, absolute failure/check times and literal evidence into cut content', () => {
    const cut = cutOfRecording(recordingOf(proofWalkthrough()), 'Run');
    expect(cut.chapters.map(c => c.verdict)).toEqual(['PASS', null, 'FAIL']);
    expect(cut.proof).toEqual({ verdict: 'FAIL', failedAtSec: 16, checks: [
      { id: 'screen', chapter: 'ch1', atSec: 3, text: 'Check Scope', state: 'PASS' },
      { id: 'screen', chapter: 'ch2', atSec: null, text: 'Check Missing', state: 'PENDING' },
      { id: 'screen', chapter: 'ch3', atSec: 16, text: 'Check Plan · <b>Wrong plan</b> · Evidence: plan/screen.png · vault proof-1', state: 'FAIL' },
    ] });
    expect(cutOfRecording(recordingOf({ ...proofWalkthrough(), state: 'passed' }), 'Run').proof?.verdict).toBe('PASS');
    expect(cutOfRecording(recordingOfDemo(demo()), 'Run').proof).toBeUndefined();
  });
  it('does not assign an absent chapter’s check or failing moment to another chapter', () => {
    const view = proofWalkthrough();
    view.chapters[1] = { ...view.chapters[1]!, verdict: 'FAIL', failedAtSec: 2,
      checks: [{ ...view.chapters[1]!.checks[0]!, passed: false, atSec: 2 }] };
    const proof = cutOfRecording(recordingOf(view), 'Run').proof!;
    expect(proof.failedAtSec).toBeNull(); expect(proof.checks[1]).toMatchObject({ state: 'FAIL', atSec: null });
  });
  it('loads host checks, with unique chapter/check ids and state, chapter title and evidence text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(proofWalkthrough())));
    const a = new RecordingSurfaceAdapter({ ...binding, source: 'walkthrough', kind: 'walkthrough' }, 'walkthrough');
    expect(a.capabilities()).not.toContain('checks'); // the host Checks tab is an interactive document's
    expect(await a.checks()).toEqual({ total: 3, checks: [
      { id: 'ch1/screen', text: 'PASS · Scope · Check Scope' },
      { id: 'ch2/screen', text: 'PENDING · Missing · Check Missing' },
      { id: 'ch3/screen', text: 'FAIL · Plan · Check Plan · <b>Wrong plan</b> · Evidence: plan/screen.png · vault proof-1' },
    ] });
    expect(await a.read()).toMatchObject({ content: { proof: { verdict: 'FAIL', failedAtSec: 16 } } });
  });
  it('refreshes proof text even when the take path and verdicts stay the same', async () => {
    const view = proofWalkthrough(); vi.stubGlobal('fetch', vi.fn(async () => json(view)));
    const a = new RecordingSurfaceAdapter(binding, 'walkthrough'); await a.read();
    view.chapters[2]!.checks[0]!.detail = 'Updated evidence';
    expect(await a.refresh()).toEqual({ head: 2, kind: 'generated' });
    expect(await a.checks()).toMatchObject({ checks: [expect.anything(), expect.anything(), { text: expect.stringContaining('Updated evidence') }] });
  });
  it('returns an empty Checks tab for demos and an unavailable result on a failed read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(demo())));
    expect(await new RecordingSurfaceAdapter(binding, 'demo').checks()).toEqual({ checks: [], total: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await new RecordingSurfaceAdapter(binding, 'walkthrough').checks()).toMatchObject({ error: 'unavailable' });
  });
});

describe('run recording exports', () => {
  it.each(['mp4', 'gif', 'poster'])('exports demo %s through the existing demo wiring', async format => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/export') ? json({ format, path: `demo-video/demo.${format === 'poster' ? 'jpg' : format}`, bytes: 20 }) : json(demo()));
    vi.stubGlobal('fetch', fetchMock);
    const a = new RecordingSurfaceAdapter(binding, 'demo');
    expect(a.exports()).toEqual([]); expect(a.capabilities()).not.toContain('export');
    await a.read();
    expect(a.exports().map(o => o.format)).toEqual(['mp4', 'gif', 'poster']); expect(a.capabilities()).toContain('export');
    const file = `demo.${format === 'poster' ? 'jpg' : format}`;
    expect(await a.exportFile(format, 1)).toMatchObject({ ok: true, file, href: expect.stringContaining(`/api/v1/runs/run%20one/demo/file?path=${encodeURIComponent(`demo-video/${file}`)}`) });
    const posts = fetchMock.mock.calls.filter(call => call[0].endsWith('/export'));
    expect(posts).toHaveLength(format === 'mp4' ? 0 : 1);
    if (format !== 'mp4') expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/runs/run%20one/demo/export'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ format }) }));
  });
  it('offers only MP4 while a demo video is present but conversion is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(demo({ stage: 'recording' }))));
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read();
    expect(a.exports().map(o => o.format)).toEqual(['mp4']);
    expect(await a.exportFile('gif', 1)).toMatchObject({ ok: false });
    expect(await a.exportFile('poster', 1)).toMatchObject({ ok: false });
  });
  it('offers no export without video, even at an exportable stage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(demo({ video: null }))));
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read();
    expect(a.exports()).toEqual([]); expect(a.capabilities()).not.toContain('export');
    expect(await a.exportFile('mp4', 1)).toMatchObject({ ok: false });
  });
  it.each(['mp4', 'poster'])('downloads a walkthrough %s from its step without calling demo export', async format => {
    const fetchMock = vi.fn(async (url: string) => { expect(url).toContain('/walkthrough'); return json(walkthrough()); }); vi.stubGlobal('fetch', fetchMock);
    const a = new RecordingSurfaceAdapter({ ...binding, source: 'walkthrough', kind: 'walkthrough' }, 'walkthrough'); await a.read();
    expect(a.exports().map(o => o.format)).toEqual(['mp4', 'poster']); expect(a.capabilities()).toContain('export');
    const file = format === 'mp4' ? 'video.mp4' : 'poster.jpg';
    expect(await a.exportFile(format, 1)).toMatchObject({ ok: true, file, href: expect.stringContaining(`/api/v1/runs/run%20one/walkthrough/file?step=review+one&path=take%2F${file}`) });
    expect(fetchMock.mock.calls.every(call => !call[0].endsWith('/export'))).toBe(true);
    expect(await a.exportFile('gif', 1)).toMatchObject({ ok: false });
  });
  it('rejects unsupported formats, stale versions and failed conversions', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/export') ? json({ error: 'ffmpeg failed' }, 502) : json(demo())); vi.stubGlobal('fetch', fetchMock);
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read();
    const calls = fetchMock.mock.calls.length;
    expect(await a.exportFile('pdf', 1)).toMatchObject({ ok: false }); expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(await a.exportFile('mp4', 0)).toMatchObject({ ok: false });
    expect(await a.exportFile('gif', 1)).toMatchObject({ ok: false, text: expect.stringContaining('ffmpeg failed') });
  });
});

describe('recording refresh and media', () => {
  it.each(['demo', 'walkthrough'] as const)('announces once when a %s first read without video becomes ready', async source => {
    let ready = false;
    vi.stubGlobal('fetch', vi.fn(async () => json(source === 'demo'
      ? demo({ stage: 'recording', video: ready ? { path: 'demo-video/demo.mp4', bytes: 20 } : null })
      : walkthrough({ state: 'recording', video: { mp4: ready ? 'take/video.mp4' : null, poster: null, markers: [] } }))));
    const a = new RecordingSurfaceAdapter(binding, source); await a.read();
    const changed = vi.fn(), unsubscribe = a.subscribe(changed);
    expect(await a.refresh()).toBeNull(); expect(changed).not.toHaveBeenCalled();
    ready = true;
    const refreshed = await a.refresh();
    expect(refreshed).toEqual({ head: 2, kind: 'generated' });
    expect(changedBy(refreshed!.head, refreshed!.kind, new Set())).toBe('agent');
    expect(await a.read()).toMatchObject({ version: 2, content: { version: 2, readonly: true, ffmpeg: { burnIn: false } } });
    expect(a.artifact()).toMatchObject({ head: 2, version: 2 }); expect(await a.versions()).toMatchObject({ head: 2 });
    expect(a.capabilities()).toContain('export');
    expect(await a.refresh()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1); unsubscribe();
  });
  it('does not consume a pending announcement when a read already moved its own head', async () => {
    let view = demo({ video: null }); vi.stubGlobal('fetch', vi.fn(async () => json(view)));
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read(); view = demo();
    await a.read(); expect(a.artifact().head).toBe(2);
    expect(await a.refresh()).toEqual({ head: 2, kind: 'generated' }); expect(await a.refresh()).toBeNull();
  });
  it('notifies changed export availability without inventing a new video head', async () => {
    let view = demo({ stage: 'reviewing' }); vi.stubGlobal('fetch', vi.fn(async () => json(view)));
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read(); const changed = vi.fn(); const unsubscribe = a.subscribe(changed);
    view = demo({ stage: 'review_gate' }); expect(await a.refresh()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1);
    expect(a.exports().map(o => o.format)).toEqual(['mp4', 'gif', 'poster']); unsubscribe();
    view = demo({ stage: 'reviewing' }); await a.refresh(); expect(changed).toHaveBeenCalledTimes(1);
  });

  it.each(['demo', 'walkthrough'] as const)('moves the %s head and replaces a cached Blob after a same-path re-record', async source => {
    let replaced = false;
    const chapter = (takes: number): WalkthroughView['chapters'][number] => ({
      key: 'scope', title: 'Scope', blurb: 'Scope', tags: [], resets: [], recorded: true,
      index: 1, total: 1, verdict: 'PASS', takes, failedAtSec: null, failedFrame: null, proves: [], legs: [], checks: [],
    });
    const fetchMock = vi.fn(async (url: string) => url.includes('/file?')
      ? new Response(replaced ? 'new video' : 'old video', { headers: { 'Content-Type': 'video/mp4' } })
      : json(source === 'demo'
        ? demo({ video: { path: 'demo-video/demo.mp4', bytes: replaced ? 40 : 20 } })
        : walkthrough({ chapters: [chapter(replaced ? 2 : 1)] })));
    vi.stubGlobal('fetch', fetchMock);
    const a = new RecordingSurfaceAdapter(binding, source); await a.read();
    const first = await a.media('video');
    if ('error' in first) throw new Error(first.message);
    const cached = await a.media('video');
    if ('error' in cached) throw new Error(cached.message);
    expect(cached.blob).toBe(first.blob);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/file?'))).toHaveLength(1);
    const changed = vi.fn(); const unsubscribe = a.subscribe(changed);
    replaced = true;
    const refreshed = await a.refresh();
    expect(refreshed).toEqual({ head: 2, kind: 'generated' });
    expect(changedBy(refreshed!.head, refreshed!.kind, new Set())).toBe('agent');
    expect(changed).toHaveBeenCalledTimes(1);
    const next = await a.media('video');
    if ('error' in next) throw new Error(next.message);
    expect(next.blob).not.toBe(first.blob);
    expect(await textOf(first.blob)).toBe('old video');
    expect(await textOf(next.blob)).toBe('new video');
    const files = fetchMock.mock.calls.filter(([url]) => url.includes('/file?'));
    expect(files).toHaveLength(2); expect(files[1]?.[0]).toBe(files[0]?.[0]);
    expect(await a.refresh()).toBeNull(); unsubscribe();
  });

  it('moves the head when recording state or chapter count changes', async () => {
    let view = demo({ stage: 'recording' });
    vi.stubGlobal('fetch', vi.fn(async () => json(view)));
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read();
    view = demo(); expect(await a.refresh()).toEqual({ head: 2, kind: 'generated' });
    view = demo({ chapters: demo().chapters.slice(0, 1) });
    expect(await a.refresh()).toEqual({ head: 3, kind: 'generated' });
  });

  it('does not cache an old media fetch that finishes after the head moves', async () => {
    let bytes = 20;
    let finish!: (response: Response) => void;
    let files = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string): Promise<Response> => {
      if (!url.includes('/file?')) return json(demo({ video: { path: 'demo-video/demo.mp4', bytes } }));
      files++;
      return files === 1 ? new Promise(resolve => { finish = resolve; }) : new Response('new video');
    }));
    const a = new RecordingSurfaceAdapter(binding, 'demo'); await a.read();
    const old = a.media('video');
    bytes = 40; await a.refresh();
    finish(new Response('old video')); await old;
    const next = await a.media('video');
    if ('error' in next) throw new Error(next.message);
    expect(await textOf(next.blob)).toBe('new video'); expect(files).toBe(2);
  });
  it('fetches recording media from the contained file route and refuses edits', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('/file?') ? new Response('video', { headers: { 'Content-Type': 'video/mp4' } }) : json(demo())); vi.stubGlobal('fetch', fetchMock);
    const a = new RecordingSurfaceAdapter(binding, 'demo');
    expect(await a.media('video')).toMatchObject({ type: 'video/mp4', blob: expect.objectContaining({ size: expect.any(Number) }) });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/api/v1/runs/run%20one/demo/file?path=demo-video%2Fdemo.mp4');
    expect(await a.media({ chapter: 'ch1' })).toMatchObject({ error: 'unsupported' });
    expect(await a.write()).toMatchObject({ error: 'refused' });
    expect(await a.undo()).toMatchObject({ error: 'unsupported' }); expect(await a.fork()).toMatchObject({ error: 'unsupported' });
  });
});
