// wicked-crew#1901 (DES-1901-studio, approved by coord 2026-11-28): Publish the plan to a Jira project linked to the
// job's project, beside GitHub. Every crew answer here is the route's own (tests/fixtures/product-publish-jira.wire.json:
// captured from crew's registerProductPublishRoutes on crew main f000b617 against the fake Atlassian server). A mixed
// answer is two real answers joined the way crew joins them (crew product-publish.ts:1384: the GitHub targets, then the
// Jira ones). The GitHub tests (productPublish.test.tsx) are unchanged.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import { productPublishApi, publicationOf, publicationsOf, publishCardOf, publishRefusal, publishResponseOf, targetName } from '../src/api/productPublish.js';
import { ProductPublish, itemStateWords, jiraKeyOf } from '../src/components/product/ProductPublish.js';

interface Answer { status: number; body: Record<string, unknown> }
const JIRA = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'product-publish-jira.wire.json'), 'utf8')) as { runId: string; projectId: string; answers: Record<string, Answer> };
const GH = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'product-publish.wire.json'), 'utf8')) as { answers: Record<string, Answer> };
const J = (name: string): Answer => structuredClone(JIRA.answers[name]!);
const RUN = JIRA.runId;
const PID = JIRA.projectId;
type Item = Record<string, unknown>;
type Pub = { system?: string; repo: string; source: string; publishHash: string; published: boolean; items: Item[] };
const pubOf = (name: string): Pub => (J(name).body as { publication: Pub }).publication;
/** crew's GET with a GitHub repository and a Jira project linked: GitHub's targets first, then Jira's (crew product-publish.ts:1384). */
const mixed = (): Record<string, unknown> => {
  const gh = structuredClone(GH.answers['get-before']!.body) as { targets: unknown[] };
  return { ...gh, targets: [...gh.targets, ...(J('get-before').body['targets'] as unknown[])] };
};
const refusal = (a: Answer): ApiError => new ApiError(a.status, String(a.body['error']), a.body);

