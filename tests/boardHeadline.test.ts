import { describe, it, expect } from 'vitest';
import {
  activeUnit,
  deriveHeadline,
  isLive,
  lastMeaningfulLine,
} from '../src/hooks/useBoardHeadline.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import type { AgentSession, SessionView, WorkUnit } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The board card's narration altitude (DES-MERGE-001 §3.4(b)) — the reduction from
 * the shared delta stream to ONE meaningful line. The banned states of §3.3 are
 * pinned here as assertions, not left to review: no bare "Working…", no subject-less
 * status, no raw dump on a card.
 */

const view = (
  over: Partial<AgentSession> = {},
  units: WorkUnit[] = [makeUnit({ ord: 0, stage: 'recon', description: 'acceptance criteria' })],
): SessionView => makeView({ status: 'executing', unit_ix: 0, ...over }, units);

const logged = (over: Partial<LoggedEvent> & { type: string; seq: number }): LoggedEvent => ({
  ts: 1, detail: '', ...over,
});

describe('lastMeaningfulLine — §3.4(b) rule 2', () => {
  it('takes the LAST non-empty line, trimmed to one line', () => {
    expect(lastMeaningfulLine('planning\nWriting the acceptance criteria for AC-3\n\n'))
      .toBe('Writing the acceptance criteria for AC-3');
  });

  it('drops ANSI colour/cursor escapes', () => {
    expect(lastMeaningfulLine('\u001B[2K\u001B[32mTightening the headline\u001B[0m'))
      .toBe('Tightening the headline');
  });

  it('treats a \\r redraw as a line break and takes the newest segment', () => {
    expect(lastMeaningfulLine('step 1\rstep 2\rReading src/App.tsx')).toBe('Reading src/App.tsx');
  });

  it('skips progress-bar redraws and pure-punctuation lines', () => {
    expect(lastMeaningfulLine('Indexing sources\n████████░░ 80%\n')).toBe('Indexing sources');
    expect(lastMeaningfulLine('Indexing sources\n-------------\n>>> ...')).toBe('Indexing sources');
  });

  it('is null for an empty or noise-only buffer — the card then falls through, never blanks', () => {
    expect(lastMeaningfulLine(undefined)).toBeNull();
    expect(lastMeaningfulLine('')).toBeNull();
    expect(lastMeaningfulLine('\n  \n***\n')).toBeNull();
  });

  it('caps a long line so one chatty chunk cannot widen the fixed-height card', () => {
    const line = lastMeaningfulLine('x'.repeat(400));
    expect(line).not.toBeNull();
    expect(line!.length).toBeLessThanOrEqual(110);
    expect(line!.endsWith('…')).toBe(true);
  });
});

describe('deriveHeadline — §3.4(b) priority order', () => {
  it('uses the delta buffer when it is newer than the last structured status', () => {
    const line = deriveHeadline({
      view: view(),
      text: 'Writing the acceptance criteria for AC-3\n',
      log: [logged({ type: 'unitExecuting', seq: 4, detail: 'executing' })],
      deltaSeq: 9,
    });
    expect(line).toBe('recon — Writing the acceptance criteria for AC-3');
  });

  it('a structured status that arrived AFTER the last delta wins over the scraped text', () => {
    const line = deriveHeadline({
      view: view(),
      text: 'Writing the acceptance criteria for AC-3\n',
      log: [logged({ type: 'awaitingHuman', seq: 12, detail: 'awaiting human: approve the plan?' })],
      deltaSeq: 9,
    });
    expect(line).toBe('recon — awaiting human: approve the plan?');
  });

  it('ignores non-phase frames when looking for the structured status', () => {
    const line = deriveHeadline({
      view: view(),
      text: 'Reading src/App.tsx\n',
      // cliUsage/heartbeat-ish frames are logged but name no phase transition.
      log: [logged({ type: 'cliUsage', seq: 30, detail: '1200 tokens' })],
      deltaSeq: 9,
    });
    expect(line).toBe('recon — Reading src/App.tsx');
  });

  it('falls back to phase + title — never a bare "Working…" (§3.3)', () => {
    const line = deriveHeadline({ view: view(), text: undefined, log: undefined, deltaSeq: -1 });
    expect(line).toBe('recon — acceptance criteria');
    expect(line).not.toMatch(/working/i);
  });

  it('falls back to the run problem when the unit list has not landed yet', () => {
    const line = deriveHeadline({
      view: view({ status: 'planning', problem: 'ship the board' }, []),
      text: undefined,
      log: undefined,
      deltaSeq: -1,
    });
    expect(line).toBe('planning — ship the board');
  });

  it('reads the unit the run is ON, not the first one', () => {
    const v = view({ unit_ix: 1 }, [
      makeUnit({ ord: 0, stage: 'recon', description: 'first' }),
      makeUnit({ ord: 1, stage: 'build', description: 'second' }),
    ]);
    expect(activeUnit(v)?.ord).toBe(1);
    expect(deriveHeadline({ view: v, text: undefined, log: undefined, deltaSeq: -1 }))
      .toBe('build — second');
  });
});

describe('isLive — which runs get a live line', () => {
  it('counts a gated run as in flight (paused, not finished) and terminal runs as not', () => {
    expect(isLive(makeView({ status: 'awaiting_human' }))).toBe(true);
    expect(isLive(makeView({ status: 'executing' }))).toBe(true);
    expect(isLive(makeView({ status: 'completed' }))).toBe(false);
    expect(isLive(makeView({ status: 'failed' }))).toBe(false);
    expect(isLive(makeView({ status: 'cancelled' }))).toBe(false);
  });
});
