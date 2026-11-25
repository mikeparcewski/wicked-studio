// wicked-crew#372: Publish the plan to GitHub, on a finished Compose run. Every crew answer here is the route's own
// (tests/fixtures/product-publish.wire.json: captured from crew's registerProductPublishRoutes against the fake
// github-mcp-server), and the run is a real compose launch's view.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import {
  bodyShown, looksComposed, productPublishApi, publicationOf, publicationsOf, publishCardOf, publishRefusal, publishResponseOf, repoSelector,
} from '../src/api/productPublish.js';
import type { SessionView } from '../src/api/types.js';
import { ProductPublish, issueNumberOf, itemStateWords } from '../src/components/product/ProductPublish.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { resetRunPanel } from '../src/store/runPanel.js';

const openLaunchWizard = vi.fn();
vi.mock('../src/store/launchWizard.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/store/launchWizard.js')>()), openLaunchWizard: (...a: unknown[]) => openLaunchWizard(...a) }));

interface Answer { status: number; body: Record<string, unknown> }
const WIRE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'product-publish.wire.json'), 'utf8')) as { view: SessionView; answers: Record<string, Answer> };
const A = (name: string): Answer => structuredClone(WIRE.answers[name]!);
const RUN = WIRE.view.session.id;
const PID = (WIRE.view.session as unknown as { project_id: string }).project_id;
type Pub = { repo: string; source: string; published: boolean; items: Array<Record<string, unknown>> };
/** A GET answer for this run with `publications` replaced (each one a publication crew's routes answered). */
const getWith = (publications: unknown[], from = 'get-before'): Record<string, unknown> => ({ ...A(from).body, publications });
const pubOf = (name: string): Pub => (A(name).body as { publication: Pub }).publication;
/** What a GET says after the resolve: crew's own resolve answer's publication (`post-resolve-absent`). */
const GET_RESOLVED = (): Record<string, unknown> => getWith([pubOf('post-resolve-absent')]);
/** Two of four created, the rest refused before sending: crew's `post-done` publication with its last two items not sent. */
const partial = (): Pub => {
  const p = pubOf('post-done');
  p.published = false;
  for (const i of p.items.slice(2)) Object.assign(i, { state: 'not_sent', number: null, url: null, readBack: null, why: 'gh is switched off' });
  return p;
};
const deferred = <T,>() => { let res!: (v: T) => void; let rej!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { res = a; rej = b; }); return { promise, res, rej }; };
const refusal = (name: string): ApiError => { const a = A(name); return new ApiError(a.status, String(a.body['error']), a.body); };

