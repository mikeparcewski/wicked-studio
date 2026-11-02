// Voice mode's pure parts (DES-VOICE): what words mean, the WAV studio sends, the pause detector, and the
// dashboard's widget plugins (slot parser, field paths, layout moves, the metric-widget builder).

import { describe, expect, it } from 'vitest';
import { isLeave, matchJob, parseConfirm, parseEntry, parseGateAnswer, parseMode, parseSteer } from '../src/voice/intent.js';
import { chunksToWav, encodeWav, resample, rms } from '../src/voice/wav.js';
import { Vad } from '../src/voice/vad.js';
import {
  BUILTIN_WIDGETS, DEFAULT_LAYOUT, addWidgets, dashboardWidgets, makeMetricWidget, metricFields, moveWidget, readMetric,
  removeWidget, sides, userWidgetId, voicePanelOf,
} from '../src/voice/widgets.js';

describe('voice: what the words mean', () => {
  it('the modal hears yes, no, and a question about voice (answered, privacy first)', () => {
    expect(parseEntry('Yes please')).toEqual({ kind: 'yes' });
    expect(parseEntry('okay')).toEqual({ kind: 'yes' });
    expect(parseEntry('no thanks')).toEqual({ kind: 'no' });
    expect(parseEntry('not now')).toEqual({ kind: 'no' });
    const q = parseEntry('What happens to my voice? Is it recorded?');
    expect(q.kind).toBe('question');
    expect(q.kind === 'question' && q.answer).toMatch(/Nothing is recorded or sent anywhere/);
    expect(parseEntry('banana')).toEqual({ kind: 'unclear' });
  });

  it('the listening mode, leaving, and an on-screen confirm said aloud', () => {
    expect(parseMode('space bar please')).toBe('space');
    expect(parseMode('hold to talk')).toBe('space');
    expect(parseMode('streaming')).toBe('stream');
    expect(parseMode('whatever')).toBeNull();
    expect(isLeave('stop listening')).toBe(true);
    expect(isLeave('leave voice mode')).toBe(true);
    expect(isLeave('what is listening on port 80')).toBe(false);
    expect(parseConfirm('confirm')).toBe('confirm');
    expect(parseConfirm('not that')).toBe('cancel');
    expect(parseConfirm('hmm')).toBeNull();
  });

  it('a decision answer is matched to the dock’s own moves; a negation answers nothing', () => {
    expect(parseGateAnswer('approve it and ship it')).toEqual({ action: 'approve' });
    expect(parseGateAnswer('looks good, go ahead')).toEqual({ action: 'approve' });
    expect(parseGateAnswer('send it back with a note to add tests')).toEqual({ action: 'request_changes', note: 'to add tests' });
    expect(parseGateAnswer('send it back')).toEqual({ action: 'request_changes', note: '' });
    expect(parseGateAnswer('reject it')).toEqual({ action: 'reject' });
    expect(parseGateAnswer("don't ship it")).toBeNull();
    expect(parseGateAnswer('what is running?')).toBeNull();
  });

  it('a steer names a job and a note; the job is matched by its title words, never guessed on a tie', () => {
    expect(parseSteer('tell the dark mode job to use CSS variables')).toEqual({ job: 'dark mode', message: 'Use CSS variables' });
    expect(parseSteer('tell it to stop after the tests')).toEqual({ job: '', message: 'Stop after the tests' });
    expect(parseSteer('what is running')).toBeNull();
    const jobs = [{ title: 'Dark mode for settings' }, { title: 'Retry failed webhook sends' }];
    expect(matchJob('dark mode', jobs)?.title).toBe('Dark mode for settings');
    expect(matchJob('webhook retries', jobs)?.title).toBe('Retry failed webhook sends');
    expect(matchJob('', jobs)).toBeNull();
    expect(matchJob('', [jobs[0]!])?.title).toBe('Dark mode for settings');
    expect(matchJob('payments', jobs)).toBeNull();
  });
});

