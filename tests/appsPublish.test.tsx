import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppPublishBody, AppPublished, SessionView } from '../src/api/types.js';
import { PublishSheet, publishOrigin } from '../src/components/apps/PublishSheet.js';
import { ShareSheet, dockerRun } from '../src/components/apps/ShareSheet.js';
import { AppChat } from '../src/components/apps/AppChat.js';
import { publishedOf } from '../src/editors/apps/appsDirectory.js';
import { AppSession } from '../src/editors/apps/appSession.js';
import { SampleAppStore } from '../src/editors/apps/appStore.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';

const detail = (): AppDetail => ({
  slug: 'desk', name: 'Desk', projectId: 'p', repoId: 'desk', createdAt: 1,
  head: { version: 3, tree: 't', receipt: 'reviewed' }, turn: null, turns: [],
  spec: { ...structuredClone(SAMPLE_APPS['escalations']!.spec), actions: [] },
  lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} } as never,
  queryText: {}, versions: [], history: { states: [3], pointer: 0, canUndo: false, canRedo: false },
});
const published = (): AppPublished => ({
  version: 3, tree: 't', runId: 'publish-r', at: 1_762_160_400_000, actor: { id: 'local', kind: 'human', trust: 'admin' }, targets: ['studio', 'site', 'embed'],
  shareUrl: 'https://desk.test/', audience: 'Anyone with the link', image: { tag: 'wicked-apps/desk:v3-abc', id: 'sha256:abc' },
  snippet: '<iframe src="https://desk.test/" title="Desk"></iframe>', teamsPackage: null, manifestDigest: 'abc',
  run: { env: ['APPS_SRC_SUPPORT_PASSWORD', 'APPS_SRC_API_TOKEN'], volume: '/data', port: 8080 },
});
function mockCrew(body: unknown = { runId: 'publish-r', manifestDigest: 'abc' }, status = 202) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}
function signedIn() {
  fireEvent.change(screen.getByLabelText('Issuer URL'), { target: { value: 'https://login.test/issuer' } });
  fireEvent.change(screen.getByLabelText('Client id'), { target: { value: 'desk-client' } });
  fireEvent.change(screen.getByLabelText('Groups (comma separated)'), { target: { value: 'support, ops' } });
}
function start() { fireEvent.click(screen.getByRole('button', { name: 'Start publish' })); }
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); useGateStore.setState({ gates: {} }); useRunEventStore.setState({ byRun: {} }); localStorage.clear();
});

