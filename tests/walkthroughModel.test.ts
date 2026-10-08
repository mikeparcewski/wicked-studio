// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DemoView } from '../src/api/demo.js';
import type { WalkthroughChapter, WalkthroughView } from '../src/api/walkthrough.js';
import {
  authorWaiting, checksTrack, chapterMarks, escalationOpen, exportOptions, failedChapter, fixNote, fmtTime, gateVerbs, playheadStart, recordingOf, recordingOfDemo,
  seatLine, stateLine, takeFingerprint, underneathLines,
} from '../src/board/walkthroughModel.js';

/**
 * The walkthrough artifact's words and geometry (DES-WALKTHROUGH-PROOF-001 §3 scenes 18–23, 41;
 * slice WT-U1), pure: each case is one scene of concept-studio.html.
 */

function chapter(i: number, over: Partial<WalkthroughChapter> = {}): WalkthroughChapter {
  return {
    key: `ch${i}`, title: `Chapter ${i}`, blurb: `What chapter ${i} shows`, tags: [], resets: [], recorded: true,
    index: i, total: 6, verdict: 'PASS', takes: 1, failedAtSec: null, failedFrame: null, proves: ['build'], legs: [],
    checks: [
      { id: `c${i}-screen`, kind: 'on_screen', sentence: `The screen says ${i}`, passed: true, atSec: 3, evidence: [`ch${i}/screen.png`], vaultEntry: null, detail: null },
      { id: `c${i}-state`, kind: 'saved_state', sentence: `The order ${i} is saved`, passed: true, atSec: 9, evidence: [`ch${i}/state.json`], vaultEntry: null, detail: null },
    ],
    ...over,
  };
}

function view(over: Partial<WalkthroughView> = {}): WalkthroughView {
  const chapters = [1, 2, 3, 4, 5, 6].map((i) => chapter(i));
  return {
    runId: 'r-walk', stepId: 'walkthrough_review', planStepId: 'walkthrough_plan', state: 'passed', cause: null,
    seat: { evaluator: 'agy', builders: ['codex'] }, tree: 'a1b2c3d', stale: false, sealed: true,
    video: { mp4: 'take/video.mp4', poster: 'take/poster.jpg', markers: chapters.map((c, i) => ({ at: fmtTime(i * 10), sec: i * 10, title: c.title })) },
    chapters, steps: [{ stepId: 'build', checkState: 'checked', provedBy: [{ chapter: 'ch4', atSec: 34 }] }],
    ...over,
  };
}

describe('scene 18 — recording', () => {
  it('says the chapter being recorded, and who checks and who builds', () => {
    const chapters = [1, 2, 3, 4, 5, 6].map((i) => chapter(i, { recorded: i < 4, takes: i < 4 ? 1 : 0, verdict: null }));
    const r = recordingOf(view({ state: 'recording', chapters, sealed: false, video: { mp4: null, poster: null, markers: [] } }));
    expect(stateLine(r)).toEqual({ mark: '●', text: 'Recording · chapter 4 of 6', tone: 'live' });
    expect(seatLine(r)).toBe('agy checks, codex builds');
    expect(chapterMarks(r).map((m) => m.current)).toEqual([false, false, false, true, false, false]);
    expect(exportOptions(r)).toEqual([]);
    expect(gateVerbs(r, true)).toEqual([]);
  });
  it('reads "recorded" off the wire’s own flag: crew floors `takes` at 1 for every chapter', () => {
    const chapters = [1, 2, 3, 4, 5, 6].map((i) => chapter(i, { recorded: i < 4, takes: 1, verdict: null }));
    const r = recordingOf(view({ state: 'recording', chapters, sealed: false, video: { mp4: null, poster: null, markers: [] } }));
    expect(stateLine(r).text).toBe('Recording · chapter 4 of 6');
  });
});

