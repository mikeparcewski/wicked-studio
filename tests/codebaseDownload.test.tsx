import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodebaseDownload, DeliverCredentialsNotice, codebaseHref } from '../src/components/session/CodebaseDownload.js';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { hasDeliverySection } from '../src/components/delivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { makeUnit, makeView } from './factories.js';
import type { CodebaseArchive, DeliverCredentials, SessionStatus, SessionView, SessionWithDelivery } from '../src/api/types.js';

/**
 * crew#720: "Download code (.zip)" is offered in EVERY outcome the run carries an archive for, and a
 * deliver phase that refused for want of the provider credential says so, naming what to set.
 */

const ARCHIVE: CodebaseArchive = {
  url: '/api/v1/runs/r-zip/artifacts/codebase.zip',
  sha256: 'a'.repeat(64),
  bytes: 4096,
  tree: 'b'.repeat(40),
  commit: 'c'.repeat(40),
  created_at: 1_760_000_000_000,
  trigger: 'deliver',
  source: 'worktree',
};

function viewWith(status: SessionStatus, extra: { codebase_archive?: CodebaseArchive; deliver_credentials?: DeliverCredentials }): SessionView {
  const v = makeView({ id: 'r-zip', workflow_id: 'feature', status, problem: 'Ship it' }, [makeUnit({ id: 'r-zip:deliver', session_id: 'r-zip', ord: 1, status: 'rejected', phase_ref: 'deliver' })]);
  Object.assign(v.session, extra);
  return v;
}

afterEach(cleanup);

describe('crew#720 the final-codebase zip + the credentials-missing state', () => {
  for (const status of ['completed', 'failed', 'awaiting_human', 'cancelled'] as const) {
    it(`offers "Download code (.zip)" with its sha256 on a ${status} run`, () => {
      render(<CodebaseDownload view={viewWith(status, { codebase_archive: ARCHIVE })} />);
      const link = screen.getByTestId('run-codebase-zip-link');
      expect(link.textContent).toBe('Download code (.zip)');
      expect(link.getAttribute('href')).toBe(codebaseHref(ARCHIVE.url));
      expect(link.getAttribute('href')).toMatch(/\/api\/v1\/runs\/r-zip\/artifacts\/codebase\.zip$/);
      expect(link.getAttribute('download')).toBe('r-zip-codebase.zip');
      expect(screen.getByTestId('run-codebase-zip-sha').textContent).toBe('a'.repeat(12));
      expect(screen.getByTestId('run-codebase-zip').textContent).toContain('4 KB');
    });
  }

  it('renders nothing without an archive', () => {
    const { container } = render(<CodebaseDownload view={viewWith('completed', {})} />);
    expect(container.innerHTML).toBe('');
  });

  it('says Azure DevOps credentials are not configured and names what to set', () => {
    render(
      <DeliverCredentialsNotice
        view={viewWith('awaiting_human', {
          deliver_credentials: {
            provider: 'azure_devops',
            status: 'missing',
            source: null,
            missing: ['CREW_ADO_TENANT_ID', 'CREW_ADO_CLIENT_ID', 'CREW_ADO_CLIENT_SECRET', 'AZURE_DEVOPS_EXT_PAT'],
            message: 'Azure DevOps credentials not configured: set …',
          },
        })}
      />,
    );
    const n = screen.getByTestId('run-deliver-credentials');
    expect(n.getAttribute('role')).toBe('alert');
    expect(n.getAttribute('data-provider')).toBe('azure_devops');
    expect(n.textContent).toContain('Azure DevOps credentials not configured');
    expect(n.textContent).toContain('AZURE_DEVOPS_EXT_PAT');
    expect(n.textContent).toContain('approve the deliver gate to retry');
  });

  it('the same shape for GitHub', () => {
    render(
      <DeliverCredentialsNotice
        view={viewWith('awaiting_human', {
          deliver_credentials: { provider: 'github', status: 'missing', source: null, missing: ['gh auth login', 'GH_TOKEN'], message: 'GitHub credentials not configured: …' },
        })}
      />,
    );
    expect(screen.getByTestId('run-deliver-credentials').textContent).toContain('GitHub credentials not configured');
  });

  it('is silent when the credential is configured or absent from the record', () => {
    const { container } = render(
      <DeliverCredentialsNotice view={viewWith('completed', { deliver_credentials: { provider: 'github', status: 'configured', source: 'gh_token', missing: [], message: 'ok' } })} />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('crew#720 the run record (RunDelivery) carries the zip in every claim', () => {
  it.each([
    ['pushed', 'completed', 'done'],
    ['failed', 'failed', 'rejected'],
    ['stranded', 'completed', 'rejected'],
  ] as const)('delivery %s', (delivery, status, unitStatus) => {
    useDeliveryStore.setState({ byRun: {} });
    usePostHocDeliverStore.setState({ byRun: {} });
    const v = makeView({ id: 'r-zip', workflow_id: 'feature', status, workdir: '/w/trees/r-zip', repo_ref: 'repo' }, [
      makeUnit({ id: 'r-zip:deliver', session_id: 'r-zip', ord: 1, status: unitStatus, denial_reason: unitStatus === 'rejected' ? 'deliver: the remote refused the push' : null }),
    ]);
    const s = v.session as SessionWithDelivery;
    s.delivery = delivery === 'failed' ? 'none' : delivery;
    if (delivery === 'pushed') {
      s.deliverBranch = 'wicked/r-zip';
      s.deliverRemote = '/srv/remote.git';
    }
    Object.assign(v.session, { codebase_archive: ARCHIVE });
    render(<RunDelivery view={v} />);
    expect(screen.getByTestId('run-delivery-codebase-zip-link').textContent).toBe('Download code (.zip)');
  });
});

it('crew#720: a run with an archive always has the Delivery section (a free-text run that failed included)', () => {
  const v = makeView({ id: 'r-ft', workflow_id: 'wf-r-ft', status: 'failed', workdir: null, repo_ref: 'repo' }, []);
  expect(hasDeliverySection(v)).toBe(false);
  Object.assign(v.session, { codebase_archive: ARCHIVE });
  expect(hasDeliverySection(v)).toBe(true);
});