describe('Publish settings and crew refusals', () => {
  it('disables Public for an app with an action', () => {
    const app = detail(); app.spec.actions = structuredClone(SAMPLE_APPS['escalations']!.spec.actions);
    // The fixture must have an action: this is the public publish guard's regression test.
    expect(app.spec.actions.length).toBeGreaterThan(0);
    render(<PublishSheet detail={app} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect((screen.getByRole('radio', { name: /Public/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('This app has an action. Public apps can only read data and have no actions.')).toBeTruthy();
    expect(screen.queryByText('Microsoft Teams tab')).toBeNull();
  });
  it('disables Public unless every query is public', () => {
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect((screen.getByRole('radio', { name: /Public/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Every query must be marked public/)).toBeTruthy();
  });
  it('posts the exact signed-in AppPublishBody from the form and opens the returned run', async () => {
    const fetch = mockCrew(); const onStarted = vi.fn();
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={onStarted} />); signedIn(); start();
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('publish-r'));
    const expected: AppPublishBody = { base: 3, targets: ['studio', 'site'], site: { origin: 'http://localhost:8080' }, identity: { profile: 'oidc', issuer: 'https://login.test/issuer', clientId: 'desk-client' }, audience: { kind: 'oidc-groups', groups: ['support', 'ops'] } };
    expect(fetch.mock.calls[0]![0]).toMatch(/\/api\/v1\/apps\/desk\/publish$/u);
    expect(fetch.mock.calls[0]![1]?.method).toBe('POST');
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toStrictEqual(expected);
  });
  it.each(['oidc-email-domain', 'entra-roles', 'entra-groups'] as const)('posts %s audience and identity fields', async (kind) => {
    const fetch = mockCrew(); const onStarted = vi.fn();
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={onStarted} />); signedIn();
    fireEvent.change(screen.getByLabelText('Audience rule'), { target: { value: kind } });
    if (kind.startsWith('entra-')) fireEvent.change(screen.getByLabelText('Entra tenant id'), { target: { value: 'tenant-id' } });
    start(); await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string) as AppPublishBody;
    expect(body.audience).toStrictEqual({ kind, [kind === 'entra-roles' ? 'roles' : kind === 'entra-groups' ? 'groups' : 'domains']: ['support', 'ops'] });
    expect(body.identity).toStrictEqual({ profile: kind.startsWith('entra-') ? 'entra' : 'oidc', issuer: 'https://login.test/issuer', clientId: 'desk-client', ...(kind.startsWith('entra-') ? { tenantId: 'tenant-id' } : {}) });
  });
  it('posts Public and embed origins without a sign-in identity', async () => {
    const fetch = mockCrew(); const onStarted = vi.fn(); const app = detail(); app.spec.queries.forEach((q) => { q.public = true; });
    render(<PublishSheet detail={app} onClose={vi.fn()} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole('radio', { name: /Public/ })); fireEvent.click(screen.getByRole('checkbox', { name: 'Embed' }));
    fireEvent.change(screen.getByLabelText('Site address'), { target: { value: 'https://desk.test' } });
    fireEvent.change(screen.getByLabelText('Embed origins (comma separated)'), { target: { value: 'https://one.test, https://two.test' } });
    start(); await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toStrictEqual({ base: 3, targets: ['studio', 'site', 'embed'], site: { origin: 'https://desk.test' }, identity: null, audience: { kind: 'public' }, embedOrigins: ['https://one.test', 'https://two.test'] });
  });
  it.each([
    [409, 'stale_base', 'The app has a newer version.'], [409, 'not_accepted', 'This version has not been accepted.'],
    [409, 'busy', 'A turn or publish is already running'], [400, 'teams_not_offered', 'Microsoft Teams publishing is not offered.'],
  ])('shows the %s %s refusal in words', async (status, code, words) => {
    mockCrew({ code }, status as number);
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={vi.fn()} />); signedIn(); start();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(words));
    expect(screen.getByRole('alert').textContent).not.toContain(code);
  });
  it('lists every finding next to its setting', async () => {
    mockCrew({ code: 'publish_refused', findings: [
      { code: 'site_origin', message: 'The site address cannot be reached.' }, { code: 'issuer_unavailable', message: 'The sign-in issuer did not answer.' },
      { code: 'public_query', message: 'This query is not public.' }, { code: 'embed_origin', message: 'This embed origin is not allowed.' },
      { code: 'source_changed', message: 'The source changed. Check it again.' },
    ] }, 422);
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={vi.fn()} />); signedIn(); start();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(5));
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toStrictEqual([
      'The site address cannot be reached.', 'The sign-in issuer did not answer.', 'This query is not public.', 'This embed origin is not allowed.', 'The source changed. Check it again.',
    ]);
  });
  it('keeps the engine refusal message when a run cannot be seated', async () => {
    mockCrew({ error: 'Every available seat built this app. Choose another reviewer.' }, 409);
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={vi.fn()} />); signedIn(); start();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Choose another reviewer.'));
  });
  it.each([null, {}, { runId: 4 }, { runId: '' }])('does not open a run from a malformed response %j', async (answer) => {
    mockCrew(answer); const onStarted = vi.fn();
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={onStarted} />); signedIn(); start();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Crew did not return a publish run.'));
    expect(onStarted).not.toHaveBeenCalled();
  });
  it.each(['https://site.test/path', 'http://site.test', 'https://user:pass@site.test', 'https://site.test?q=x', 'https://site.test/#x'])('refuses an invalid site address %s without posting', async (site) => {
    const fetch = mockCrew();
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={vi.fn()} />); signedIn();
    fireEvent.change(screen.getByLabelText('Site address'), { target: { value: site } }); start();
    expect(screen.getByRole('alert').textContent).toContain('Use an HTTPS origin'); expect(fetch).not.toHaveBeenCalled();
  });
  it('requires the issuer, client id, audience and Entra tenant id', () => {
    const fetch = mockCrew();
    render(<PublishSheet detail={detail()} onClose={vi.fn()} onStarted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Audience rule'), { target: { value: 'entra-roles' } }); start();
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(/HTTPS issuer URL.*client id.*tenant id.*at least one group/u);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['', 'http://localhost:8080', 'https://embed.test/path'])('requires HTTPS origins for an embed (%s)', (origin) => {
    const fetch = mockCrew(); const app = detail(); app.spec.queries.forEach((q) => { q.public = true; });
    render(<PublishSheet detail={app} onClose={vi.fn()} onStarted={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Public/ })); fireEvent.click(screen.getByRole('checkbox', { name: 'Embed' }));
    fireEvent.change(screen.getByLabelText('Embed origins (comma separated)'), { target: { value: origin } }); start();
    expect(screen.getByRole('alert').textContent).toContain('HTTPS origin for every page'); expect(fetch).not.toHaveBeenCalled();
  });
  it('allows HTTPS origins and the two local HTTP origins', () => {
    for (const origin of ['https://site.test', 'http://localhost:8080', 'http://127.0.0.1:8080']) expect(publishOrigin(origin)).toBe(origin);
    expect(publishOrigin('not a URL')).toBeNull();
  });
});

