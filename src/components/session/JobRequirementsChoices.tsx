import { useState } from 'react';
import type { ArtifactProposal } from '../../api/types.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { COMPOSE_MAX, reqKey, RequirementsBrowser, type ChosenRequirement } from '../product/RequirementsBrowser.js';
import { goToPath } from '../QeRefusalWarning.js';

/** Crew asks about the first required missing need. */
export function asksForRequirements(p: Pick<ArtifactProposal, 'question' | 'needs'>): boolean {
  const q = p.question;
  if (q == null || q.kind !== 'missing' || q.choices.length > 0 || q.input !== undefined) return false;
  return p.needs?.find((n) => n.required && n.status === 'missing')?.kind === 'requirements';
}

/** The project's requirements, picked explicitly for this version of the job. */
export function JobRequirementsChoices({ proposal, disabled, onPick, navigate }: {
  proposal: ArtifactProposal;
  disabled: boolean;
  onPick: (refs: Array<{ repoId: string; key: string }>) => void;
  navigate?: Navigate | undefined;
}): React.ReactElement {
  const project = proposal.filedIn?.projectId ?? proposal.needs?.find((n) => n.kind === 'project' && n.status === 'met')?.value ?? null;
  const [chosen, setChosen] = useState<ReadonlyMap<string, ChosenRequirement>>(new Map());
  if (project === null) return <p className="wk-pass-sub">Pick a project first: requirements belong to a project.</p>;
  const href = `/projects/${encodeURIComponent(project)}/requirements`;
  return (
    <div className="wk-pass-sub">
      <div style={{ maxHeight: '24rem', overflowY: 'auto' }}>
        <RequirementsBrowser projectId={project} navigate={navigate ?? goToPath} selection={{ chosen, max: COMPOSE_MAX,
          onToggle: (row) => {
            if (disabled) return;
            setChosen((prev) => {
              const next = new Map(prev);
              const key = reqKey(row.repoId, row.key);
              if (next.has(key)) next.delete(key);
              else if (next.size < COMPOSE_MAX) next.set(key, row);
              return next;
            });
          },
        }} />
      </div>
      <div className="wk-pass-acts" style={{ marginTop: 8 }}>
        <button type="button" data-testid="job-passage-requirements-use" className="wk-btn wk-btn--primary wk-btn--sm"
          disabled={disabled || chosen.size === 0}
          onClick={() => onPick([...chosen.values()].map(({ repoId, key }) => ({ repoId, key })))}>
          {chosen.size === 0 ? 'Use the requirements you pick' : `Use ${chosen.size} ${chosen.size === 1 ? 'requirement' : 'requirements'}`}
        </button>
        {navigate !== undefined && <a href={href} className="wk-link" onClick={(e) => { e.preventDefault(); navigate(href); }}>Open the requirements page</a>}
      </div>
    </div>
  );
}