describe('before the recording', () => {
  it('says "Writing the checks" only while the author is at it; a walkthrough not reached yet says so', () => {
    const r = recordingOf(view({ state: 'authoring', chapters: [], sealed: false, video: { mp4: null, poster: null, markers: [] } }));
    const unit = (status: string) => [{ id: 'r-walk:walkthrough_plan', ord: 3, denial_reason: null, status }];
    expect(authorWaiting(r, unit('pending'))).toBe(true);
    expect(authorWaiting(r, unit('distributed'))).toBe(false);
    expect(authorWaiting(r, [{ id: 'r-other:walkthrough_plan', ord: 3, status: 'pending' }])).toBe(false);
    expect(stateLine(r, { authorWaiting: true })).toEqual({ mark: '○', text: 'Not started yet', tone: 'quiet' });
    expect(stateLine(r)).toEqual({ mark: '○', text: 'Writing the checks', tone: 'quiet' });
  });
});

describe('studio#593 — a refused storyline', () => {
  const empty = { chapters: [], sealed: false, video: { mp4: null, poster: null, markers: [] } };
  it('says the lint refused it, with crew’s cause, instead of an in-progress word', () => {
    const r = recordingOf(view({ state: 'linting', cause: 'pinned validator failed: no coverage report', ...empty }));
    expect(stateLine(r)).toEqual({ mark: '✗', text: 'The storyline was refused — pinned validator failed: no coverage report', tone: 'bad' });
  });
  it('still says "Checking the storyline" while the lint runs (no cause)', () => {
    expect(stateLine(recordingOf(view({ state: 'linting', cause: null, ...empty })))).toEqual({ mark: '○', text: 'Checking the storyline', tone: 'quiet' });
    expect(stateLine(recordingOf(view({ state: 'linting', cause: '  ', ...empty }))).tone).toBe('quiet');
  });
});

