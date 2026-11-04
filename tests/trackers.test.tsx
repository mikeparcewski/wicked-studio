import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { ProjectTrackers } from '../src/components/ProjectTrackers.js';
import { RepoTrackers } from '../src/components/RepoTrackers.js';
import { TrackerSet, trackerSetOf } from '../src/components/trackers/TrackerSet.js';
import { IssuePicker, issueRef, qualifyRef, withIssue } from '../src/components/trackers/IssuePicker.js';
import { trackerLinksOf, trackerRefusal } from '../src/api/trackers.js';
import { LinkedIssuesLine, linkedIssueWords } from '../src/components/LinkedIssuesLine.js';
import { useCapabilities } from '../src/store/capabilities.js';

/**
 * DES-PM-001 PM-1, studio: the Linked trackers cards (project desk, repo page), Link a tracker, a job's tracker set and
 * "From an issue", over a mocked crew wire (pm-crew's `GET/POST/DELETE /tracker-links`, `GET /sources/:name/trackers`,
 * `GET /tracker-links/issues`). The negative controls, each RED without its fix:
 *  - NC1 every surface is hidden (and reads nothing) on a crew without `capabilities.trackerLinks`;
 *  - NC2 Remove sends a DELETE, and the card shows crew's answer afterwards, never an optimistic removal;
 *  - NC3 an agent-kind 403 (`tracker_links_human_only`) reads in plain words, never the raw refusal;
 *  - NC4 the job's tracker set is crew's answer for exactly its project and repo: nothing added, nothing assumed in, and
 *    never a shorter list when an entry can't be read.
 */

type Link = Record<string, unknown>;
const link = (over: Link = {}): Link => ({
  id: 'tl_bill', trackerId: 'trk_bill', source: 'acme-jira', sourceId: 'src-jira', system: 'jira', tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net',
  key: 'BILL', label: 'Billing', target: { kind: 'project', id: 'proj_billing' }, linkedAt: '2026-11-04T10:00:00Z', linkedBy: 'operator', projection: 'current', ...over,
});
const PAY = link({ id: 'tl_pay', trackerId: 'trk_pay', key: 'PAY', label: 'Payments', projection: 'pending' });
const ADO = link({ id: 'tl_ado', trackerId: 'trk_ado', source: 'acme-ado', system: 'ado', tenant: 'acme-ado', tenantLabel: 'acme-ado', key: 'p-1', label: 'Payments Platform' });
const OPS = { ...link({ id: 'tl_ops', trackerId: 'trk_ops', key: 'OPS', label: 'Operations', target: { kind: 'repo', id: 'billing-api' } }), viaRepo: 'billing-api' };

let calls: Array<{ path: string; method: string; body: unknown }> = [];
let routes: Record<string, (body: unknown) => Promise<unknown>> = {};
beforeEach(() => {
  calls = [];
  routes = {};
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const r = routes[`${method} ${path}`];
    if (r !== undefined) return r(body);
    if (path === '/mcp/servers') return Promise.resolve({ servers: [{ name: 'acme-jira', kind: 'mcp-http', pm: { system: 'jira' }, tools: [] }, { name: 'support-pg', kind: 'sql', tools: [] }], discovered: [] });
    return Promise.reject(new ApiError(404, 'not found'));
  });
  useCapabilities.setState({ loaded: true, trackerLinks: true });
});
afterEach(() => { cleanup(); useCapabilities.setState({ trackerLinks: false }); });

const projectAnswer = (links: Link[] = [link(), PAY, ADO], viaRepos: Link[] = [OPS]) => ({
  target: { project: 'proj_billing' }, links, viaRepos, projects: [],
  agents: [{ source: 'acme-jira', see: true, query: true }, { source: 'acme-ado', see: false, query: false }],
});
const deferred = <T,>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
const nav = vi.fn();
const trackerCalls = (): string[] => calls.filter((c) => c.path.startsWith('/tracker-links') || /\/trackers/.test(c.path)).map((c) => `${c.method} ${c.path}`);

