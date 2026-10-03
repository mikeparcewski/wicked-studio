import { useEffect, useState } from 'react';
import { rulePath, type DecisionView } from '../../api/decisions.js';
import { deskRuleSentence } from '../../board/decisionLine.js';
import { useDecisionsStore } from '../../store/decisions.js';
import { useProjectsStore } from '../../store/projects.js';
import { useVisitStore } from '../../store/visit.js';
import type { Navigate } from '../../hooks/useRoute.js';

/**
 * B9 (DC-S6): the Desk's one sentence about a rule remembered since the operator last looked —
 * "One new rule for Kestrel, from your words — see it". Read from `GET /decisions?state=
 * remembered&since=` against the visit clock (`studio.visit`); absent when nothing was remembered
 * since then, and on a daemon without decisions. Said once: it rides the same clock the handover
 * does, so the next visit shows nothing new.
 */
export function DeskRuleLine({ navigate }: { navigate: Navigate }): React.ReactElement | null {
  const mode = useDecisionsStore((s) => s.mode);
  const byId = useDecisionsStore((s) => s.byId);
  const since = useVisitStore((s) => s.handover?.since ?? s.lastSeenAt);
  const projects = useProjectsStore((s) => s.projects);
  // The read names WHICH decisions were remembered since; their current state is the store's (an
  // Undo here or elsewhere retires one, and the sentence follows).
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (mode !== 'on') { setIds([]); return; }
    let cancelled = false;
    void useDecisionsStore.getState().loadRemembered(since).then((d) => { if (!cancelled) setIds(d.map((x) => x.id)); });
    return () => { cancelled = true; };
  }, [mode, since]);
  const fresh: DecisionView[] = ids.map((id) => byId[id]).filter((d): d is DecisionView => d !== undefined);
  // Only under `on`: `ledger` records and labels but never offers or remembers, so there is nothing to say.
  const line = mode === 'on' ? deskRuleSentence(fresh, since, (id) => (id === null ? null : projects.find((p) => p.id === id)?.name ?? null)) : null;
  if (line === null) return null;
  const href = line.ruleId !== null ? rulePath(line.ruleId) : '/steering/policies';
  return (
    <p data-testid="desk-rule-line" className="wk-desk-rule">
      {line.text}
      {' — '}
      <a href={href} data-testid="desk-rule-see" onClick={(e) => { e.preventDefault(); navigate(href); }} className="wk-since-toggle">see it</a>
    </p>
  );
}