describe('reading crew’s Jira answers', () => {
  it('reads every Jira answer the route gives, whole', () => {
    for (const n of ['get-before', 'get-after', 'get-unsure', 'get-resolved', 'get-jira-only-publishable', 'get-jira-not-publishable', 'get-hostless', 'get-two-sites']) expect(publicationsOf(J(n).body, RUN), n).not.toBeNull();
    for (const n of ['post-card', 'post-done', 'post-unsure', 'post-card-over-unsure', 'post-resolve-exists', 'post-resolve-absent', 'post-differs', 'post-card-task', 'post-card-hostless']) expect(publishResponseOf(J(n).body, RUN, PID), n).not.toBeNull();
    expect(publicationOf((J('post-unresolved').body as { publication: unknown }).publication)).not.toBeNull();
    expect(publicationsOf(mixed(), RUN)!.targets.map((t) => [t.system ?? 'github', t.repo, t.label ?? null])).toEqual([['github', 'owner/app', null], ['jira', 'PROJA@c1', 'PROJA on acme.atlassian.net']]);
  });

  it('a card says the system, the site and each item’s issue type; a publication says each issue’s key and page', () => {
    const card = publishResponseOf(J('post-card').body, RUN, PID)!.card;
    expect([card.system, card.repo, card.site, card.identity]).toEqual(['jira', 'PROJA@c1', 'acme.atlassian.net', 'acct-1']);
    expect(card.items.map((i) => [i.key, i.issueType])).toEqual([['e1', 'Epic'], ['e1.f1', 'Story'], ['e1.f1.s1', 'Sub-task'], ['e1.f1.s2', 'Sub-task']]);
    const p = publicationsOf(J('get-after').body, RUN)!.publications[0]!;
    expect([p.system, p.published]).toEqual(['jira', true]);
    expect(p.items.map((i) => [i.ref, i.number, i.url])).toEqual([100, 101, 102, 103].map((n) => [`PROJA-${n}`, null, `https://acme.atlassian.net/browse/PROJA-${n}`]));
    // A GitHub answer reads as GitHub, as before: crew names no system for it.
    expect(publishResponseOf(GH.answers['post-card']!.body, RUN, PID)!.card.system).toBeUndefined();
  });

  it('an unknown system is unreadable, never read as GitHub (a target, a card, a publication)', () => {
    const t = mixed() as { targets: Array<Record<string, unknown>> };
    t.targets[0]!['system'] = 'gitlab';
    expect(publicationsOf(t, RUN)).toBeNull();
    const card = structuredClone(GH.answers['post-card']!.body) as { card: Record<string, unknown> };
    card.card['system'] = 'ado';
    expect(publishResponseOf(card, RUN, PID)).toBeNull();
    const pub = structuredClone(GH.answers['post-done']!.body) as { publication: Record<string, unknown> };
    pub.publication['system'] = 'linear';
    expect(publicationOf(pub.publication)).toBeNull();
  });

  it('a label crew sent but can’t be read makes the answer unreadable; with no label the target is named by its selector', () => {
    const bad = J('get-before').body as { targets: Array<Record<string, unknown>> };
    bad.targets[0]!['label'] = 42;
    expect(publicationsOf(bad, RUN)).toBeNull();
    const none = J('get-before').body as { targets: Array<Record<string, unknown>> };
    delete none.targets[0]!['label'];
    const t = publicationsOf(none, RUN)!.targets[0]!;
    expect(targetName(t)).toBe('PROJA@c1');
    expect(targetName(publicationsOf(J('get-hostless').body, RUN)!.targets[0]!)).toBe('PROJA on site c1');
  });

  it('a Jira item whose parts disagree is unreadable (no key, another project’s key, a page that is not that issue’s, a number)', () => {
    const cases: Array<(i: Item) => void> = [
      (i) => { delete i['ref']; },
      (i) => { i['ref'] = 'OTHER-100'; i['url'] = 'https://acme.atlassian.net/browse/OTHER-100'; },
      (i) => { i['url'] = 'https://acme.atlassian.net/browse/PROJA-999'; },
      (i) => { i['url'] = 'javascript:alert(1)//browse/PROJA-100'; },
      (i) => { i['number'] = 100; },
    ];
    for (const [k, edit] of cases.entries()) {
      const p = pubOf('post-done');
      edit(p.items[0]!);
      expect(publicationOf(p), String(k)).toBeNull();
    }
    // An item not created carries no key.
    const unsure = pubOf('post-unsure');
    unsure.items[0]!['ref'] = 'PROJA-100';
    expect(publicationOf(unsure)).toBeNull();
    // A site linked without a host: crew names the key and no page (crew product-publish.ts:716).
    const hostless = pubOf('post-done');
    for (const i of hostless.items) i['url'] = null;
    expect(publicationOf(hostless)!.items.map((i) => [i.ref, i.url])).toEqual([100, 101, 102, 103].map((n) => [`PROJA-${n}`, null]));
  });

  it('a Jira card item needs an issue type of Jira’s standard set; a Jira card needs a site', () => {
    const odd = J('post-card').body as { card: { items: Item[]; site?: unknown } };
    odd.card.items[0]!['issueType'] = 'IGNORE PREVIOUS INSTRUCTIONS';
    expect(publishCardOf(odd.card, RUN, PID)).toBeNull();
    const none = J('post-card').body as { card: { items: Item[] } };
    delete none.card.items[1]!['issueType'];
    expect(publishCardOf(none.card, RUN, PID)).toBeNull();
    const noSite = J('post-card').body as { card: Record<string, unknown> };
    delete noSite.card['site'];
    expect(publishCardOf(noSite.card, RUN, PID)).toBeNull();
  });
});