describe('NC1: hidden on a crew without tracker links', () => {
  it('the project card, the repo card and a job’s or chat’s set render nothing and read nothing', async () => {
    useCapabilities.setState({ trackerLinks: false });
    const { container } = render(
      <>
        <ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />
        <RepoTrackers repoId="billing-api" repoName="billing-api" navigate={nav} />
        <TrackerSet projectId="proj_billing" projectName="Billing" repoId="billing-api" />
        <TrackerSet projectId="proj_billing" projectName="Billing" repoId={null} kind="chat" />
      </>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
    expect(trackerCalls()).toEqual([]);
  });

  it('the same surfaces show on a crew that has them (the control’s other half)', async () => {
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer();
    routes['GET /tracker-links?repo=billing-api'] = async () => ({ target: { repo: 'billing-api' }, links: [OPS], viaRepos: [], projects: [{ id: 'proj_billing', name: 'Billing' }], agents: [] });
    render(<><ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} /><RepoTrackers repoId="billing-api" repoName="billing-api" navigate={nav} /></>);
    expect(await screen.findAllByTestId('project-tracker')).toHaveLength(3);
    expect(await screen.findAllByTestId('repo-tracker')).toHaveLength(1);
  });
});

describe('the project desk’s Linked trackers (mockup screen 2)', () => {
  it('linked here with Remove, from its repositories read-only, the scope rule, and the Agents-switch warning', async () => {
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer();
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" repoNames={['billing-api', 'billing-web']} navigate={nav} />);
    const rows = await screen.findAllByTestId('project-tracker');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('BILL · Billing'), expect.stringContaining('PAY · Payments'), expect.stringContaining('Payments Platform'),
    ]);
    expect(rows[0]).toHaveTextContent('Jira · acme.atlassian.net');
    expect(screen.getByTestId('project-trackers-count')).toHaveTextContent('3 linked here · 1 from its repository');
    expect(screen.getByTestId('project-trackers-rule')).toHaveTextContent('Jobs and chats in this project see these, plus the trackers linked to its repositories. Nothing else from these tools.');
    // PAY's projection is pending: Understand follows once estate holds it.
    expect(within(rows[1]!).getByTestId('tracker-projection')).toHaveTextContent('Adding to Understand…');
    // ADO: Billing isn't ticked in its Agents box (Q-PM1): the card says so and opens the box.
    expect(within(rows[2]!).getByTestId('tracker-agents-off')).toHaveTextContent('Billing’s agents can’t use acme-ado yet. Open its Agents box');
    expect(within(rows[0]!).queryByTestId('tracker-agents-off')).toBeNull();
    fireEvent.click(within(rows[2]!).getByRole('link', { name: 'Open its Agents box' }));
    expect(nav).toHaveBeenCalledWith('/sources?source=acme-ado');
    const via = screen.getAllByTestId('project-tracker-via');
    expect(via).toHaveLength(1);
    expect(via[0]).toHaveTextContent('OPS · Operations');
    expect(via[0]).toHaveTextContent('through billing-api');
    expect(within(via[0]!).queryByTestId('tracker-remove')).toBeNull();
    expect(within(screen.getByTestId('project-trackers-repos')).getAllByRole('link').map((a) => a.textContent)).toEqual(['billing-api', 'billing-web']);
  });

  it('NC2: Remove sends DELETE and keeps the row until crew’s links say it is gone (never optimistic)', async () => {
    let answer = projectAnswer([link(), PAY], []);
    routes['GET /tracker-links?project=proj_billing'] = async () => answer;
    const del = deferred<unknown>();
    routes['DELETE /tracker-links/tl_bill'] = () => del.promise;
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    const bill = (await screen.findAllByTestId('project-tracker'))[0]!;
    fireEvent.click(within(bill).getByTestId('tracker-remove'));
    // Sent, and still shown while crew answers.
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/tracker-links/tl_bill')).toBe(true));
    expect(within(bill).getByTestId('tracker-remove')).toHaveTextContent('Removing…');
    expect(screen.getAllByTestId('project-tracker')).toHaveLength(2);
    // crew answers 204 but its links still hold BILL: the card shows crew's answer, so BILL stays.
    await act(async () => { del.resolve(undefined); await Promise.resolve(); });
    await waitFor(() => expect(calls.filter((c) => c.path === '/tracker-links?project=proj_billing')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId('project-tracker')[0]).toHaveTextContent('Remove'));
    expect(screen.getAllByTestId('project-tracker').map((r) => r.dataset.key)).toEqual(['BILL', 'PAY']);
    // Removed for real: crew's next answer no longer holds it, and only then does the row go.
    routes['DELETE /tracker-links/tl_bill'] = async () => undefined;
    answer = projectAnswer([PAY], []);
    fireEvent.click(within(screen.getAllByTestId('project-tracker')[0]!).getByTestId('tracker-remove'));
    await waitFor(() => expect(screen.getAllByTestId('project-tracker').map((r) => r.dataset.key)).toEqual(['PAY']));
  });

  it('NC3: an agent-kind 403 reads in plain words (the card read and the picker’s link)', async () => {
    const human = { error: 'tracker links are a person’s only', code: 'tracker_links_human_only' };
    routes['GET /tracker-links?project=proj_billing'] = async () => { throw new ApiError(403, human.error, human); };
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    const failed = await screen.findByTestId('trackers-failed');
    expect(failed).toHaveTextContent('Only a person signed in to studio can see which trackers are linked. A job’s or a plugin’s token can’t, so its request was refused.');
    expect(failed.textContent).not.toContain('the daemon refused this');
    expect(failed.textContent).not.toContain('tracker_links_human_only');
    // The write's refusal, from the picker.
    expect(trackerRefusal(new ApiError(403, human.error, human), 'link')).toBe('Only a person signed in to studio can change which trackers are linked. A job’s or a plugin’s token can’t, so its request was refused. Nothing changed.');
  });

  it('Link a tracker: pick the tool, search live, Link sends exactly the tracker and target, then the card re-reads', async () => {
    let answer = projectAnswer([], []);
    routes['GET /tracker-links?project=proj_billing'] = async () => answer;
    const page = (q: string) => ({
      name: 'acme-jira', next: null,
      trackers: [{ tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net', key: 'SUP', label: 'Support', links: [] }, { tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net', key: 'SUPX', label: 'Support tooling', links: [] }]
        .filter((t) => q === '' || t.key.toLowerCase().startsWith(q)),
    });
    routes['GET /sources/acme-jira/trackers'] = async () => page('');
    routes['GET /sources/acme-jira/trackers?q=supx'] = async () => page('supx');
    routes['POST /tracker-links'] = async () => { answer = projectAnswer([link({ id: 'tl_sup', trackerId: 'trk_sup', key: 'SUP', label: 'Support' })], []); return link(); };
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    await screen.findByTestId('project-trackers-empty');
    fireEvent.click(screen.getByTestId('project-trackers-add'));
    const picker = await screen.findByTestId('tracker-picker');
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option')).toHaveLength(2));
    expect(within(picker).getByTestId('tracker-picker-source')).toHaveValue('acme-jira');
    fireEvent.change(within(picker).getByTestId('tracker-picker-search'), { target: { value: 'supx' } });
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option').map((o) => o.dataset.key)).toEqual(['SUPX']), { timeout: 2000 });
    fireEvent.change(within(picker).getByTestId('tracker-picker-search'), { target: { value: '' } });
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option')).toHaveLength(2));
    fireEvent.click(within(within(picker).getAllByTestId('tracker-picker-option')[0]!).getByTestId('tracker-picker-link'));
    await waitFor(() => expect(screen.queryByTestId('tracker-picker')).toBeNull());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ source: 'acme-jira', tenant: 'cloud-1', key: 'SUP', target: { kind: 'project', id: 'proj_billing' } });
    expect((await screen.findAllByTestId('project-tracker')).map((r) => r.dataset.key)).toEqual(['SUP']);
  });
});

