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
import { DEFAULT_COMPOSER_PREFS, resetComposerPrefsPersistence, useComposerPrefsStore } from '../src/store/composerPrefs.js';
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
  it('only a generic New job: no job named and no picks (the Desk buttons pass composerKey "desk")', () => {
    expect(isGenericNewJob({})).toBe(true);
    expect(isGenericNewJob({ composerKey: 'desk' })).toBe(true); // Desk/DeskV2 New job, Start a job
    expect(isGenericNewJob({ projectId: 'p1', composerKey: 'desk' })).toBe(true); // the rail, ⌘K
    expect(isGenericNewJob({ projectId: 'p1', workflowId: null, composerKey: 'desk' })).toBe(true); // a project's New job
    expect(isGenericNewJob({ workflowId: 'learn' })).toBe(false);
    expect(isGenericNewJob({ workflowId: DEMO_VIDEO_ID, composerKey: 'desk' })).toBe(false);
    expect(isGenericNewJob({ workflowId: 'feature', composerKey: 's1', intent: 'x' })).toBe(false); // a composer's /workflow-…
    expect(isGenericNewJob({ workflowId: 'draft-epics', requirements: [] })).toBe(false);
  });

  it('with the preference on, New job opens a fresh chat in its project with its words; a named job still opens the wizard', () => {
    useComposerPrefsStore.setState({ prefs: { ...DEFAULT_COMPOSER_PREFS, startInChat: true } });
    openLaunchWizard({ projectId: 'p1', intent: 'tidy the README', composerKey: 'desk' });
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(useAskDock.getState().request).toMatchObject({ fresh: true, projectId: 'p1', seedText: 'tidy the README' });

    openLaunchWizard({ workflowId: 'learn' });
    expect(useLaunchWizard.getState().open).toBe(true);
  });

  it('a New job clicked before the settings read lands follows the SAVED choice, not the default', async () => {
    resetComposerPrefsPersistence();
    useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: false });
    let answer: (v: { settings: Record<string, unknown> }) => void = () => {};
    vi.spyOn(client.api, 'getAppearanceSettings').mockReturnValue(new Promise((r) => { answer = r as typeof answer; }) as ReturnType<typeof client.api.getAppearanceSettings>);
    const loading = useComposerPrefsStore.getState().load();
    openLaunchWizard({ composerKey: 'desk' });
    expect(useLaunchWizard.getState().open).toBe(false); // not decided on the default
    answer({ settings: { 'studio.composer': { deliverPr: true, startInChat: true } } });
    await loading;
    await Promise.resolve();
    expect(useLaunchWizard.getState().open).toBe(false);
    expect(useAskDock.getState().request).toMatchObject({ fresh: true });
  });

  it('a New job waiting on the settings read gives way to a job opened meanwhile', async () => {
    resetComposerPrefsPersistence();
    useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: false });
    let answer: (v: { settings: Record<string, unknown> }) => void = () => {};
    vi.spyOn(client.api, 'getAppearanceSettings').mockReturnValue(new Promise((r) => { answer = r as typeof answer; }) as ReturnType<typeof client.api.getAppearanceSettings>);
    const loading = useComposerPrefsStore.getState().load();
    openLaunchWizard({ composerKey: 'desk' });
    openLaunchWizard({ workflowId: 'learn' });
    answer({ settings: { 'studio.composer': { deliverPr: true, startInChat: true } } });
    await loading;
    await Promise.resolve();
    expect(useLaunchWizard.getState().draft?.workflowId).toBe('learn');
    expect(useAskDock.getState().request).toBeNull();
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
      expect(screen.queryByTestId('launch-wizard')).toBeNull();
      expect(useLaunchWizard.getState().open).toBe(false);
      expect(useAskDock.getState().request).toMatchObject({ fresh: true, projectId: 'p1', seedText: 'add a CSV export' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the picker\'s checkbox, opened by a named job', () => {
  it('shows the saved choice ticked, and unticking turns New job back on without leaving the picker', () => {
    useComposerPrefsStore.setState({ prefs: { ...DEFAULT_COMPOSER_PREFS, startInChat: true } });
    render(<LaunchWizard navigate={() => {}} />);
    act(() => { openLaunchWizard({}); }); // generic: goes to chat
    expect(screen.queryByTestId('launch-wizard')).toBeNull();
    act(() => { useLaunchWizard.getState().openWith({}); }); // the picker itself, e.g. Change job
    const box = screen.getByTestId('launch-wizard-skip-toggle') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.getAttribute('aria-describedby')).toBe('launch-wizard-skip-note');
    fireEvent.click(box);
    expect(useComposerPrefsStore.getState().prefs.startInChat).toBe(false);
    expect(screen.getByTestId('launch-wizard')).toBeTruthy();
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
