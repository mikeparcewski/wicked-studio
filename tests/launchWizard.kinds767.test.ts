import { describe, expect, it } from 'vitest';
import { DEMO_VIDEO_ID, DRAFT_EPICS_ID, freshDraft, withJobKind } from '../src/store/launchWizard.js';

describe('studio#767 — each kind of job keeps its own words', () => {
  it('changing kinds starts the new kind empty and keeps the old kind\'s words for later', () => {
    const demo = { ...withJobKind(freshDraft({}), DEMO_VIDEO_ID), intent: 'Split a bill three ways with a tip' };
    const draft = withJobKind(demo, DRAFT_EPICS_ID);
    expect(draft.workflowId).toBe(DRAFT_EPICS_ID);
    expect(draft.intent).toBe('');
    const typed = { ...draft, intent: 'Group them by checkout step' };
    expect(withJobKind(typed, DEMO_VIDEO_ID).intent).toBe('Split a bill three ways with a tip');
    expect(withJobKind(withJobKind(typed, DEMO_VIDEO_ID), DRAFT_EPICS_ID).intent).toBe('Group them by checkout step');
  });

  it('the first pick keeps the words the opener brought', () => {
    expect(withJobKind(freshDraft({ intent: 'fix the importer' }), 'bug').intent).toBe('fix the importer');
  });

  it('picking the same kind changes nothing; a new kind resets its options', () => {
    const d = { ...withJobKind(freshDraft({}), 'feature'), intent: 'x', reduced: true, skipQe: true, skipQeReason: 'r' };
    expect(withJobKind(d, 'feature')).toBe(d);
    expect(withJobKind(d, 'bug')).toMatchObject({ reduced: false, skipQe: false, skipQeReason: '' });
  });
});
