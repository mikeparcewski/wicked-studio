/**
 * "Don't show this again — start in chat" (operator 2026-10-16, DES-CHAT-FIRST-001 C5): New job's
 * picker can be skipped for chat. The preference lives in `studio.composer.startInChat`; one
 * predicate in `openLaunchWizard` routes only a generic New job, and Settings → View turns it back.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDef } from '../src/api/types.js';
import * as client from '../src/api/client.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { SystemSettings } from '../src/components/SystemSettings.js';
import { useAskDock } from '../src/store/askDock.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { DEMO_VIDEO_ID, isGenericNewJob, openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

const WF = [{ id: 'feature', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];

beforeEach(() => {
  resetLaunchWizard();
  useAskDock.setState({ request: null });
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  vi.spyOn(client.api, 'putComposerSettings').mockImplementation((prefs) =>
    Promise.resolve({ settings: { 'studio.composer': prefs } }),
  );
  clearCachedWorkflows();
  setCachedWorkflows(WF);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('which opens follow "start in chat"', () => {
  it('only a generic New job: no job named, no picks, not from a composer', () => {
    expect(isGenericNewJob({})).toBe(true);
    expect(isGenericNewJob({ projectId: 'p1', intent: 'x' })).toBe(true);
    expect(isGenericNewJob({ workflowId: 'learn' })).toBe(false);
    expect(isGenericNewJob({ workflowId: DEMO_VIDEO_ID })).toBe(false);
    expect(isGenericNewJob({ requirements: [] })).toBe(false);
    expect(isGenericNewJob({ composerKey: 'desk' })).toBe(false);
  });

  it('with the preference on, New job opens a fresh chat in its project with its words; a named job still opens the wizard', () => {
    useComposerPrefsStore.setState({ prefs: { ...DEFAULT_COMPOSER_PREFS, startInChat: true } });
    openLaunchWizard({ projectId: 'p1', intent: 'tidy the README' });
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(useAskDock.getState().request).toMatchObject({ fresh: true, projectId: 'p1', seedText: 'tidy the README' });

    openLaunchWizard({ workflowId: 'learn' });
    expect(useLaunchWizard.getState().open).toBe(true);
  });

  it('with the preference off (the default), New job opens the picker as before', () => {
    openLaunchWizard({});
    expect(useLaunchWizard.getState().open).toBe(true);
    expect(useAskDock.getState().request).toBeNull();
  });
});

describe('the picker\'s checkbox', () => {
  it('ticking it saves the preference, closes the picker and opens chat with what was typed, and says how to undo it', async () => {
    vi.useFakeTimers();
    try {
      render(<LaunchWizard navigate={() => {}} />);
      act(() => { openLaunchWizard({ projectId: 'p1', intent: 'add a CSV export' }); });
      const skip = screen.getByTestId('launch-wizard-skip');
      expect(skip).toHaveTextContent('Don’t show this again — start in chat');
      expect(skip).toHaveTextContent('You can turn New job back on in Settings → View.');

      await act(async () => {
        fireEvent.click(screen.getByTestId('launch-wizard-skip-toggle'));
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(useComposerPrefsStore.getState().prefs.startInChat).toBe(true);
      expect(client.api.putComposerSettings).toHaveBeenCalledWith({ deliverPr: true, startInChat: true });
      expect(useLaunchWizard.getState().open).toBe(false);
      expect(useAskDock.getState().request).toMatchObject({ fresh: true, projectId: 'p1', seedText: 'add a CSV export' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Settings → View', () => {
  it('"Show New job" is on by default; turning it off sets startInChat, turning it on clears it', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
      vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
      render(<SystemSettings />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const toggle = screen.getByTestId('show-new-job-toggle');
      expect(toggle).toBeChecked();

      await act(async () => { fireEvent.click(toggle); await vi.advanceTimersByTimeAsync(400); });
      expect(useComposerPrefsStore.getState().prefs.startInChat).toBe(true);
      expect(screen.getByTestId('show-new-job-toggle')).not.toBeChecked();

      await act(async () => { fireEvent.click(screen.getByTestId('show-new-job-toggle')); await vi.advanceTimersByTimeAsync(400); });
      expect(useComposerPrefsStore.getState().prefs.startInChat).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a daemon that drops the field says so instead of showing it saved', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
      vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
      vi.mocked(client.api.putComposerSettings).mockImplementation(() =>
        Promise.resolve({ settings: { 'studio.composer': { deliverPr: true } } }),
      );
      render(<SystemSettings />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { fireEvent.click(screen.getByTestId('show-new-job-toggle')); await vi.advanceTimersByTimeAsync(400); });
      expect(screen.getByTestId('show-new-job-unsaved')).toHaveTextContent('applies to this session only');
    } finally {
      vi.useRealTimers();
    }
  });
});