describe('scene 19 — a failing chapter at its frame', () => {
  const failed = chapter(4, {
    verdict: 'FAIL', failedAtSec: 11, failedFrame: 'ch4/fail.png', takes: 2,
    checks: [
      { id: 'c4-screen', kind: 'on_screen', sentence: 'Pay for your order shows', passed: true, atSec: 2, evidence: ['ch4/screen.png'], vaultEntry: null, detail: null },
      { id: 'c4-events', kind: 'events', sentence: 'One charge event is emitted', passed: false, atSec: 11, evidence: ['ch4/events.json'], vaultEntry: null, detail: 'two charge events were emitted' },
      { id: 'c4-must', kind: 'must_not_happen', sentence: 'The customer is never charged twice', passed: false, atSec: 11, evidence: ['ch4/charges.json'], vaultEntry: null, detail: null },
    ],
  });
  const r = recordingOf(view({ state: 'failed', chapters: [chapter(1), chapter(2), chapter(3), failed, chapter(5, { verdict: null, recorded: false, takes: 0 }), chapter(6, { verdict: null, recorded: false, takes: 0 })] }));
  it('says where it failed, on the take’s clock (the chapter’s start + its own seconds), and what happened underneath', () => {
    expect(stateLine(r)).toEqual({ mark: '✗', text: 'Failed at 0:41', tone: 'bad' });
    expect(underneathLines(r)).toEqual(['One charge event is emitted — two charge events were emitted', 'The customer is never charged twice']);
    expect(failedChapter(r)?.failedFrame).toBe('ch4/fail.png');
  });
  it('the playhead opens at the failing moment of the stitched take (the chapter’s marker 0:30 + 0:11)', () => {
    expect(playheadStart(r)).toBe(30 + 11);
    const track = checksTrack(r).filter((k) => k.chapter.key === 'ch4');
    expect(track.map((k) => [k.passed, k.atAbsSec])).toEqual([[true, 32], [false, 41], [false, 41]]);
  });
  it('the open gate is this walkthrough’s only when the run is parked on a denied unit of its pair', () => {
    const units = [
      { id: 'r-walk:build', ord: 1, denial_reason: null },
      { id: 'r-walk:walkthrough_plan', ord: 3, denial_reason: null },
      { id: 'r-walk:walkthrough_review', ord: 4, denial_reason: 'the walkthrough failed in chapter 4' },
      { id: 'r-walk:deliver', ord: 5, denial_reason: null },
    ];
    expect(escalationOpen(r, 4, units)).toBe(true);
    // A later gate (the deliver gate of a run whose failed walkthrough was waved through) is not it.
    expect(escalationOpen(r, 5, units)).toBe(false);
    // No gate open; and a recorder that was never denied (a plan gate before it ran).
    expect(escalationOpen(r, null, units)).toBe(false);
    expect(escalationOpen(r, 4, units.map((u) => ({ ...u, denial_reason: null })))).toBe(false);
    // The author's own escalation (its storyline was refused) is the pair's too.
    expect(escalationOpen(r, 3, units.map((u) => (u.ord === 3 ? { ...u, denial_reason: 'storyline_refused' } : { ...u, denial_reason: null })))).toBe(true);
    // Another run's unit with the same step name is not this run's.
    expect(escalationOpen(r, 4, [{ id: 'r-other:walkthrough_review', ord: 4, denial_reason: 'x' }])).toBe(false);
  });
  it('the thin result (keys and verdicts only: no checks, frame, markers or take) still says what failed, and offers nothing to watch', () => {
    const thin = recordingOf(view({
      state: 'failed', video: { mp4: null, poster: null, markers: [] },
      chapters: [
        chapter(1, { key: '01-totals', title: '01-totals', blurb: '', recorded: false, checks: [], proves: [], total: 2 }),
        chapter(2, { key: '02-rounding', title: '02-rounding', blurb: '', recorded: false, verdict: 'FAIL', failedAtSec: 7.5, checks: [], proves: [], total: 2 }),
      ],
    }));
    expect(stateLine(thin)).toEqual({ mark: '✗', text: 'Failed at 0:08', tone: 'bad' });
    expect(underneathLines(thin)).toEqual([]);
    expect(gateVerbs(thin, true)).toEqual(['fix', 'edit']);
    expect(gateVerbs(thin, false)).toEqual([]);
    expect(exportOptions(thin)).toEqual([]);
    expect(fixNote(thin)).toBe('The walkthrough failed at chapter 2 (02-rounding) at 0:08. Fix what it caught, then it records again.');
  });
  it('a newer take of the same step is another take: an action drawn from this one is not for it', () => {
    // Each variant differs from `r` in exactly ONE thing, so each inequality proves that one guard.
    const rest = [chapter(5, { verdict: null, recorded: false, takes: 0 }), chapter(6, { verdict: null, recorded: false, takes: 0 })];
    const withFourth = (c: WalkthroughChapter, over: Partial<WalkthroughView> = {}) =>
      recordingOf(view({ state: 'failed', chapters: [chapter(1), chapter(2), chapter(3), c, ...rest], ...over }));
    expect(takeFingerprint(withFourth(failed))).toBe(takeFingerprint(r));
    expect(takeFingerprint(withFourth({ ...failed, takes: 3 }))).not.toBe(takeFingerprint(r));
    expect(takeFingerprint(withFourth({ ...failed, failedAtSec: 12 }))).not.toBe(takeFingerprint(r));
    expect(takeFingerprint(withFourth({ ...failed, verdict: 'INCONCLUSIVE' }))).not.toBe(takeFingerprint(r));
    expect(takeFingerprint(withFourth({ ...failed, checks: failed.checks.map((k) => (k.id === 'c4-must' ? { ...k, passed: true } : k)) }))).not.toBe(takeFingerprint(r));
    expect(takeFingerprint(withFourth(failed, { state: 'inconclusive' }))).not.toBe(takeFingerprint(r));
    expect(takeFingerprint(withFourth(failed, { stepId: 'walkthrough_review_2' }))).not.toBe(takeFingerprint(r));
    // What does not make it another take: where the files are, who sat where, the seal.
    expect(takeFingerprint(withFourth(failed, { sealed: false, seat: { evaluator: 'pi', builders: [] } }))).toBe(takeFingerprint(r));
  });
  it('without an author step there is no check to edit', () => {
    const noAuthor = recordingOf(view({ state: 'failed', planStepId: null, chapters: [chapter(1), failed] }));
    expect(gateVerbs(noAuthor, true)).toEqual(['watch', 'fix']);
  });
  it('offers Watch, and the two gate moves only while the escalation gate is open', () => {
    expect(gateVerbs(r, true)).toEqual(['watch', 'fix', 'edit']);
    expect(gateVerbs(r, false)).toEqual(['watch']);
    expect(fixNote(r)).toBe('The walkthrough failed at chapter 4 (Chapter 4) at 0:41. One charge event is emitted — two charge events were emitted The customer is never charged twice Fix what it caught, then it records again.');
  });
});