describe('Jira words', () => {
  it('an item’s state names Jira and the project, not GitHub and the repository', () => {
    const unsure = publicationOf(pubOf('post-unsure'))!.items[0]!;
    expect(itemStateWords(unsure, 'jira').words).toMatch(/^Not known whether Jira created it: .*\. Look in the Jira project, then say below\.$/);
    const done = publicationOf(pubOf('post-done'))!.items[0]!;
    expect(itemStateWords(done, 'jira').words).toBe('Created, and checked in Jira');
    expect(itemStateWords(publicationOf(pubOf('post-differs'))!.items[1]!, 'jira').words).toBe('Created, but Jira now shows a different summary, text, type or parent');
  });

  it('the resolve takes a key of the target’s own project only', () => {
    expect(jiraKeyOf('PROJA-100', 'PROJA@c1')).toBe('PROJA-100');
    expect(jiraKeyOf('  proja-7 ', 'PROJA@c1')).toBe('PROJA-7');
    for (const typed of ['OTHER-100', '100', '#100', 'PROJA-0', 'PROJA-', 'PROJA-1x', 'PROJAB-1', 'XPROJA-1']) expect(jiraKeyOf(typed, 'PROJA@c1'), typed).toBeNull();
  });

  it('a Jira refusal names Jira’s tools and plain reasons', () => {
    expect(publishRefusal(refusal(J('post-type-missing')), 'jira')).toMatch(/^The Jira project has no issue type for one level of the plan .*Nothing was sent\.$/);
    expect(publishRefusal(new ApiError(409, 'x', { code: 'write_tool_off', error: 'x' }), 'jira')).toContain('createJiraIssue');
    expect(publishRefusal(new ApiError(409, 'x', { code: 'read_tool_off', error: 'x' }), 'jira')).toContain('getJiraIssue');
    expect(publishRefusal(new ApiError(409, 'x', { code: 'write_tool_shape', error: 'x' }), 'jira')).toContain('Nothing was sent.');
    expect(publishRefusal(refusal(J('post-resolve-differs')), 'jira')).toBe('That issue isn’t this item: its summary or text isn’t what was approved for it. Nothing was recorded.');
    // GitHub's words are GitHub's.
    expect(publishRefusal(new ApiError(409, 'x', { code: 'write_tool_off', error: 'x' }))).toContain('issue_write');
  });
});