describe('the repository’s Linked trackers (mockup screen 3)', () => {
  it('says the reach before linking: the projects the repo is in, and that project links never travel through it', async () => {
    routes['GET /tracker-links?repo=billing-api'] = async () => ({ target: { repo: 'billing-api' }, links: [OPS], viaRepos: [], projects: [{ id: 'proj_billing', name: 'Billing' }, { id: 'proj_ops', name: 'Ops' }], agents: [] });
    render(<RepoTrackers repoId="billing-api" repoName="billing-api" navigate={nav} />);
    expect(await screen.findByTestId('repo-trackers-reach')).toHaveTextContent('This repository is in 2 projects: Billing and Ops. A tracker linked here reaches jobs and chats in both, and any job that works on this repository.');
    expect(screen.getByTestId('repo-trackers-stay')).toHaveTextContent('Trackers linked to a project stay in that project: they never reach another project through this repository.');
    expect(screen.getAllByTestId('repo-tracker')).toHaveLength(1);
    expect(within(screen.getByTestId('repo-trackers-projects')).getAllByRole('link').map((a) => a.textContent)).toEqual(['Billing', 'Ops']);
  });
});

describe('NC4: the trackers a job can read are crew’s answer, and only crew’s', () => {
  const jobAnswer = (over: Record<string, unknown> = {}) => ({ ...projectAnswer([link(), ADO], [OPS]), target: { project: 'proj_billing', repo: 'billing-api' }, ...over });

  it('reads exactly its project and repo, labels where each came from, and says what is not included', async () => {
    routes['GET /tracker-links?project=proj_billing&repo=billing-api'] = async () => jobAnswer();
    render(<TrackerSet projectId="proj_billing" projectName="Billing" repoId="billing-api" />);
    const items = await screen.findAllByTestId('tracker-set-item');
    expect(trackerCalls()).toEqual(['GET /tracker-links?project=proj_billing&repo=billing-api']);
    expect(items.map((i) => i.dataset.key)).toEqual(['BILL', 'OPS']);
    expect(items[0]).toHaveTextContent('linked to Billing');
    expect(items[1]).toHaveTextContent('through repo billing-api');
    expect(screen.getByTestId('tracker-set-count')).toHaveTextContent('2');
    expect(screen.getByTestId('tracker-set-excluded')).toHaveTextContent('Not included: Payments Platform (acme-ado) is linked to Billing, but agents in Billing can’t use acme-ado yet.');
  });

  it('a source crew says nothing about is not assumed in', () => {
    const r = trackerLinksOf({ ...jobAnswer(), agents: [] }, { project: 'proj_billing', repo: 'billing-api' })!;
    const set = trackerSetOf(r);
    expect(set.included).toEqual([]);
    expect(set.excluded.map((e) => e.link.key)).toEqual(['BILL', 'p-1', 'OPS']);
  });

  it('one entry crew’s shape doesn’t hold makes the whole set unreadable, never a shorter list', async () => {
    routes['GET /tracker-links?project=proj_billing&repo=billing-api'] = async () => jobAnswer({ viaRepos: [OPS, { ...OPS, id: 'tl_x', trackerId: 'trk_x', system: 'notion' }] });
    render(<TrackerSet projectId="proj_billing" projectName="Billing" repoId="billing-api" />);
    expect(await screen.findByTestId('trackers-unreadable')).toBeInTheDocument();
    expect(screen.queryAllByTestId('tracker-set-item')).toEqual([]);
  });

  it('a list crew’s answer must carry, missing, is unreadable (never "none")', () => {
    for (const k of ['agents', 'viaRepos', 'projects', 'links']) {
      const a: Record<string, unknown> = jobAnswer();
      delete a[k];
      expect(trackerLinksOf(a, { project: 'proj_billing', repo: 'billing-api' }), k).toBeNull();
    }
  });

  it('an inherited link must come through the repo it is linked to, and a repo alone inherits nothing', () => {
    expect(trackerLinksOf(jobAnswer({ viaRepos: [{ ...OPS, viaRepo: 'billing-web' }] }), { project: 'proj_billing', repo: 'billing-api' })).toBeNull();
    expect(trackerLinksOf({ target: { repo: 'billing-api' }, links: [OPS], viaRepos: [{ ...OPS, id: 'tl_y' }], projects: [], agents: [] }, { repo: 'billing-api' })).toBeNull();
  });

  it('an answer for another project or repo is not this job’s', () => {
    expect(trackerLinksOf(jobAnswer({ target: { project: 'proj_ops', repo: 'billing-api' } }), { project: 'proj_billing', repo: 'billing-api' })).toBeNull();
    expect(trackerLinksOf(jobAnswer({ target: { project: 'proj_billing' } }), { project: 'proj_billing', repo: 'billing-api' })).toBeNull();
    // A "linked here" entry that points elsewhere is not crew's answer for this project either.
    expect(trackerLinksOf(jobAnswer({ links: [link({ target: { kind: 'project', id: 'proj_ops' } })] }), { project: 'proj_billing', repo: 'billing-api' })).toBeNull();
  });

  it('a job in no project reads its repo’s links and says the every-project rule', async () => {
    routes['GET /tracker-links?repo=billing-api'] = async () => ({ target: { repo: 'billing-api' }, links: [OPS], viaRepos: [], projects: [], agents: [] });
    render(<TrackerSet projectId={null} projectName={null} repoId="billing-api" />);
    expect((await screen.findAllByTestId('tracker-set-item')).map((i) => i.textContent)).toEqual([expect.stringContaining('through repo billing-api')]);
    // crew sends no switch decisions without a project: the card lists what is linked and claims no readable count.
    expect(screen.getByTestId('tracker-set')).toHaveTextContent('Trackers linked to its repository');
    expect(screen.queryByTestId('tracker-set-count')).toBeNull();
    expect(screen.getByTestId('tracker-set')).toHaveTextContent('This job is in no project: agents read these only from tools whose Agents switches allow every project, and crew checks that at every call.');
  });
});

