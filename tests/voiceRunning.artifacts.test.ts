import { describe, expect, it } from 'vitest';
import { isRunningJob, stepWords } from '../src/voice/widgets.js';

// artifact-runs-fix (rig voice shot): Running jobs listed 13 chats parked at their turn, by raw unit id, with titles cut
// to "W.", while the narration said "no jobs running". One predicate for both; the step said in words or not at all.
describe('voice: running jobs', () => {
  it('running = working, quiet or stalled; a run waiting on you or held is not running', () => {
    expect(['working', 'quiet', 'stalled', 'waiting_on_you', 'held'].filter((l) => isRunningJob({ liveness: l }))).toEqual(['working', 'quiet', 'stalled']);
  });
  it('the engine’s synthetic step id is no word for a person', () => {
    expect(stepWords('wf-b87f42fb-5fb7-4729-84a5-aa195c929dc4:unit-1')).toBeNull();
    expect(stepWords('wf-68c26704:unit-1:a1')).toBeNull();
    expect(stepWords('answer 1')).toBe('answer 1');
    expect(stepWords(null)).toBeNull();
  });
});
