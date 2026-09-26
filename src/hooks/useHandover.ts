import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { AuditEntry, SessionView } from '../api/types.js';
import { handoverSections, type HandoverSection } from '../board/handover.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { useVisitStore } from '../store/visit.js';

export interface Handover {
  /** The absence being handed over — null when there is nothing to hand over. */
  since: number | null;
  sections: HandoverSection[];
  dismiss: () => void;
}

/**
 * The handover's behaviour (studio wave 2b): open while the visit store holds an
 * undismissed absence; its sections fold live from the run list and stores, plus ONE
 * `GET /audit?since=` read per absence (null when the daemon cannot answer — the
 * "system" section then says so instead of claiming the system did nothing).
 */
export function useHandover(runs: readonly SessionView[], failedAt: Record<string, number>): Handover {
  const handover = useVisitStore((s) => s.handover);
  const dismiss = useVisitStore((s) => s.dismiss);
  const gates = useGateStore((s) => s.gates);
  const elicitations = useElicitationStore((s) => s.elicitations);
  const projectIds = useMembershipStore((s) => s.projectIdByRun);
  const since = handover?.since ?? null;
  const [audit, setAudit] = useState<{ since: number; entries: AuditEntry[] | null } | null>(null);

  useEffect(() => {
    if (since === null) return;
    let cancelled = false;
    api
      .getAuditSince(since)
      .then(({ entries }) => { if (!cancelled) setAudit({ since, entries }); })
      .catch(() => { if (!cancelled) setAudit({ since, entries: null }); });
    return () => { cancelled = true; };
  }, [since]);

  const sections = useMemo(
    () =>
      since === null
        ? []
        : handoverSections({
            runs,
            gates,
            elicitations,
            failedAt,
            projectIds,
            audit: audit !== null && audit.since === since ? audit.entries : null,
            since,
          }),
    [since, runs, gates, elicitations, failedAt, projectIds, audit],
  );

  return { since, sections, dismiss };
}