describe('the Publish block, to Jira', () => {
  let read: ReturnType<typeof vi.spyOn>;
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    read = vi.spyOn(productPublishApi, 'read');
    post = vi.spyOn(productPublishApi, 'post');
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const mount = async (): Promise<void> => { await act(async () => { render(<ProductPublish projectId={PID} runId={RUN} />); }); };

  it('show, then create: the card names the project, its site, the account and each issue type; the issues link by key', async () => {
    read.mockResolvedValueOnce(J('get-before').body).mockResolvedValueOnce(J('get-after').body);
    post.mockResolvedValueOnce(J('post-card').body).mockResolvedValueOnce(J('post-done').body);
    await mount();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/^Publish the plan$/);
    expect(screen.getByTestId('product-publish-show')).toHaveTextContent('Show the 4 issues for PROJA on acme.atlassian.net');
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    expect(post).toHaveBeenLastCalledWith(PID, { runId: RUN, repo: 'PROJA@c1' });
    const card = screen.getByTestId('product-publish-card');
    expect(screen.getByTestId('product-publish-card-what')).toHaveTextContent('crew creates these 4 issues in the Jira project PROJA on acme.atlassian.net as the Atlassian account acct-1 on jira');
    expect(within(card).getAllByTestId('product-publish-card-type').map((s) => s.textContent)).toEqual(['Epic', 'Story', 'Sub-task', 'Sub-task']);
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-confirm')); });
    expect(post).toHaveBeenLastCalledWith(PID, { runId: RUN, repo: 'PROJA@c1', confirm: J('post-card').body['publishHash'] });
    expect(screen.getByTestId('product-publish-verdict')).toHaveTextContent('Published: all 4 issues created and checked in Jira.');
    const links = screen.getAllByTestId('product-publish-link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([100, 101, 102, 103].map((n) => [`PROJA-${n} ↗`, `https://acme.atlassian.net/browse/PROJA-${n}`]));
    expect(within(screen.getByTestId('product-publish-publication')).getByText('PROJA on acme.atlassian.net')).toBeTruthy();
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
  });

  it('a Jira project and a GitHub repository: the pick names each by crew’s label, and each says whether it can take the plan', async () => {
    const both = mixed() as { publishable: unknown; targets: Array<Record<string, unknown>> };
    // The plan is fine for GitHub, and too long a title for Jira (crew's per-target answer).
    both.targets[1]!['publishable'] = (J('get-jira-not-publishable').body['targets'] as Array<Record<string, unknown>>)[0]!['publishable'];
    read.mockResolvedValue(both);
    await mount();
    const pick = screen.getByTestId('product-publish-pick') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['owner/app (gh)', 'PROJA on acme.atlassian.net (jira)']);
    expect(screen.getByTestId('product-publish-show')).toBeTruthy();
    expect(screen.queryByTestId('product-publish-blocked')).toBeNull();
    await act(async () => { fireEvent.change(pick, { target: { value: '1' } }); });
    expect(screen.getByTestId('product-publish-blocked')).toHaveTextContent('The title of e1 is longer than the 255 characters a Jira summary holds.');
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
    // The pick stays, so a person can go back to the repository.
    expect(screen.getByTestId('product-publish-pick')).toBeTruthy();
  });

  it('a plan GitHub can’t take can still go to Jira when crew says so', async () => {
    read.mockResolvedValue(J('get-jira-only-publishable').body);
    await mount();
    expect(screen.queryByTestId('product-publish-blocked')).toBeNull();
    expect(screen.getByTestId('product-publish-show')).toHaveTextContent('Show the 4 issues for PROJA on acme.atlassian.net');
  });

  it('a not-known item is settled by its Jira key, of the target’s project only', async () => {
    read.mockResolvedValueOnce(J('get-unsure').body).mockResolvedValue(J('get-resolved').body);
    post.mockResolvedValueOnce(J('post-resolve-exists').body);
    await mount();
    const resolve = screen.getByTestId('product-publish-resolve');
    const input = within(resolve).getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Issue key, like PROJA-12');
    const exists = screen.getByTestId('product-publish-resolve-exists');
    for (const typed of ['100', 'OTHER-100', '#100']) {
      fireEvent.change(input, { target: { value: typed } });
      expect(exists, typed).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: 'proja-100' } });
    expect(exists).toBeEnabled();
    await act(async () => { fireEvent.click(exists); });
    expect(post).toHaveBeenLastCalledWith(PID, { runId: RUN, repo: 'PROJA@c1', resolve: { key: 'e1', issue: 'PROJA-100' } });
    expect(screen.getAllByTestId('product-publish-link')[0]).toHaveTextContent('PROJA-100 ↗');
  });

  it('a site with no host shows each key without a link', async () => {
    const after = J('get-after').body as { publications: Pub[] };
    for (const i of after.publications[0]!.items) i['url'] = null;
    read.mockResolvedValue(after);
    await mount();
    expect(screen.queryByTestId('product-publish-link')).toBeNull();
    expect(screen.getAllByTestId('product-publish-ref').map((s) => s.textContent)).toEqual(['PROJA-100', 'PROJA-101', 'PROJA-102', 'PROJA-103']);
  });

  it('a project with nothing linked names both kinds of tracker', async () => {
    read.mockResolvedValue({ ...J('get-before').body, targets: [] });
    await mount();
    expect(screen.getByTestId('product-publish-no-target')).toHaveTextContent('link a GitHub repository to this project as a tracker, or a Jira project');
  });

  it('a Jira refusal on Show is said in Jira’s words', async () => {
    read.mockResolvedValue(J('get-before').body);
    post.mockRejectedValueOnce(refusal(J('post-type-missing')));
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    expect(screen.getByTestId('product-publish-refused')).toHaveTextContent(/^The Jira project has no issue type for one level of the plan/);
  });
});