describe('reading crew’s answers', () => {
  it('reads every answer the route gives, whole', () => {
    for (const n of ['get-before', 'get-not-a-compose', 'get-unverified', 'get-after', 'get-unsure']) expect(publicationsOf(A(n).body, RUN), n).not.toBeNull();
    for (const n of ['post-card', 'post-done', 'post-unsure', 'post-unresolved', 'post-resolve-absent']) expect(publishResponseOf(A(n).body, RUN, PID), n).not.toBeNull();
    const after = publicationsOf(A('get-after').body, RUN)!;
    expect(after.publications[0]!.published).toBe(true);
    expect(after.publications[0]!.items.map((i) => [i.number, i.readBack])).toEqual([[100, 'ok'], [101, 'ok'], [102, 'ok'], [103, 'ok']]);
    const card = publishResponseOf(A('post-card').body, RUN, PID)!;
    expect(card.done).toBe(false);
    expect(card.card.items.map((i) => [i.key, i.kind, i.parentKey])).toEqual([['e1', 'epic', null], ['e1.f1', 'feature', 'e1'], ['e1.f1.s1', 'story', 'e1.f1'], ['e1.f1.s2', 'story', 'e1.f1']]);
  });

  it('one part not crew’s shape makes the whole answer unreadable (another run, a link off GitHub, a bad hash)', () => {
    expect(publicationsOf(A('get-after').body, 'run-other')).toBeNull();
    const offsite = A('get-after').body as { publications: Array<{ items: Array<{ url: string }> }> };
    offsite.publications[0]!.items[1]!.url = 'https://example.com/owner/app/issues/101';
    expect(publicationsOf(offsite, RUN)).toBeNull();
    const hash = A('post-card').body;
    hash['publishHash'] = 'nope';
    expect(publishResponseOf(hash, RUN, PID)).toBeNull();
    expect(publishCardOf(A('post-card').body['card'], RUN, 'proj-other')).toBeNull();
  });

  it('a publication whose parts disagree is unreadable (published over an unsure item, no items, another issue’s link)', () => {
    const lying = pubOf('post-unsure');
    lying.published = true;
    expect(publicationOf(lying)).toBeNull();
    const notPublished = pubOf('post-done');
    notPublished.published = false;
    expect(publicationOf(notPublished)).toBeNull();
    const empty = pubOf('post-done');
    empty.items = [];
    expect(publicationOf(empty)).toBeNull();
    const elsewhere = pubOf('post-done');
    elsewhere.items[0]!['url'] = 'https://github.com/other/project/issues/100';
    expect(publicationOf(elsewhere)).toBeNull();
    const otherNumber = pubOf('post-done');
    otherNumber.items[0]!['url'] = 'https://github.com/owner/app/issues/999';
    expect(publicationOf(otherNumber)).toBeNull();
    const numberless = pubOf('post-unsure');
    numberless.items[0]!['number'] = 7;
    expect(publicationOf(numberless)).toBeNull();
    expect(publicationOf(pubOf('post-done'))).not.toBeNull();
    expect(publicationOf(partial())).not.toBeNull();
  });

  it('an issue number is 1 to 9,999,999,999, with or without #', () => {
    expect(['0', '#0', '', 'x', '12a', '10000000000', '-1'].map(issueNumberOf)).toEqual([null, null, null, null, null, null, null]);
    expect(['12', '#12', ' 9999999999 '].map(issueNumberOf)).toEqual([12, 12, 9_999_999_999]);
  });

  it('a body shows its parent by key until it is sent; a repository two sources link is named by its source', () => {
    const story = publishResponseOf(A('post-card').body, RUN, PID)!.card.items[2]!;
    expect(story.body).toContain('Part of {{parent}}');
    expect(bodyShown(story)).toContain('Part of the issue for e1.f1');
    expect(bodyShown(story)).not.toContain('{{parent}}');
    expect(repoSelector({ repo: 'owner/app', source: 'gh' }, [{ repo: 'owner/app', source: 'gh' }])).toBe('owner/app');
    expect(repoSelector({ repo: 'owner/app', source: 'gh2' }, [{ repo: 'owner/app', source: 'gh' }, { repo: 'owner/app', source: 'gh2' }])).toBe('gh2:owner/app');
  });

  it('only a Compose run (by the name crew gives it) asks about publishing', () => {
    expect(looksComposed(WIRE.view.session.problem)).toBe(true);
    expect(looksComposed('Fix the login bug')).toBe(false);
    expect(looksComposed(undefined)).toBe(false);
  });

  it('refusals read in plain words; card_changed and unresolved say nothing was sent', () => {
    expect(publishRefusal(refusal('post-card-changed'))).toMatch(/card changed .* Nothing was sent/);
    expect(publishRefusal(new ApiError(409, 'an earlier publish could not tell…', { code: 'unresolved', error: 'x' }))).toMatch(/Say for each one below whether it exists/);
    expect(publishRefusal(new ApiError(404, 'Not Found'))).toMatch(/update crew/);
  });

  it('each item state has its words', () => {
    const unsure = publicationsOf(A('get-unsure').body, RUN)!.publications[0]!.items[0]!;
    expect(itemStateWords(unsure)).toMatchObject({ tone: 'warn' });
    expect(itemStateWords(unsure).words).toMatch(/^Not known whether GitHub created it: GitHub answered an error, .*not shown\)\. Look in the repository/);
    expect(itemStateWords({ ...unsure, state: 'created', readBack: 'differs' }).words).toMatch(/different/);
  });
});

