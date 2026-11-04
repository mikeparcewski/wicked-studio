// (DES-APPS-001 §9.3, mockup state D; lane K6) The Publish sheet: what it sends, what it shows while the run works and
// after it, and the share link only from crew's record. The daemon is a fetch stub.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppDetail } from '../src/api/types.js';
import { publishedExtrasOf, siteOriginProblem } from '../src/api/appsPublish.js';
import { PublishSheet } from '../src/components/apps/PublishSheet.js';
import { ShareSheet } from '../src/components/apps/ShareSheet.js';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

const detail = (extra: Partial<AppDetail> & { actions?: boolean } = {}): AppDetail => ({
  slug: 'esc', name: 'Escalations', projectId: 'p', repoId: 'esc', createdAt: 1,
  head: { version: 14, tree: 't', receipt: 'reviewed' }, turn: null, published: null,
  spec: {
    schema: 'wicked.apps/v1', name: 'Escalations', pages: [], linkHosts: [],
    queries: [{ id: 'open', source: 'support-pg', kind: 'sql', output: [{ name: 'n', type: 'integer' }] }],
    actions: extra.actions === false ? [] : [{ id: 'assign_to_me', kind: 'row-write', source: 'support-pg-writer', table: 'support.tickets', op: 'update', set: { owner: { kind: 'viewer', claim: 'email' } }, key: { id: { kind: 'param', name: 'id' } } }],
  },
  lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: {}, versions: [], history: { states: [], pointer: 0, canUndo: false, canRedo: false },
  ...extra,
} as unknown as AppDetail);

const type = (id: string, value: string): void => { fireEvent.change(screen.getByTestId(id), { target: { value } }); };

