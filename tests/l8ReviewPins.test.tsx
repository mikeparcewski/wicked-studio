// review-L8-290 MED-1 + MED-2 — the pins the independent review asked for (DES-L8 §7):
//   MED-1  the escalation copy table receives `<cmd>` and the seat from the run's OTHER frames —
//          `gateEvaluated.denial.deniedTool` → the unit's latest `workerToolCallDenied.command` →
//          none; `units[ord].assigned_cli` for `dead_seat` — in the narrator feed AND the timeline rows;
//   MED-2a `RunTimeline` unitDispatched meta: `baseSkill.handed` ABSENT ⇒ no "(not handed)"; `false` ⇒ the suffix;
//   MED-2b `ChatInput` revisesPr gating: `capabilities.revisesPr === true` ⇒ body carries `revisesPr` +
//          `deliver: 'pr'`; the capability absent ⇒ the "cannot revise — upgrade" chip and NO key sent;
//   MED-2c the F-089 shape itself: a BUILD workflow bound with NO repo (`target.kind === 'none'`, not the
//          ambiguous case) ⇒ Send ENABLED and the line "Ready to send" — the two never disagree.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildFeed, escalationLookups, narrate } from '../src/components/narrator.js';
import { timelineRows } from '../src/components/RunTimeline.js';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import type { CoreEvent, LaunchBodyWithDeliver } from '../src/api/types.js';
import { makeUnit } from './factories.js';

const ev = (fields: Record<string, unknown>): CoreEvent => ({ session: 'run-1', ...fields }) as CoreEvent;
const ctx = { phaseOf: (ord: number | null | undefined) => (ord == null ? '?' : `phase-${ord}`) };

describe('MED-1 — <cmd> and the seat reach the copy table from the run\'s other frames', () => {
  const units = [
    makeUnit({ id: 'run-1:fix', ord: 2, stage: 'build', status: 'pending', assigned_cli: 'codex' }),
    makeUnit({ id: 'run-1:review', ord: 3, stage: 'review', status: 'pending', assigned_cli: 'claude' }),
  ];
  const denied = ev({ type: 'workerToolCallDenied', ord: 2, attempt: 0, cli: 'codex', carrier: 'acp', role: 'creator', tool: 'bash', command: 'ls -la /', reason: 'outside', remedy: 'stay in the worktree', ts: 2, seq: 2 });
  const escalated = ev({ type: 'gateEscalated', ord: 2, condition: 'boundary_deny', denialSource: 'input_governance', ts: 3, seq: 3 });

  it('escalationLookups: deniedTool wins over the tool-call denial; the seat comes from the unit, else the frames', () => {
    const l = escalationLookups([denied, escalated], units);
    expect(l.deniedCommandOf(2)).toBe('ls -la /');
    expect(l.seatOf(2)).toBe('codex');
    const withGate = escalationLookups(
      [denied, ev({ type: 'gateEvaluated', ord: 2, denial: { source: 'input_governance', reason: 'r', claimId: null, ruleIds: [], deniedTool: 'rm -rf build', phase: null }, ts: 3, seq: 3 })],
      units,
    );
    expect(withGate.deniedCommandOf(2)).toBe('rm -rf build');
    expect(escalationLookups([ev({ type: 'unitDispatched', ord: 5, attempt: 0, cli: 'pi', ts: 1, seq: 1 })]).seatOf(5)).toBe('pi');
    expect(l.deniedCommandOf(9)).toBeNull();
    expect(l.seatOf(null)).toBeNull();
  });

  it('the narrator FEED renders the refused command; a lone narrate() call without lookups still renders honestly', () => {
    const feed = buildFeed([denied, escalated], units, 2, ctx);
    const line = feed.find((i) => i.kind === 'line' && i.line.event.type === 'gateEscalated');
    expect(line?.kind === 'line' ? line.line.text : '').toBe('Gate approaching — Unit #2: a command was refused by governance: `ls -la /`');
    expect(narrate(escalated, ctx)?.text).toBe('Gate approaching — Unit #2: a command was refused by governance');
  });

  it('dead_seat names the unit\'s seat in the feed and the timeline; without one it says "the seat" (no filler)', () => {
    const dead = ev({ type: 'gateEscalated', ord: 3, condition: 'dead_seat', denialSource: 'dead_seat', ts: 4, seq: 4 });
    const feed = buildFeed([dead], units, 3, ctx);
    const line = feed.find((i) => i.kind === 'line');
    expect(line?.kind === 'line' ? line.line.text : '').toBe('Gate approaching — Unit #3: seat claude is unusable (signed out / not installed) — no eligible seat remains');
    expect(narrate(dead, ctx)?.text).toBe('Gate approaching — Unit #3: the seat is unusable (signed out / not installed) — no eligible seat remains');
    const rows = timelineRows([dead], units);
    expect(rows.find((r) => r.label === 'gate')?.meta).toBe('Unit #3: seat claude is unusable (signed out / not installed) — no eligible seat remains');
  });

  it('the TIMELINE gate row carries the refused command too', () => {
    const rows = timelineRows([denied, escalated], units);
    expect(rows.find((r) => r.label === 'gate')?.meta).toBe('Unit #2: a command was refused by governance: `ls -la /`');
  });
});