describe('scenes 21 / 23 — passed, exported', () => {
  const r = recordingOf(view());
  it('passed names the chapter count; the export is what the take wrote: the video, and the poster when there is one', () => {
    expect(stateLine(r)).toEqual({ mark: '✓', text: 'Passed · 6 chapters', tone: 'ok' });
    expect(exportOptions(r)).toEqual([
      { format: 'mp4', label: 'Video', how: 'download', path: 'take/video.mp4' },
      { format: 'poster', label: 'Poster', how: 'download', path: 'take/poster.jpg' },
    ]);
    expect(exportOptions(recordingOf(view({ video: { mp4: 'take/video.mp4', poster: null, markers: [] } }))).map((o) => o.format)).toEqual(['mp4']);
    expect(playheadStart(r)).toBe(0);
    expect(gateVerbs(r, true)).toEqual([]);
  });
  it('never says "checked" on its own (that word is the acceptance read’s)', () => {
    expect(JSON.stringify(stateLine(r)) + seatLine(r)).not.toMatch(/checked/);
  });
});

describe('scene 41 — the demo video in the same editor, without checks', () => {
  const demo: DemoView = {
    runId: 'r-demo', url: 'http://127.0.0.1:4000/', audience: 'the panel', stage: 'done', script: '# Script',
    chapters: [{ key: 'a', title: 'A request arrives', blurb: '', tags: [], resets: [], recorded: true }, { key: 'b', title: 'It ships', blurb: '', tags: [], resets: [], recorded: true }],
    markers: [{ at: '0:00', sec: 0, title: 'A request arrives' }, { at: '1:05', sec: 65, title: 'It ships' }],
    sheets: [], video: { path: 'demo-video/demo.mp4', bytes: 10 }, recording: { readOnly: true },
    review: { verdict: 'accept', findings: [], text: null, rejected: false }, seats: { recorder: 'claude', reviewer: 'codex' }, syntheticLabelled: true,
  };
  const r = recordingOfDemo(demo);
  it('reads as ready to watch, with chapters as seek points and GIF / poster on request', () => {
    expect(r.kind).toBe('demo-video');
    expect(stateLine(r)).toEqual({ mark: '✓', text: 'Ready to watch · 2 chapters', tone: 'ok' });
    expect(seatLine(r)).toBe('codex reviews, claude records');
    expect(chapterMarks(r).map((m) => m.sec)).toEqual([0, 65]);
    expect(exportOptions(r).map((o) => [o.format, o.how])).toEqual([['mp4', 'download'], ['gif', 'request'], ['poster', 'request']]);
    expect(checksTrack(r)).toEqual([]);
    expect(gateVerbs(r, true)).toEqual([]);
    expect(escalationOpen(r, 3, [{ id: 'r-demo:review', ord: 3, denial_reason: 'x' }])).toBe(false);
  });
  it('offers GIF / poster only while the daemon will make them (the review gate, or an ended run)', () => {
    const at = (stage: DemoView['stage']) => exportOptions(recordingOfDemo({ ...demo, stage })).map((o) => o.format);
    expect(at('review_gate')).toEqual(['mp4', 'gif', 'poster']);
    expect(at('failed')).toEqual(['mp4', 'gif', 'poster']);
    expect(at('recording')).toEqual(['mp4']);
    expect(exportOptions(recordingOfDemo({ ...demo, video: null }))).toEqual([]);
  });
});