describe('the Publish sheet', () => {
  it('Start waits for the site address and the sign-in; it sends exactly the settings, then shows the run', async () => {
    const posted: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      posted.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(JSON.stringify({ runId: 'apps-publish-esc-0123456789ab', manifestDigest: 'd' }), { status: 202, headers: { 'content-type': 'application/json' } });
    });
    render(<PublishSheet detail={detail()} reload={vi.fn(async () => detail())} onClose={vi.fn()} openRun={vi.fn()} pollMs={50} />);
    const start = screen.getByTestId('apps-publish-start') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId('apps-publish-problem').textContent).toMatch(/site address/);
    type('apps-publish-origin', 'https://escalations.example.com');
    type('apps-publish-issuer', 'https://dex.apps.test');
    type('apps-publish-client', 'escalations-site');
    type('apps-publish-values', 'support-ops, sre');
    expect(start.disabled).toBe(false);
    // An app with an action cannot be public; the embed needs a public app.
    expect((screen.getByTestId('apps-publish-public') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('apps-publish-embed-on') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/APPS_SRC_SUPPORT_PG_PASSWORD/)).toBeTruthy();
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByTestId('apps-publish-running')).toBeTruthy());
    expect(posted).toEqual([{ base: 14, targets: ['site'], site: { origin: 'https://escalations.example.com' }, identity: { profile: 'oidc', issuer: 'https://dex.apps.test', clientId: 'escalations-site' }, audience: { kind: 'oidc-groups', groups: ['support-ops', 'sre'] } }]);
  });

  it('the publish check`s findings are shown, and nothing runs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'check_failed', error: 'refused', findings: [{ stage: 'publish', code: 'not_granted', path: '$', message: 'action assign_to_me is not granted: grant it in the data panel, or remove it' }] }), { status: 422, headers: { 'content-type': 'application/json' } }));
    render(<PublishSheet detail={detail()} reload={vi.fn(async () => detail())} onClose={vi.fn()} />);
    type('apps-publish-origin', 'https://escalations.example.com');
    type('apps-publish-issuer', 'https://dex.apps.test');
    type('apps-publish-client', 'c');
    type('apps-publish-values', 'support-ops');
    fireEvent.click(screen.getByTestId('apps-publish-start'));
    await waitFor(() => expect(screen.getAllByTestId('apps-publish-finding')).toHaveLength(1));
    expect(screen.getByTestId('apps-publish-finding').textContent).toMatch(/not granted/);
    expect(screen.queryByTestId('apps-publish-running')).toBeNull();
  });

  it('when THIS run produced it, the sheet shows the share link, the Teams package and how to run the image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ runId: 'apps-publish-esc-0123456789ab', manifestDigest: 'd' }), { status: 202, headers: { 'content-type': 'application/json' } }));
    const done = detail({ published: { version: 14, tree: 't', runId: 'apps-publish-esc-0123456789ab', at: 1_762_160_400_000, actor: { id: 'priya', kind: 'human', trust: 'operator' }, targets: ['studio', 'site', 'teams'], shareUrl: 'https://escalations.example.com/', audience: 'People with app role Apps.Viewer who sign in at login.microsoftonline.com', image: { tag: 'wicked-apps/esc:v14-0123456789ab', id: 'sha256:x' }, snippet: null, teamsPackage: { url: '/api/v1/apps/esc/published/teams.zip', sha256: 'z' }, manifestDigest: 'd', run: { env: ['APPS_SRC_SUPPORT_PG_PASSWORD'], volume: '/data', port: 8080 } } } as never);
    const reload = vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue(done);
    render(<PublishSheet detail={detail()} reload={reload} onClose={vi.fn()} pollMs={20} />);
    type('apps-publish-origin', 'https://escalations.example.com');
    type('apps-publish-issuer', 'https://dex.apps.test');
    type('apps-publish-client', 'c');
    type('apps-publish-values', 'support-ops');
    fireEvent.click(screen.getByTestId('apps-publish-start'));
    await waitFor(() => expect(screen.getByTestId('apps-publish-done')).toBeTruthy(), { timeout: 2000 });
    expect((screen.getByTestId('apps-publish-link-field') as HTMLInputElement).value).toBe('https://escalations.example.com/');
    expect(screen.getByTestId('apps-publish-teams').getAttribute('href')).toMatch(/\/apps\/esc\/published\/teams\.zip$/);
    expect((screen.getByTestId('apps-publish-run-field') as HTMLInputElement).value).toBe('docker run -p 8080:8080 -e APPS_SRC_SUPPORT_PG_PASSWORD=… -v <volume>:/data wicked-apps/esc:v14-0123456789ab');
  });

  it('a public app (only public queries, no action) may be opened by anyone with the link, and then embedded', () => {
    const pub = detail({ actions: false });
    (pub.spec.queries[0] as { public?: boolean }).public = true;
    render(<PublishSheet detail={pub} reload={vi.fn(async () => pub)} onClose={vi.fn()} />);
    const radio = screen.getByTestId('apps-publish-public') as HTMLInputElement;
    expect(radio.disabled).toBe(false);
    fireEvent.click(radio);
    expect((screen.getByTestId('apps-publish-embed-on') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('Share with Publish', () => {
  it('offers Publish when crew publishes, and says plainly when it does not', () => {
    const onPublish = vi.fn();
    const { unmount } = render(<ShareSheet name="Desk" slug="desk" published={null} onClose={vi.fn()} onPublish={onPublish} />);
    const b = screen.getByTestId('apps-share-publish') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onPublish).toHaveBeenCalledTimes(1);
    unmount();
    render(<ShareSheet name="Desk" slug="desk" published={null} onClose={vi.fn()} />);
    expect((screen.getByTestId('apps-share-publish') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the publish wire helpers', () => {
  it('a site address is a bare https origin (http only for localhost)', () => {
    expect(siteOriginProblem('https://a.example.com')).toBeNull();
    expect(siteOriginProblem('http://localhost:8443')).toBeNull();
    for (const bad of ['http://a.example.com', 'https://a.example.com/x', 'https://u:p@a.example.com', 'nope']) expect(siteOriginProblem(bad), bad).not.toBeNull();
  });

  it('the Teams download is taken only in crew`s exact shape', () => {
    expect(publishedExtrasOf({ published: { teamsPackage: { url: '/api/v1/apps/esc/published/teams.zip' } } })?.teamsUrl).toBe('/api/v1/apps/esc/published/teams.zip');
    for (const url of ['https://evil.example/x.zip', '/api/v1/apps/../../x', 'javascript:alert(1)']) expect(publishedExtrasOf({ published: { teamsPackage: { url } } })?.teamsUrl, url).toBeNull();
  });
});
