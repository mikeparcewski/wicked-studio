import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';
import { clearSteerPrefill, setSteerPrefill } from '../src/store/steerPrefill.js';

/**
 * DES-PM-001 §6.1 (mockup screen 6): the launch composer starts a job from an issue of the tracker set of its project and
 * repo. NC1: on a crew without tracker links there is no "From an issue", and the linked-issues preview never carries
 * `projectId` (an older crew's strict preview schema would refuse it).
 */
const ISSUES = { trackers: [{ trackerId: 'trk_bill', source: 'acme-jira', system: 'jira', key: 'BILL', label: 'Billing', via: { kind: 'project' }, issues: [{ key: 'BILL-142', title: 'Proration rounds annual plans down', state: 'In progress' }] }] };

beforeEach(() => {
  vi.restoreAllMocks();
  takeRetryPrefill();
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: { linkedIssuesExclude: true } } as never);
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [{ id: 'proj_billing', name: 'Billing', description: null, status: 'active', scope: 'project:proj_billing', created_at: 0, updated_at: 0 }] } as never);
  vi.spyOn(client.api, 'previewLinkedIssues').mockResolvedValue({ issues: [], appendedChars: 0 });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (String(url).includes('/tracker-links/issues') ? new Response(JSON.stringify(ISSUES), { status: 200 }) : new Response('{}', { status: 404 })));
  localStorage.clear();
  setRetryPrefill({
    retryOf: null, chatId: null, problem: 'fix the rounding', clis: ['claude'], workflowId: 'chat', repoRef: null, entityMode: 'shared',
    humanConfirm: { before: 1 }, projectId: 'proj_billing',
  });
});
afterEach(() => { cleanup(); clearSteerPrefill(); useCapabilities.setState({ trackerLinks: false }); });

describe('start a job from an issue', () => {
  it('NC1: without tracker links, no "From an issue" and no projectId on the preview', async () => {
    useCapabilities.setState({ loaded: true, trackerLinks: false });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="feature" />);
    await waitFor(() => expect(client.api.previewLinkedIssues).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByTestId('launch-from-issue')).toBeNull();
    expect(vi.mocked(client.api.previewLinkedIssues).mock.calls.every((c) => !('projectId' in c[0]))).toBe(true);
  });

  it('with them: the picker lists the set’s issues, a pick writes the ref into the intent, and the preview resolves in the project', async () => {
    useCapabilities.setState({ loaded: true, trackerLinks: true });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="feature" />);
    await waitFor(() => expect(vi.mocked(client.api.previewLinkedIssues).mock.calls.at(-1)?.[0]).toMatchObject({ projectId: 'proj_billing' }), { timeout: 3000 });
    await user.click(screen.getByTestId('launch-from-issue'));
    const issue = await screen.findByTestId('issue-picker-issue');
    expect(String(vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).includes('/tracker-links/issues'))![0])).toContain('project=proj_billing');
    await user.click(issue);
    expect(screen.getByTestId('launch-problem')).toHaveValue('fix the rounding (BILL-142)');
    expect(screen.queryByTestId('issue-picker')).toBeNull();
  });

  it('an ambiguous key picked in the linked-issues line is qualified in the intent and in the operator guidance', async () => {
    useCapabilities.setState({ loaded: true, trackerLinks: true });
    vi.mocked(client.api.previewLinkedIssues).mockImplementation(async (b) => ({
      issues: /PROJ-1\b/.test(b.problem) && !/:PROJ-1/.test(b.problem) ? [{ ref: 'PROJ-1', resolved: false, code: 'ambiguous', candidates: [{ source: 'jira-a', tenant: 'c1', key: 'PROJ', trackerId: 't1' }, { source: 'jira-b', tenant: 'c2', key: 'PROJ', trackerId: 't2' }] } as never] : [],
      appendedChars: 0,
    }));
    setRetryPrefill({ retryOf: null, chatId: null, problem: 'fix PROJ-1 please', clis: ['claude'], workflowId: 'chat', repoRef: null, entityMode: 'shared', humanConfirm: { before: 1 }, projectId: 'proj_billing' });
    setSteerPrefill({ steer: 'and see PROJ-1 before you start', projectId: 'proj_billing' });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="feature" />);
    const picks = await screen.findAllByTestId('launch-linked-issue-qualify', {}, { timeout: 3000 });
    await user.click(picks[1]!);
    expect(screen.getByTestId('launch-problem')).toHaveValue('fix jira-b:PROJ-1 please');
    expect(screen.getByTestId('steer-prefill')).toHaveValue('and see jira-b:PROJ-1 before you start');
  });
});