describe('chapter markers', () => {
  it('two chapters with one title each get their own marker, in take order', () => {
    const chapters = [chapter(1, { title: 'Pay' }), chapter(2, { title: 'Pay' }), chapter(3, { title: 'Receipt' })];
    const markers = [{ at: '0:00', sec: 0, title: 'Pay' }, { at: '0:20', sec: 20, title: 'Pay' }, { at: '0:45', sec: 45, title: 'Receipt' }];
    const r = recordingOf(view({ chapters, video: { mp4: 'take/video.mp4', poster: null, markers } }));
    expect(chapterMarks(r).map((m) => m.sec)).toEqual([0, 20, 45]);
  });
  it('a chapter the take does not hold (never stitched) gets no marker, and the ones after it keep theirs', () => {
    const chapters = [chapter(1, { title: 'Cart' }), chapter(2, { title: 'Pay', verdict: 'FAIL', failedAtSec: 7 }), chapter(3, { title: 'Receipt' })];
    const markers = [{ at: '0:00', sec: 0, title: 'Cart' }, { at: '0:12', sec: 12, title: 'Receipt' }];
    const r = recordingOf(view({ state: 'failed', chapters, video: { mp4: 'take/video.mp4', poster: null, markers } }));
    expect(chapterMarks(r).map((m) => m.sec)).toEqual([0, null, 12]);
    // The failing chapter has no place in the take: its 7 s are its own, said as such — never read as
    // the take's 0:07 (that is Cart). Watch does not seek there and no mark is drawn there.
    expect(stateLine(r).text).toBe('Failed at 0:07 into chapter 2');
    expect(failedChapter(r)?.failedAbsSec).toBeNull();
    expect(playheadStart(r)).toBe(0);
    expect(checksTrack(r).filter((k) => k.chapter.index === 2).every((k) => k.atAbsSec === null)).toBe(true);
    expect(checksTrack(r).filter((k) => k.chapter.index === 3).map((k) => k.atAbsSec)).toEqual([15, 21]);
    expect(fixNote(r)).toContain('chapter 2 (Pay), 0:07 into it.');
  });
  it('a title mismatch is read by position only when every chapter has a row', () => {
    const chapters = [chapter(1, { title: 'One' }), chapter(2, { title: 'Two' })];
    const renamed = [{ at: '0:00', sec: 0, title: 'Intro' }, { at: '0:30', sec: 30, title: 'Outro' }];
    expect(chapterMarks(recordingOf(view({ chapters, video: { mp4: 'v.mp4', poster: null, markers: renamed } }))).map((m) => m.sec)).toEqual([0, 30]);
    expect(chapterMarks(recordingOf(view({ chapters, video: { mp4: 'v.mp4', poster: null, markers: renamed.slice(0, 1) } }))).map((m) => m.sec)).toEqual([null, null]);
  });
  it('never mixes the two readings: a marker is not used twice, and a marker with a chapter’s title is that chapter’s', () => {
    // One title has a row: every chapter is read by title (A is at 0:00); the chapter with no row has
    // no place. Never X by position AND A by title (both 0), and never B read as X because the counts agree.
    const chapters = [chapter(1, { title: 'X' }), chapter(2, { title: 'A' })];
    const markers = [{ at: '0:00', sec: 0, title: 'A' }, { at: '0:30', sec: 30, title: 'B' }];
    expect(chapterMarks(recordingOf(view({ chapters, video: { mp4: 'v.mp4', poster: null, markers } }))).map((m) => m.sec)).toEqual([null, 0]);
  });
  it('with the counts equal, a chapter whose title no marker carries still has no place in the take (codex r7)', () => {
    // Cart, Pay, Receipt against markers Cart, Ads, Receipt: Ads is not Pay. Pay's 7 s stay its own —
    // no absolute seek, no fail mark at Ads' 0:05 + 7.
    const chapters = [chapter(1, { title: 'Cart' }), chapter(2, { title: 'Pay', verdict: 'FAIL', failedAtSec: 7 }), chapter(3, { title: 'Receipt' })];
    const markers = [{ at: '0:00', sec: 0, title: 'Cart' }, { at: '0:05', sec: 5, title: 'Ads' }, { at: '0:12', sec: 12, title: 'Receipt' }];
    const r = recordingOf(view({ state: 'failed', chapters, video: { mp4: 'take/video.mp4', poster: null, markers } }));
    expect(chapterMarks(r).map((m) => m.sec)).toEqual([0, null, 12]);
    expect(failedChapter(r)?.failedAbsSec).toBeNull();
    expect(stateLine(r).text).toBe('Failed at 0:07 into chapter 2');
    expect(playheadStart(r)).toBe(0);
    expect(checksTrack(r).filter((k) => k.chapter.index === 2).every((k) => k.atAbsSec === null)).toBe(true);
  });
});

describe('fmtTime', () => {
  it('reads minutes and seconds', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(41)).toBe('0:41');
    expect(fmtTime(131.4)).toBe('2:11');
  });
});
