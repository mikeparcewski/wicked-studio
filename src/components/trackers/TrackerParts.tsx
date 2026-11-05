import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { sourcesPath, type McpServer } from '../../api/sources.js';
import { pmSystemOf, systemBadge, systemName, trackerRefusal, trackersApi, trackerTitle, trackerWhere, type PmSystem, type TrackerLink } from '../../api/trackers.js';

/** The tool's mark: J, GH, GL, ADO, each in its own colour, and its name for a screen reader. */
export function TrackerBadge({ system, small = false }: { system: PmSystem; small?: boolean }): React.ReactElement {
  return <span className={`wk-trk-sys${small ? ' wk-trk-sys--sm' : ''}`} data-system={system} role="img" aria-label={systemName(system)}>{systemBadge(system)}</span>;
}

/**
 * One tracker as a row: its mark, "BILL · Billing" (vendor text, rendered as text), where it lives ("Jira ·
 * acme.atlassian.net"), then what the card says about it (a state, where it comes from) and its action.
 */
export function TrackerRow({ tracker, readOnly = false, small = false, status, action, warn, 'data-testid': testId = 'tracker-row' }: {
  tracker: Pick<TrackerLink, 'system' | 'key' | 'label' | 'tenant' | 'tenantLabel'> & { id?: string };
  readOnly?: boolean;
  small?: boolean;
  status?: React.ReactNode;
  action?: React.ReactNode;
  warn?: React.ReactNode;
  'data-testid'?: string;
}): React.ReactElement {
  return (
    <div className={`wk-trk${readOnly ? ' wk-trk--ro' : ''}${small ? ' wk-trk--sm' : ''}`} data-testid={testId} data-key={tracker.key} data-system={tracker.system} {...(tracker.id !== undefined ? { 'data-link': tracker.id } : {})}>
      <TrackerBadge system={tracker.system} />
      <span className="wk-trk-t">
        <b>{trackerTitle(tracker)}</b>
        <span>{small ? systemName(tracker.system) : trackerWhere(tracker)}</span>
      </span>
      <span className="wk-trk-st">{status}</span>
      {action !== undefined && <span className="wk-trk-act">{action}</span>}
      {warn !== undefined && warn !== null && <span className="wk-trk-warn">{warn}</span>}
    </div>
  );
}

/** Where a tracker of a job's set comes from: "linked to Billing" or "through repo billing-api". */
export function FromTag({ via, children }: { via: 'project' | 'repo'; children: React.ReactNode }): React.ReactElement {
  return <span className="wk-trk-from" data-via={via}>{children}</span>;
}

/** A link's projection state, when it isn't current: Understand follows once estate holds it. */
export function ProjectionPill({ link }: { link: TrackerLink }): React.ReactElement | null {
  if (link.projection === 'current') return null;
  return link.projection === 'pending'
    ? <span className="wk-tag" data-testid="tracker-projection" data-state="pending">Adding to Understand…</span>
    : <span className="wk-tag wk-tag--warn" data-testid="tracker-projection" data-state="failed" title="Access already follows the link; crew retries adding it to Understand.">Not in Understand yet</span>;
}

/**
 * REMOVE (one link): sends `DELETE /tracker-links/:id`, then waits for crew's links again. The row stays as crew last
 * said (with "Removing…") until that answer lands, so the card never shows a removal crew did not make. This is the
 * ONLY caller of `trackersApi.unlink` (`tests/trackersHumanOnly.test.ts`), and it acts only on a click.
 */
export function RemoveLink({ link, onSettled, onError }: { link: TrackerLink; onSettled: () => Promise<void>; onError: (words: string | null) => void }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const remove = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await trackersApi.unlink(link.id);
    } catch (e) {
      onError(trackerRefusal(e, 'remove'));
    }
    try {
      await onSettled();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="tracker-remove" disabled={busy} aria-label={`Remove ${trackerTitle(link)}`} onClick={() => void remove()}>
      {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}

/** "Billing's agents can't use Azure DevOps yet. Open its Agents box" (Q-PM1: a link never ticks a switch). */
export function AgentsOffWarning({ who, link, navigate }: { who: string; link: TrackerLink; navigate: (path: string) => void }): React.ReactElement {
  const href = sourcesPath(link.source);
  return (
    <span data-testid="tracker-agents-off">
      <AlertTriangle size={13} aria-hidden />
      <span>{who}’s agents can’t use {link.source} yet.{' '}
        <a className="wk-link" href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}>Open its Agents box</a></span>
    </span>
  );
}

/** The registered PM sources (name and system), for the Link a tracker picker; `null` while reading. */
export function usePmSources(enabled: boolean): { sources: Array<{ name: string; system: PmSystem; server: McpServer }> | null; error: string | null } {
  const [state, setState] = useState<{ sources: Array<{ name: string; system: PmSystem; server: McpServer }> | null; error: string | null }>({ sources: null, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    trackersApi.pmSources().then(
      (raw) => {
        if (!live) return;
        const r = raw as { servers?: unknown } | null;
        // A registry answer this studio can't read is said, never shown as "no tool registered".
        if (!Array.isArray(r?.servers)) { setState({ sources: [], error: 'unreadable' }); return; }
        const servers = r.servers as McpServer[];
        setState({ sources: servers.flatMap((s) => { const system = pmSystemOf(s as { pm?: unknown }); return system === null ? [] : [{ name: s.name, system, server: s }]; }), error: null });
      },
      (e: unknown) => { if (live) setState({ sources: [], error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [enabled]);
  return state;
}