describe('From an issue (mockup screen 6)', () => {
  const issues = {
    trackers: [
      { trackerId: 'trk_bill', source: 'acme-jira', system: 'jira', key: 'BILL', label: 'Billing', via: { kind: 'project' }, issues: [{ key: 'BILL-142', title: 'Proration rounds annual plans down', state: 'In progress' }] },
      { trackerId: 'trk_ops', source: 'acme-jira', system: 'jira', key: 'OPS', label: 'Operations', via: { kind: 'repo', id: 'billing-api' }, issues: [{ key: 'OPS-77', title: 'Nightly invoice job slow', state: 'To do' }] },
      { trackerId: 'trk_api', source: 'acme-github', system: 'github', key: 'acme/billing-api', label: 'billing-api', via: { kind: 'repo', id: 'billing-api' }, issues: [{ key: 'acme/billing-api#212', title: 'Webhook retries double-post refunds', state: 'open' }] },
    ],
  };

  it('lists the set’s issues grouped by tracker, each labelled; picking one hands its ref to the intent', async () => {
    routes['GET /tracker-links/issues?project=proj_billing&repo=billing-api'] = async () => issues;
    const onPick = vi.fn();
    render(<IssuePicker projectId="proj_billing" repoId="billing-api" projectName="Billing" repoName="billing-api" onPick={onPick} onClose={vi.fn()} />);
    const groups = await screen.findAllByTestId('issue-picker-group');
    expect(groups.map((g) => g.dataset.tracker)).toEqual(['trk_bill', 'trk_ops', 'trk_api']);
    expect(groups[0]).toHaveTextContent('BILL · Billing');
    expect(groups[0]).toHaveTextContent('linked to Billing');
    expect(groups[1]).toHaveTextContent('through repo billing-api');
    fireEvent.click(within(groups[0]!).getByTestId('issue-picker-issue'));
    expect(onPick).toHaveBeenCalledWith('BILL-142', { key: 'BILL-142', title: 'Proration rounds annual plans down', state: 'In progress' });
    expect(screen.getByTestId('issue-picker')).toHaveTextContent('Issues from the 3 trackers a job in Billing on billing-api can read.');
  });

  it('a key two linked trackers share (two Jira sites) is written source-qualified', () => {
    const a = { ...issues.trackers[0]!, trackerId: 'trk_a', source: 'jira-one', system: 'jira' as const, via: { kind: 'project' as const } };
    const b = { ...a, trackerId: 'trk_b', source: 'jira-two' };
    expect(issueRef(a, { key: 'BILL-1', title: 't', state: null }, [a, b])).toBe('jira-one:BILL-1');
    expect(issueRef(a, { key: 'BILL-1', title: 't', state: null }, [a])).toBe('BILL-1');
    // Two sites behind ONE source: the site names it (crew's `<source>@<cloudId>:KEY-N`), or the bare key when crew sent no site.
    const s1 = { ...a, trackerId: 'trk_s1', source: 'jira-one', tenant: 'cloud-1' };
    const s2 = { ...a, trackerId: 'trk_s2', source: 'jira-one', tenant: 'cloud-2' };
    expect(issueRef(s2, { key: 'BILL-1', title: 't', state: null }, [s1, s2])).toBe('jira-one@cloud-2:BILL-1');
    const noSite = { trackerId: s2.trackerId, source: s2.source, system: s2.system, key: s2.key, label: s2.label, via: s2.via, issues: s2.issues };
    expect(issueRef(noSite, { key: 'BILL-1', title: 't', state: null }, [s1, s2])).toBe('BILL-1');
    expect(qualifyRef('Fix PROJ-1 and see PROJ-12, not x:PROJ-1', 'PROJ-1', 'jira-two:PROJ-1')).toBe('Fix jira-two:PROJ-1 and see PROJ-12, not x:PROJ-1');
    expect(withIssue('', 'BILL-142', 'Proration')).toBe('BILL-142: Proration');
    expect(withIssue('Fix the rounding', 'BILL-142', 'Proration')).toBe('Fix the rounding (BILL-142)');
    // A whole ref, not a substring: BILL-1 is not in BILL-142, #4 not in #42.
    expect(withIssue('Fix BILL-142', 'BILL-1', 't')).toBe('Fix BILL-142 (BILL-1)');
    expect(withIssue('Fix BILL-1 now', 'BILL-1', 't')).toBe('Fix BILL-1 now');
    expect(withIssue('See #42', '#4', 't')).toBe('See #42 (#4)');
  });
});