describe('Share publish states and artifacts', () => {
  it.each([[3, 'Publish again'], [4, 'Publish v4']])('offers the publish action for head v%s', (head, label) => {
    const app = detail(); app.head.version = head as number;
    render(<ShareSheet name="Desk" slug="desk" detail={app} published={publishedOf({ published: published() })} publishEnabled onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: label as string }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: label as string }));
    expect(screen.getByRole('dialog').textContent).toContain(`Publish Desk · v${head}`);
  });
  it('disables Publish when the container capability is false and explains why', () => {
    render(<ShareSheet name="Desk" slug="desk" detail={detail()} published={null} publishEnabled={false} onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish needs a container engine (Docker or Rancher Desktop) running on this computer, and a wicked-crew that can publish.')).toBeTruthy();
  });
  it('honors the host’s reason for disabling publish', () => {
    render(<ShareSheet name="Desk" slug="desk" detail={detail()} published={null} publishEnabled publishDisabledWhy="Restore this app before publishing." onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Restore this app before publishing.')).toBeTruthy();
  });
  it('shows crew’s artifacts and builds the docker run command from the published run', () => {
    const p = publishedOf({ published: published() })!;
    render(<ShareSheet name="Desk" slug="desk" detail={detail()} published={p} publishEnabled onClose={vi.fn()} />);
    expect((screen.getByLabelText('Image tag') as HTMLInputElement).value).toBe(p.image!.tag);
    expect((screen.getByLabelText('Image id') as HTMLInputElement).value).toBe(p.image!.id);
    expect((screen.getByLabelText('Run the image') as HTMLTextAreaElement).value).toBe("docker run --rm -p 8080:8080 -e 'APPS_SRC_SUPPORT_PASSWORD' -e 'APPS_SRC_API_TOKEN' -v apps-data:/data 'wicked-apps/desk:v3-abc'");
    expect((screen.getByLabelText('Embed in a page') as HTMLTextAreaElement).value).toBe(p.snippet);
    expect(dockerRun({ ...p, run: { env: [], volume: null, port: 9000 } })).toBe("docker run --rm -p 9000:9000 'wicked-apps/desk:v3-abc'");
    expect(dockerRun({ ...p, image: { tag: "image'$(echo bad)", id: 'x' } })).toContain("'image'\\''$(echo bad)'");
  });
  it.each([{ env: ['BAD; echo bad'], volume: null, port: 8080 }, { env: [], volume: '/other', port: 8080 }, { env: [], volume: null, port: 0 }])('omits malformed run details %j', (run) => {
    const p = publishedOf({ published: { ...published(), run } })!;
    expect(dockerRun(p)).toBeNull();
  });
  it('refreshes a published record without a change to the app’s head', async () => {
    const store = new SampleAppStore('desk', detail().spec); const session = new AppSession(store);
    const original = await session.load(); const p = published();
    vi.spyOn(store, 'detail').mockResolvedValue({ ...original, published: p }); const changed = vi.fn(); session.on(changed);
    await session.refresh(); expect(session.detail!.published).toStrictEqual(p); expect(changed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'head' }));
    session.dispose();
  });
});

// These are the same gate renderers used by turns; the test inspects real gate controls in the app thread.
describe('Publish gates in the app thread', () => {
  it('shows a publish run for this app, reuses the run gate, and keeps other apps out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(String(input).includes('/roster') ? { roster: [] } : { events: [], servers: [], discovered: [] }), { status: 200 }));
    const view = { session: { id: 'publish-r', workflow_id: 'apps-publish', repo_ref: 'desk', status: 'awaiting_human', clis: ['claude', 'codex'], unit_ix: 2, human_confirm: 'none' }, units: [
      { id: 'publish-r:check', ord: 1, status: 'done', description: 'Publish check', phase: 'check' },
      { id: 'publish-r:qe', ord: 2, status: 'done', description: 'QE acceptance', phase: 'qe' },
      { id: 'publish-r:produce', ord: 3, status: 'pending', description: 'Produce', phase: 'produce' },
    ] } as unknown as SessionView;
    useRunEventStore.setState({ byRun: { 'publish-r': [] } });
    useGateStore.getState().setGate({ runId: 'publish-r', ord: 3, prompt: 'Approve publishing this app for the selected audience?', lifecycle: 'open', receivedAt: Date.now(), gateKind: 'consent' });
    const props = { slug: 'desk', detail: detail(), runs: [view, { ...view, session: { ...view.session, id: 'other', repo_ref: 'other-app' } }], framed: false, navigate: vi.fn(), onSent: vi.fn(), onUndo: vi.fn() };
    const { rerender } = render(<AppChat {...props} />);
    const thread = screen.getByTestId('app-chat-thread'); expect(within(thread).getAllByTestId('app-chat-publish')).toHaveLength(1);
    expect(within(thread).getByLabelText('Publish steps').textContent).toContain('Publish checkQE acceptanceYour consent');
    await waitFor(() => expect(within(thread).getByTestId('session-gate-row')).toBeTruthy());
    expect(within(thread).getByTestId('session-gate-row').textContent).toContain('Approve');
    rerender(<AppChat {...props} framed />);
    expect(within(thread).queryByTestId('session-gate-row')).toBeNull();
    await act(async () => {});
  });
});