describe('voice: the WAV studio sends, and the pause detector', () => {
  it('encodes 16 kHz mono 16-bit PCM with a correct header', () => {
    const buf = encodeWav(new Float32Array([0, 0.5, -0.5, 1]));
    const v = new DataView(buf);
    const text = (at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 1, 16000, 16, 8]);
    expect(v.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(v.getInt16(50, true)).toBe(0x7fff);
  });

  it('resamples 48 kHz to 16 kHz (a third of the samples) and joins chunks into one blob', () => {
    expect(resample(new Float32Array(4800), 48000).length).toBe(1600);
    const blob = chunksToWav([new Float32Array(2400), new Float32Array(2400)], 48000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 1600 * 2);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('a turn starts after sustained speech and ends after a pause; a click is not a turn', () => {
    const vad = new Vad({ threshold: 0.02, startMs: 100, endMs: 500 });
    expect(vad.feed(0.3, 0)).toBeNull();
    expect(vad.feed(0.001, 50)).toBeNull(); // a click
    expect(vad.feed(0.2, 100)).toBeNull();
    expect(vad.feed(0.2, 220)).toBe('start');
    expect(vad.feed(0.001, 300)).toBeNull();
    expect(vad.feed(0.2, 400)).toBeNull(); // still talking
    expect(vad.feed(0.001, 500)).toBeNull();
    expect(vad.feed(0.001, 1000)).toBe('end');
    expect(vad.active).toBe(false);
  });
});

describe('voice: dashboard widgets are plugins in the voice-dashboard slot', () => {
  const user = makeMetricWidget({ title: 'Disk free', source: 'system', path: 'infra[key=disk].details.freeBytes', display: 'chart', unit: 'B', taken: [] });

  it('the builder makes a declarative user plugin with one voice-dashboard section', () => {
    expect(user).toMatchObject({ id: 'user.disk-free', version: 1, kind: 'metric', panels: [{ slot: 'voice-dashboard', id: 'main', title: 'Disk free' }], metric: { source: 'system', display: 'chart', unit: 'B' } });
    expect(voicePanelOf(user.panels)).toEqual({ slot: 'voice-dashboard', id: 'main', title: 'Disk free', order: 70 });
    expect(userWidgetId('Disk free', ['user.disk-free'])).toBe('user.disk-free-2');
    // The slot parser keeps the run-panel rules: other slots, bad ids, markup titles are dropped.
    expect(voicePanelOf([{ slot: 'run.details', id: 'x', title: 'X', order: 1 }])).toBeNull();
    expect(voicePanelOf([{ slot: 'voice-dashboard', id: 'Bad Id', title: 'X', order: 1 }])).toBeNull();
    expect(voicePanelOf([{ slot: 'voice-dashboard', id: 'ok', title: '<b>', order: 1 }])).toBeNull();
  });

  it('reads a field path: keyed rows, lengths, numbers as strings; nothing else', () => {
    const doc = { infra: [{ key: 'load', details: { load1: 31.5 } }, { key: 'disk', details: { freeBytes: '9000' } }], runs: [1, 2, 3], toReview: 4, flag: true, name: 'x' };
    expect(readMetric(doc, 'infra[key=load].details.load1')).toBe(31.5);
    expect(readMetric(doc, 'infra[key=disk].details.freeBytes')).toBe(9000);
    expect(readMetric(doc, 'runs.length')).toBe(3);
    expect(readMetric(doc, 'toReview')).toBe(4);
    expect(readMetric(doc, 'flag')).toBe(1);
    expect(readMetric(doc, 'name')).toBeNull();
    expect(readMetric(doc, 'infra[key=nope].details.load1')).toBeNull();
    expect(readMetric(doc, 'constructor.name')).toBeNull();
    expect(readMetric(doc, 'a; drop')).toBeNull();
    const fields = metricFields(doc).map((f) => f.path);
    expect(fields).toEqual(expect.arrayContaining(['infra.length', 'infra[key=load].details.load1', 'runs.length', 'toReview']));
  });

  it('nothing saved = the six built-ins; add, remove and move keep the person’s order', () => {
    expect(dashboardWidgets(null, []).map((w) => w.id)).toEqual(BUILTIN_WIDGETS.map((w) => w.id));
    const layout = addWidgets(null, [user.id, 'builtin.load']);
    expect(layout).toEqual([...DEFAULT_LAYOUT, user.id]);
    const ws = dashboardWidgets(removeWidget(layout, 'builtin.spend'), [user]);
    expect(ws.map((w) => w.id)).not.toContain('builtin.spend');
    expect(ws.at(-1)).toMatchObject({ kind: 'user', id: user.id, title: 'Disk free' });
    expect(moveWidget(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(dashboardWidgets(['user.ghost', 'builtin.gates'], []).map((w) => w.id)).toEqual(['builtin.gates']);
    const { left, right } = sides(dashboardWidgets(layout, [user]));
    expect(left.filter((w) => w.kind === 'builtin').map((w) => w.id)).toEqual(['builtin.load', 'builtin.health', 'builtin.helpers']);
    expect(right.map((w) => w.id)).toContain('builtin.gates');
    expect([...left, ...right].map((w) => w.id)).toContain(user.id);
  });
});