describe('the linked-issues line through the tracker set (DES-PM-001 §3.2)', () => {
  it('says why a ref was not read, and an ambiguous key is picked into its qualified form', () => {
    expect(linkedIssueWords({ ref: '#42', resolved: false, code: 'not_linked' } as never)).toBe('#42 — not read: not in a tracker linked to this project or its repositories');
    const onQualify = vi.fn();
    const issue = { ref: 'PROJ-1', resolved: false, code: 'ambiguous', candidates: [
      { source: 'jira-one', tenant: 'cloud-1', tenantLabel: 'one.atlassian.net', key: 'PROJ', trackerId: 't1' },
      { source: 'jira-one', tenant: 'cloud-2', tenantLabel: 'two.atlassian.net', key: 'PROJ', trackerId: 't2' },
      { source: 'jira-b', tenant: 'cloud-3', key: 'PROJ', trackerId: 't3' },
    ] };
    render(<LinkedIssuesLine preview={{ issues: [issue as never], appendedChars: 0 }} exclude={[]} onToggle={vi.fn()} onQualify={onQualify} />);
    const picks = screen.getAllByTestId('launch-linked-issue-qualify');
    expect(picks.map((b) => b.textContent)).toEqual(['jira-one · one.atlassian.net', 'jira-one · two.atlassian.net', 'jira-b']);
    fireEvent.click(picks[1]!);
    fireEvent.click(picks[2]!);
    expect(onQualify.mock.calls).toEqual([['PROJ-1', 'jira-one@cloud-2:PROJ-1'], ['PROJ-1', 'jira-b:PROJ-1']]);
    cleanup();
    // A ref already source-qualified is re-qualified from its bare key, never prefixed twice.
    const again = vi.fn();
    render(<LinkedIssuesLine preview={{ issues: [{ ...issue, ref: 'jira-one:PROJ-1' } as never], appendedChars: 0 }} exclude={[]} onToggle={vi.fn()} onQualify={again} />);
    fireEvent.click(screen.getAllByTestId('launch-linked-issue-qualify')[1]!);
    expect(again.mock.calls).toEqual([['jira-one:PROJ-1', 'jira-one@cloud-2:PROJ-1']]);
  });
});