describe('the Publish block', () => {
  let read: ReturnType<typeof vi.spyOn>;
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    openLaunchWizard.mockReset();
    read = vi.spyOn(productPublishApi, 'read');
    post = vi.spyOn(productPublishApi, 'post');
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const mount = async (): Promise<void> => { await act(async () => { render(<ProductPublish projectId={PID} runId={RUN} />); }); };

  it('a run from before publishing says why up front, offers Compose again, and asks crew for nothing more', async () => {
    read.mockResolvedValue(A('get-not-a-compose').body);
    await mount();
    expect(screen.getByTestId('product-publish-blocked')).toHaveTextContent('This run was not composed for this project, or it was composed before publishing was added; compose again to publish.');
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
    fireEvent.click(screen.getByTestId('product-publish-compose-again'));
    expect(openLaunchWizard).toHaveBeenCalledWith({ workflowId: 'draft-epics', projectId: PID, composerKey: 'desk' });
    expect(post).not.toHaveBeenCalled();
  });

  it('a plan edited at its gate says so in plain words before any click', async () => {
    read.mockResolvedValue(A('get-unverified').body);
    await mount();
    const blocked = screen.getByTestId('product-publish-blocked');
    expect(blocked).toHaveAttribute('data-code', 'compose_unverified');
    expect(blocked).toHaveTextContent('This plan was edited at its gate; publishing an edited plan isn\'t supported yet, compose again to publish.');
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('show, then create: the card is crew’s (nothing sent), Create sends exactly its hash, then the issues read back', async () => {
    read.mockResolvedValueOnce(A('get-before').body).mockResolvedValueOnce(A('get-after').body);
    post.mockResolvedValueOnce(A('post-card').body).mockResolvedValueOnce(A('post-done').body);
    await mount();
    expect(post).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    expect(post).toHaveBeenLastCalledWith(PID, { runId: RUN, repo: 'owner/app' });
    const card = screen.getByTestId('product-publish-card');
    expect(card).toHaveTextContent('crew creates these 4 issues in owner/app as pat-bot on gh');
    expect(within(card).getAllByTestId('product-publish-card-item').map((li) => li.textContent?.replace(/Text.*$/s, ''))).toEqual(['EpicAccounts & access', 'FeatureSign in and out', 'StoryEmail sign in (< 3 tries)', 'StorySign out from any page']);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-confirm')); });
    expect(post).toHaveBeenLastCalledWith(PID, { runId: RUN, repo: 'owner/app', confirm: A('post-card').body['publishHash'] });
    expect(screen.getByTestId('product-publish-verdict')).toHaveTextContent('Published: all 4 issues created and checked on GitHub.');
    expect(screen.getAllByTestId('product-publish-link').map((a) => a.getAttribute('href'))).toEqual([100, 101, 102, 103].map((n) => `https://github.com/owner/app/issues/${n}`));
    // A repository it is published to offers no second card.
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
  });

  it('Cancel sends nothing', async () => {
    read.mockResolvedValue(A('get-before').body);
    post.mockResolvedValueOnce(A('post-card').body);
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    fireEvent.click(screen.getByTestId('product-publish-cancel'));
    expect(screen.getByTestId('product-publish-cancelled')).toHaveTextContent('Nothing was sent.');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a card that changed comes back as crew’s fresh card, waiting for a new click', async () => {
    read.mockResolvedValue(A('get-before').body);
    post.mockResolvedValueOnce(A('post-card').body).mockRejectedValueOnce(refusal('post-card-changed'));
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-confirm')); });
    expect(screen.getByTestId('product-publish-note')).toHaveTextContent(/card changed/);
    expect(screen.getByTestId('product-publish-card')).toHaveTextContent('Accounts and access');
    expect(post).toHaveBeenCalledTimes(2);
    post.mockResolvedValueOnce(A('post-done').body);
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-confirm')); });
    expect(post).toHaveBeenLastCalledWith(PID, { runId: RUN, repo: 'owner/app', confirm: A('post-card-changed').body['publishHash'] });
  });

  it('an issue crew can’t tell was created is settled by a person; no card is offered until then; crew’s answer shows at once', async () => {
    const refresh = deferred<unknown>();
    read.mockResolvedValueOnce(A('get-unsure').body).mockReturnValueOnce(refresh.promise);
    post.mockResolvedValueOnce(A('post-resolve-absent').body);
    await mount();
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
    expect(screen.getByTestId('product-publish-held')).toHaveTextContent('say for each issue marked “not known” whether it exists');
    const item = screen.getAllByTestId('product-publish-item').find((li) => li.dataset['state'] === 'unsure')!;
    const exists = within(item).getByTestId('product-publish-resolve-exists');
    expect(exists).toBeDisabled();
    fireEvent.change(within(item).getByRole('textbox'), { target: { value: '#12' } });
    expect(exists).not.toBeDisabled();
    await act(async () => { fireEvent.click(within(item).getByTestId('product-publish-resolve-absent')); });
    expect(post).toHaveBeenCalledWith(PID, { runId: RUN, repo: 'owner/app', resolve: { key: 'e1', issue: null } });
    // crew's resolve answer is shown before the refresh lands.
    expect(screen.getAllByTestId('product-publish-item').map((li) => li.dataset['state'])).toEqual(['absent', 'missing', 'missing', 'missing']);
    expect(screen.getByTestId('product-publish-show')).toBeTruthy();
    await act(async () => { refresh.res(GET_RESOLVED()); });
    expect(screen.getAllByTestId('product-publish-item').map((li) => li.dataset['state'])).toEqual(['absent', 'missing', 'missing', 'missing']);
  });

  it('a refresh that fails after a write keeps what crew said happened, and says so', async () => {
    read.mockResolvedValueOnce(A('get-before').body).mockRejectedValueOnce(new ApiError(503, 'the publish journal could not be read now', { code: 'journal_unavailable', error: 'x' }));
    post.mockResolvedValueOnce(A('post-card').body).mockResolvedValueOnce(A('post-unsure').body);
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-confirm')); });
    expect(screen.getAllByTestId('product-publish-item').map((li) => li.dataset['state'])).toEqual(['unsure', 'missing', 'missing', 'missing']);
    expect(screen.getByTestId('product-publish-refresh-note')).toHaveTextContent('What is shown is crew’s last answer.');
    expect(screen.getByTestId('product-publish-held')).toBeTruthy();
    expect(screen.queryByTestId('product-publish-unreadable')).toBeNull();
  });

  it('a card over an attempt that must be settled is not offered: the unsure item shows instead', async () => {
    read.mockResolvedValue(A('get-before').body);
    post.mockResolvedValueOnce(A('post-unresolved').body);
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    expect(screen.queryByTestId('product-publish-card')).toBeNull();
    expect(screen.getByTestId('product-publish-resolve')).toBeTruthy();
    expect(screen.getByTestId('product-publish-held')).toBeTruthy();
  });

  it('a retry card creates only what isn’t created yet, and says so', async () => {
    read.mockResolvedValue(getWith([partial()]));
    post.mockResolvedValueOnce({ ...A('post-card').body, publication: partial() });
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    expect(screen.getByTestId('product-publish-card-what')).toHaveTextContent('crew creates the 2 issues not created yet (2 already exist and are not sent again)');
    expect(screen.getAllByTestId('product-publish-card-item').map((li) => li.dataset['exists'])).toEqual(['true', 'true', 'false', 'false']);
    expect(screen.getByTestId('product-publish-confirm')).toHaveTextContent('Create 2 issues');
  });

  it('a repository is one publication whichever source sent it; one held repository leaves the others publishable', async () => {
    // Published through gh; gh2 links the same repository: no second card.
    const both = getWith([pubOf('post-done')]);
    both['targets'] = [{ repo: 'owner/app', source: 'gh' }, { repo: 'owner/app', source: 'gh2' }];
    read.mockResolvedValueOnce(both);
    await mount();
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
    cleanup();
    // owner/app waits on a person; owner/other can still be published, and the picker stays.
    const two = getWith([pubOf('post-unsure')]);
    two['targets'] = [{ repo: 'owner/app', source: 'gh' }, { repo: 'owner/other', source: 'gh' }];
    read.mockResolvedValueOnce(two);
    await mount();
    expect(screen.getByTestId('product-publish-held')).toHaveTextContent('owner/app');
    expect(screen.queryByTestId('product-publish-show')).toBeNull();
    fireEvent.change(screen.getByTestId('product-publish-pick'), { target: { value: '1' } });
    expect(screen.getByTestId('product-publish-show')).toBeTruthy();
    expect(screen.queryByTestId('product-publish-held')).toBeNull();
  });

  it('while an issue is being sent it looks again by itself; an older read never lands over a newer one', async () => {
    vi.useFakeTimers();
    try {
      const sending = pubOf('post-unsure');
      sending.items[0] = { ...sending.items[0], state: 'sending' };
      delete sending.items[0]!['why'];
      read.mockResolvedValueOnce(getWith([sending]));
      await mount();
      expect(screen.getByTestId('product-publish-held')).toHaveTextContent('being sent');
      const older = deferred<unknown>();
      const newer = deferred<unknown>();
      read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      await act(async () => { vi.advanceTimersByTime(3000); });
      expect(read).toHaveBeenCalledTimes(2);
      await act(async () => { fireEvent.click(screen.getByTestId('product-publish-refresh')); });
      expect(read).toHaveBeenCalledTimes(3);
      await act(async () => { newer.res(A('get-after').body); });
      await act(async () => { older.res(getWith([sending])); });
      expect(screen.getByTestId('product-publish-verdict')).toHaveTextContent('Published: all 4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second click on Create in the same frame sends nothing more', async () => {
    read.mockResolvedValue(A('get-before').body);
    const sent = deferred<unknown>();
    post.mockResolvedValueOnce(A('post-card').body).mockReturnValueOnce(sent.promise);
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-show')); });
    const create = screen.getByTestId('product-publish-confirm');
    await act(async () => { fireEvent.click(create); fireEvent.click(create); });
    expect(post).toHaveBeenCalledTimes(2);
    await act(async () => { sent.res(A('post-done').body); });
  });

  it('a late answer for another run never lands, and a resolve in flight never locks the next run', async () => {
    const lateResolve = deferred<unknown>();
    const RUN_B = 'run-compose-2';
    const forB = (): Record<string, unknown> => ({ ...A('get-unsure').body, runId: RUN_B });
    read.mockResolvedValueOnce(A('get-unsure').body).mockResolvedValueOnce(forB());
    post.mockReturnValueOnce(lateResolve.promise);
    let r!: ReturnType<typeof render>;
    await act(async () => { r = render(<ProductPublish projectId={PID} runId={RUN} />); });
    await act(async () => { fireEvent.click(screen.getByTestId('product-publish-resolve-absent')); });
    expect(screen.getByTestId('product-publish-resolve-absent')).toBeDisabled();
    await act(async () => { r.rerender(<ProductPublish projectId={PID} runId={RUN_B} />); });
    expect(read).toHaveBeenLastCalledWith(PID, RUN_B);
    expect(screen.getByTestId('product-publish-resolve-absent')).not.toBeDisabled();
    await act(async () => { lateResolve.res(A('post-resolve-absent').body); });
    expect(screen.getAllByTestId('product-publish-item').map((li) => li.dataset['state'])).toEqual(['unsure', 'missing', 'missing', 'missing']);
    expect(screen.getByTestId('product-publish-resolve-absent')).not.toBeDisabled();
    expect(read).toHaveBeenCalledTimes(2);
    // A first read for run A answered after the panel moved to run B is dropped too.
    cleanup();
    const lateRead = deferred<unknown>();
    read.mockReturnValueOnce(lateRead.promise).mockResolvedValueOnce(forB());
    await act(async () => { r = render(<ProductPublish projectId={PID} runId={RUN} />); });
    await act(async () => { r.rerender(<ProductPublish projectId={PID} runId={RUN_B} />); });
    await act(async () => { lateRead.res(A('get-after').body); });
    expect(screen.queryByTestId('product-publish-verdict')).toHaveTextContent('Not fully published');
  });

  it('a resolve naming an issue sends its number', async () => {
    read.mockResolvedValue(A('get-unsure').body);
    post.mockRejectedValueOnce(new ApiError(409, '#12 is not e1: its title or body is not what was approved for it', { code: 'resolve_differs', error: 'x' }));
    await mount();
    const item = screen.getAllByTestId('product-publish-item').find((li) => li.dataset['state'] === 'unsure')!;
    fireEvent.change(within(item).getByRole('textbox'), { target: { value: '12' } });
    await act(async () => { fireEvent.click(within(item).getByTestId('product-publish-resolve-exists')); });
    expect(post).toHaveBeenCalledWith(PID, { runId: RUN, repo: 'owner/app', resolve: { key: 'e1', issue: 12 } });
    expect(within(item).getByTestId('product-publish-resolve-note')).toHaveTextContent('That issue isn’t this item');
  });

  it('a crew without the route shows nothing; a failed read says so', async () => {
    read.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    await mount();
    expect(screen.queryByTestId('product-publish')).toBeNull();
    cleanup();
    read.mockRejectedValueOnce(new ApiError(503, 'the tracker registry could not be read now', { code: 'registry_unavailable', error: 'x' }));
    await mount();
    expect(screen.getByTestId('product-publish-unreadable')).toHaveTextContent('couldn’t read its tracker list');
  });

  it('a project with no GitHub repository linked says how to get one', async () => {
    const none = A('get-before').body;
    none['targets'] = [];
    read.mockResolvedValue(none);
    await mount();
    expect(screen.getByTestId('product-publish-no-target')).toHaveTextContent('link a GitHub repository to this project as a tracker');
  });
});

describe('where it shows: the run panel’s Changes section, on a finished Compose run in a project', () => {
  beforeEach(() => {
    resetRunPanel();
    useGateStore.setState({ gates: {}, approaching: {} });
    useRunEventStore.setState({ byRun: {} });
    useRunAcceptanceStore.setState({ byRun: {} });
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const mount = async (view: SessionView): Promise<void> => {
    await act(async () => { render(<RunTab runs={[view]} sessionId={`run:${view.session.id}`} title="Compose" />); });
  };

  it('the compose run asks crew; another run, an unfinished one, or one with no project does not', async () => {
    const read = vi.spyOn(productPublishApi, 'read').mockResolvedValue(A('get-before').body);
    await mount(structuredClone(WIRE.view));
    expect(read).toHaveBeenCalledWith(PID, RUN);
    expect(screen.getByTestId('product-publish-show')).toBeTruthy();
    cleanup();
    read.mockClear();
    const other = structuredClone(WIRE.view);
    other.session.problem = 'Fix the login bug';
    await mount(other);
    const running = structuredClone(WIRE.view);
    running.session.status = 'executing';
    await mount(running);
    const loose = structuredClone(WIRE.view);
    (loose.session as unknown as { project_id: string | null }).project_id = null;
    await mount(loose);
    expect(read).not.toHaveBeenCalled();
  });
});
