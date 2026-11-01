import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isProposalsUnsupported, listProposals, memoryPayload, policyPayload, policySteeringType, type Proposal } from '../api/proposals.js';
import { readErrorKind } from '../api/errors.js';
import { notAccepted } from '../board/notAccepted.js';
import { relTime } from '../board/relTime.js';
import { sessionPath } from '../board/sessionModel.js';
import { shortDate } from '../board/calmMemory.js';
import { severityWord, shortContent } from './ProposalChips.js';
import { StateBanner, TechDetails } from './ui/index.js';
import { CalmEmpty, CalmFacts, CalmLoading, CalmRow, CalmRows } from './calm/Calm.js';

type Read = { kind: 'loading' } | { kind: 'ok'; all: Proposal[] } | { kind: 'unsupported' } | { kind: 'failed'; error: unknown };

const cap = (w: string): string => (w === '' ? w : w.charAt(0).toUpperCase() + w.slice(1));

/**
 * The Not accepted list (Memory and Steer): what a person turned down, kept by the store and read back
 * from `GET /proposals` (every state; `board/notAccepted.ts` says what is left out and why). Read only:
 * crew has no way to reopen a rejected proposal.
 */
export function NotAcceptedList({ kind, revision = 0, projectName }: {
  kind: 'memory' | 'policy';
  /** Bumped by the host (its Refresh, or a decision in Proposed) to read the queue again. */
  revision?: number;
  /** A project id's name, for where a memory would have been recalled. */
  projectName?: ((id: string) => string | null) | undefined;
}): React.ReactElement {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const gen = useRef(0);
  const load = useCallback((): void => {
    const mine = ++gen.current;
    void listProposals()
      .then((all) => { if (mine === gen.current) setRead({ kind: 'ok', all }); })
      .catch((e: unknown) => { if (mine === gen.current) setRead(isProposalsUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', error: e }); });
  }, []);
  useEffect(() => { load(); }, [load, revision]);
  const folded = useMemo(() => (read.kind === 'ok' ? notAccepted(read.all, kind) : null), [read, kind]);
  const noun = kind === 'memory' ? 'memory' : 'rule';

  if (read.kind === 'loading') return <CalmLoading data-testid="not-accepted-loading" rows={3} label="Reading what was turned down" />;
  if (read.kind === 'unsupported') {
    return <CalmEmpty data-testid="not-accepted-unsupported" title="This crew can’t list proposals yet." body={<p>Turned-down proposals show here once it can.</p>} />;
  }
  if (read.kind === 'failed') {
    return <StateBanner data-testid="not-accepted-error" kind={readErrorKind(read.error)} what="the proposals that were turned down"
      error={read.error instanceof Error ? read.error.message : String(read.error)} onRetry={() => { setRead({ kind: 'loading' }); load(); }} />;
  }
  const { rows, replaced } = folded ?? { rows: [], replaced: 0 };
  const replacedLine = replaced > 0
    ? `${replaced} ${replaced === 1 ? 'proposal' : 'proposals'} you accepted with an edit ${replaced === 1 ? 'is' : 'are'} not listed: ${replaced === 1 ? 'its' : 'their'} edited words were kept.`
    : null;

  const row = (p: Proposal): React.ReactElement => {
    const words = kind === 'memory' ? memoryPayload(p).content : policyPayload(p).rule;
    const text = words ?? (kind === 'memory' ? 'A memory with no words' : 'A rule with no words');
    const agent = p.provenance['run_agent'] ?? p.provenance['agent'] ?? p.provenance['helper'];
    const by = agent === undefined || agent === '' ? 'a helper' : agent === 'crew' ? 'crew' : agent;
    const run = p.provenance['run_id'];
    const project = p.facets['project'];
    const where = project !== undefined && project !== '' ? projectName?.(project) ?? `Project ${project}` : null;
    const type = kind === 'policy' ? policySteeringType(p) : null;
    const severity = kind === 'policy' ? policyPayload(p).severity : null;
    const what = kind === 'policy'
      ? [type === null ? 'Rule' : `${cap(type)} rule`, severity === null ? null : severityWord(severity)].filter((x): x is string => x !== null).join(', ')
      : 'Memory';
    const proposed = typeof p.created_at === 'number' && p.created_at > 0 ? p.created_at * 1000 : null;
    return (
      <CalmRow key={p.id} data-testid="not-accepted-row" data={{ 'proposal-id': p.id, kind }} tone="quiet"
        title={<span data-testid="not-accepted-text">{text}</span>} titleAttr={text}
        sub={<span data-testid="not-accepted-line">{[what, `proposed by ${by}`, where].filter((x): x is string => x !== null).join(' · ')}</span>}
        meta={proposed === null ? 'Not accepted' : `Proposed ${shortDate(proposed)}`}
        openTestId={/* testid */ 'not-accepted-open'} openLabel={`${shortContent(text)}: show details`}
        details={(
          <>
            <p>{text}</p>
            <CalmFacts facts={[
              { k: 'State', v: 'Not accepted: never kept, never recalled or enforced' },
              ...(proposed !== null ? [{ k: 'Proposed', v: relTime(proposed) }] : []),
              { k: 'Proposed by', v: by },
              ...(where !== null ? [{ k: 'For', v: where }] : []),
              ...(run !== undefined && run !== '' ? [{ k: 'Run', v: <a className="wk-link" data-testid="not-accepted-run" href={sessionPath(`run:${run}`)}>Open its run</a> }] : []),
            ]} />
            <TechDetails text={[`proposal_id: ${p.id}`, `kind_type: ${p.kind_type}`,
              ...Object.entries(p.provenance).map(([k, v]) => `${k}: ${String(v)}`),
              ...Object.entries(p.facets).map(([k, v]) => `${k}: ${String(v)}`)]} />
          </>
        )} />
    );
  };

  return (
    <div data-testid="not-accepted" data-kind={kind} data-count={rows.length}>
      {rows.length === 0 ? (
        <CalmEmpty data-testid="not-accepted-empty" title={`No ${noun} proposal was turned down.`}
          body={<p>{`When you reject a proposed ${noun}, it is kept and listed here for review.`}{replacedLine !== null ? ` ${replacedLine}` : ''}</p>} />
      ) : (
        <>
          <CalmRows data-testid="not-accepted-list" label={`${cap(noun)} proposals not accepted`}>{rows.map(row)}</CalmRows>
          <p className="wk-calm-foot" data-testid="not-accepted-count" data-count={rows.length}>
            {`${rows.length} not accepted`}{replacedLine !== null ? ` · ${replacedLine}` : ''}
          </p>
        </>
      )}
    </div>
  );
}