describe('MED-2a — unitDispatched meta: discipline named; "(not handed)" ONLY on handed === false', () => {
  const units = [makeUnit({ id: 'run-1:build', ord: 1, stage: 'build', status: 'pending', assigned_cli: 'claude' })];
  const dispatch = (baseSkill: Record<string, unknown> | undefined) =>
    timelineRows([ev({ type: 'unitDispatched', ord: 1, attempt: 0, ...(baseSkill !== undefined ? { baseSkill } : {}), ts: 1, seq: 1 })], units)
      .find((r) => r.label === 'unit 1')?.meta ?? '';

  it('handed ABSENT ⇒ discipline named, no "(not handed)" (absent = unknown, core #479)', () => {
    const meta = dispatch({ name: 'wicked-garden-governed-worker', role: 'creator' });
    expect(meta).toContain('discipline: wicked-garden-governed-worker §creator');
    expect(meta).not.toContain('not handed');
  });
  it('handed === false ⇒ "discipline named only (not handed)"; handed === true ⇒ no suffix; no baseSkill ⇒ no discipline at all', () => {
    expect(dispatch({ name: 'wg', role: 'creator', handed: false })).toContain('discipline: wg §creator · discipline named only (not handed)');
    expect(dispatch({ name: 'wg', role: 'creator', handed: true })).not.toContain('not handed');
    expect(dispatch(undefined)).toBe('claude · attempt 0');
  });
});

describe('MED-2b/2c — ChatInput: revisesPr gating and the F-089 no-repo shape', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    takeRetryPrefill();
    useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({
      roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
    });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
    localStorage.clear();
  });

  function depositRevision(): void {
    setRetryPrefill({
      retryOf: 'r-delivered',
      problem: 'Revise PR #273 — tighten the gate copy\n\nreview: the headline is wrong',
      clis: ['claude'],
      workflowId: 'bug',
      repoRef: 'studio-api',
      entityMode: 'shared',
      humanConfirm: 'none',
      projectId: null,
      revisesPr: { number: 273, title: 'tighten the gate copy', headRef: 'wicked/abc' },
    });
  }

  it('capabilities.revisesPr === true ⇒ the chip names the PR, the body carries revisesPr + deliver:"pr"', async () => {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ capabilities: { deliverGate: true, revisesPr: true } } as Awaited<ReturnType<typeof client.api.getHealth>>);
    depositRevision();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-revises-pr').dataset.supported).toBe('yes'));
    expect(screen.getByTestId('launch-revises-pr').textContent).toContain('Revises PR #273 (wicked/abc)');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchBodyWithDeliver = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect(body.revisesPr).toBe(273);
    expect(body.deliver).toBe('pr');
    expect(body.repoRef).toBe('studio-api');
  });

  it('the capability ABSENT ⇒ the honest "cannot revise — upgrade" chip and NO revisesPr key on the body', async () => {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ capabilities: { deliverGate: true } } as Awaited<ReturnType<typeof client.api.getHealth>>);
    depositRevision();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-revises-pr').dataset.supported).toBe('no'));
    expect(screen.getByTestId('launch-revises-pr').textContent).toContain('this daemon cannot revise a PR');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchBodyWithDeliver = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect('revisesPr' in body).toBe(false);
  });

  it('F-089: a BUILD workflow bound with NO repository attached — Send is ENABLED and the line says "Ready to send" (they never disagree)', async () => {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ capabilities: { deliverGate: true } } as Awaited<ReturnType<typeof client.api.getHealth>>);
    // The F-E2E-035 shape: `target.kind === 'none'` (no repo at all) is NOT the ambiguous case that
    // disables Send — the old prefix keyed on `targetRepoRef === null` and read "Not ready" anyway.
    setRetryPrefill({ retryOf: null, problem: '', clis: ['claude'], workflowId: 'bug', repoRef: null, entityMode: 'shared', humanConfirm: 'none', projectId: null });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('launch-problem'), 'fix the flaky retry test');
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    const line = screen.getByTestId('launch-confirm');
    expect(line.textContent).toMatch(/^Ready to send: /);
    expect(line.textContent).toMatch(/no repository/);
    // and the converse: an empty intent ⇒ Send disabled AND "Not ready" — the two never disagree
    await user.clear(screen.getByTestId('launch-problem'));
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeDisabled());
    expect(screen.getByTestId('launch-confirm').textContent).toMatch(/^Not ready to send: /);
  });
});
