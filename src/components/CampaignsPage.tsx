import { useEffect } from 'react';
import { campaignPath, testingPath } from '../api/testing.js';
import { useCampaignsStore } from '../store/campaigns.js';

/**
 * `/testing/campaigns` (MOVED from the flat `/campaigns`, which redirects here) — every
 * campaign, active and finished, newest-updated first (DES-CAMPAIGN-001
 * §3.5's escape hatch, exactly as `/runs` is for the board). Read-only (TH-14): each row is
 * the campaign's progress readout and a link into its scoreboard; zero requests beyond the
 * store's one `GET /campaigns`.
 *
 * The §1.5 probe renders in three honest states — probing / supported / unsupported — never a
 * boolean, so "not probed yet" cannot read as "not supported". Unsupported names the fact
 * (this daemon predates campaigns), not an error.
 */

interface Props {
  navigate: (path: string) => void;
}

export function CampaignsPage({ navigate }: Props): React.ReactElement {
  const support = useCampaignsStore((s) => s.support);
  const summaries = useCampaignsStore((s) => s.summaries);
  const refresh = useCampaignsStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (support === 'unknown') {
    return (
      <div data-testid="campaigns-probing" style={{ padding: '32px', color: 'var(--ink-muted)' }}>
        Checking this daemon for campaigns…
      </div>
    );
  }
  if (support === 'unsupported') {
    return (
      <div data-testid="campaigns-unsupported" style={{ padding: '32px', color: 'var(--ink-muted)', maxWidth: '640px' }}>
        This daemon has no campaign surface — `GET /campaigns` is not served, which means the
        connected wicked-crew predates campaign grouping. Upgrade the daemon to group a
        multi-run effort's sibling runs here.
      </div>
    );
  }

  return (
    <div data-testid="campaigns-page" style={{ padding: '24px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--ink-high)', fontWeight: 600 }}>
        Campaigns
      </h1>
      {summaries.length === 0 ? (
        // Quick win #3 + review #6: plain words, and a way OUT of the dead end —
        // the Harness is where a campaign starts.
        <div data-testid="campaigns-empty" style={{ marginTop: '16px', color: 'var(--ink-muted)' }}>
          <p style={{ margin: 0 }}>
            Campaigns appear when you launch a run with a campaign label — start one from Harness.
          </p>
          <button
            type="button"
            data-testid="campaigns-empty-cta"
            onClick={() => navigate(testingPath('harness'))}
            style={{
              marginTop: '12px',
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Go to Harness
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {summaries.map((s) => {
            // §3.3 denominator honesty, same two strings as the scoreboard header.
            const progress =
              s.campaign.expected !== null
                ? `${s.counts.landed} of ${s.campaign.expected} landed`
                : `${s.counts.landed} of ${s.counts.filed} landed so far`;
            const attention =
              s.counts.awaitingHuman > 0 ? { word: `${s.counts.awaitingHuman} waiting on you`, color: 'var(--status-gate)' }
              : s.counts.failed > 0 ? { word: `${s.counts.failed} failed`, color: 'var(--status-fail)' }
              : s.counts.running > 0 ? { word: `${s.counts.running} running`, color: 'var(--status-run)' }
              : null;
            return (
              <button
                key={s.campaign.id}
                type="button"
                data-testid="campaign-row"
                data-campaign-id={s.campaign.id}
                onClick={() => navigate(campaignPath(s.campaign.id))}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '14px',
                  padding: '12px 14px',
                  textAlign: 'left',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--surface-raised)',
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                <span style={{ color: 'var(--ink-high)', fontWeight: 500 }}>
                  {s.campaign.title ?? s.campaign.id}
                </span>
                <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>{progress}</span>
                {attention !== null && (
                  <span style={{ color: attention.color, fontSize: 'var(--text-sm)' }}>{attention.word}</span>
                )}
                {s.projectIds.length > 0 && (
                  <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-xs)', marginLeft: 'auto' }}>
                    {s.projectIds.length === 1 ? '1 project' : `${s.projectIds.length} projects`}
                    {s.prs.length > 0 && ` · ${s.prs.length}${s.prsTruncated ? '+' : ''} PR${s.prs.length === 1 && !s.prsTruncated ? '' : 's'}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