describe('review r1 folds', () => {
  it('an inherited tracker whose tool keeps the project out says so too', async () => {
    const adoVia = { ...link({ id: 'tl_av', trackerId: 'trk_av', source: 'acme-ado', system: 'ado', tenant: 'acme-ado', key: 'pp', label: 'Payments Platform', target: { kind: 'repo', id: 'billing-api' } }), viaRepo: 'billing-api' };
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer([link()], [adoVia]);
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    const via = await screen.findByTestId('project-tracker-via');
    expect(within(via).getByTestId('tracker-agents-off')).toHaveTextContent('Billing’s agents can’t use acme-ado yet.');
    expect(within(via).queryByTestId('tracker-remove')).toBeNull();
  });

  it('attaching or detaching a repository reads crew’s links again', async () => {
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer([link()], []);
    const view = render(<ProjectTrackers projectId="proj_billing" projectName="Billing" repoNames={['billing-api']} navigate={nav} />);
    await screen.findAllByTestId('project-tracker');
    const reads = (): number => calls.filter((c) => c.path === '/tracker-links?project=proj_billing').length;
    expect(reads()).toBe(1);
    view.rerender(<ProjectTrackers projectId="proj_billing" projectName="Billing" repoNames={['billing-api', 'billing-web']} navigate={nav} />);
    await waitFor(() => expect(reads()).toBe(2));
    view.rerender(<ProjectTrackers projectId="proj_billing" projectName="Billing" repoNames={['billing-web']} navigate={nav} />);
    await waitFor(() => expect(reads()).toBe(3));
  });

  it('the picker learns every site across pages, and names each row’s site', async () => {
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer([], []);
    routes['GET /sources/acme-jira/trackers'] = async () => ({ name: 'acme-jira', next: 'c2', trackers: [{ tenant: 'cloud-1', tenantLabel: 'one.atlassian.net', key: 'BILL', label: 'Billing', links: [] }] });
    routes['GET /sources/acme-jira/trackers?cursor=c2'] = async () => ({ name: 'acme-jira', next: null, trackers: [{ tenant: 'cloud-2', tenantLabel: 'two.atlassian.net', key: 'BILL', label: 'Billing', links: [] }] });
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    await screen.findByTestId('project-trackers-empty');
    fireEvent.click(screen.getByTestId('project-trackers-add'));
    const picker = await screen.findByTestId('tracker-picker');
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option')).toHaveLength(1));
    // More pages may hold another site: the row already names its own.
    expect(within(picker).getByTestId('tracker-picker-option')).toHaveTextContent('one.atlassian.net');
    fireEvent.click(within(picker).getByTestId('tracker-picker-more'));
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option')).toHaveLength(2));
    expect(within(picker).getAllByTestId('tracker-picker-option').map((o) => o.textContent)).toEqual([expect.stringContaining('one.atlassian.net'), expect.stringContaining('two.atlassian.net')]);
    expect(within(picker).getByTestId('tracker-picker-site')).toBeInTheDocument();
  });

  it('a Link that lands after its picker closed never closes the picker opened since', async () => {
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer([], []);
    routes['GET /sources/acme-jira/trackers'] = async () => ({ name: 'acme-jira', next: null, trackers: [{ tenant: 'cloud-1', tenantLabel: 'one.atlassian.net', key: 'SUP', label: 'Support', links: [] }] });
    const post = deferred<unknown>();
    routes['POST /tracker-links'] = () => post.promise;
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    await screen.findByTestId('project-trackers-empty');
    fireEvent.click(screen.getByTestId('project-trackers-add'));
    await waitFor(() => expect(screen.getAllByTestId('tracker-picker-option')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('tracker-picker-link'));
    fireEvent.click(screen.getByTestId('tracker-picker-close'));
    fireEvent.click(screen.getByTestId('project-trackers-add'));
    await screen.findByTestId('tracker-picker');
    await act(async () => { post.resolve(link()); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(calls.filter((c) => c.path === '/tracker-links?project=proj_billing').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId('tracker-picker')).toBeInTheDocument();
  });
});

describe('review r2 folds (trackers)', () => {
  it('two trackers with one key say which tool and site each is', async () => {
    const base0 = { system: 'jira', key: 'BILL', label: 'Billing', via: { kind: 'project' }, issues: [{ key: 'BILL-1', title: 'Same title', state: null }] };
    routes['GET /tracker-links/issues?project=proj_billing'] = async () => ({ trackers: [
      { ...base0, trackerId: 'trk_1', source: 'jira-one', tenantLabel: 'one.atlassian.net' },
      { ...base0, trackerId: 'trk_2', source: 'jira-one', tenantLabel: 'two.atlassian.net' },
    ] });
    render(<IssuePicker projectId="proj_billing" repoId={null} projectName="Billing" repoName={null} onPick={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findAllByTestId('issue-picker-group-where')).map((w) => w.textContent)).toEqual(['jira-one · one.atlassian.net', 'jira-one · two.atlassian.net']);
  });

  it('a registry answer the picker can’t read is said, never "no tool registered"', async () => {
    routes['GET /tracker-links?project=proj_billing'] = async () => projectAnswer([], []);
    routes['GET /mcp/servers'] = async () => ({});
    render(<ProjectTrackers projectId="proj_billing" projectName="Billing" navigate={nav} />);
    await screen.findByTestId('project-trackers-empty');
    fireEvent.click(screen.getByTestId('project-trackers-add'));
    expect(await screen.findByTestId('tracker-picker-none')).toHaveTextContent('crew’s sources could not be read just now.');
  });
});
