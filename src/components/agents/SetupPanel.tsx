import { useCallback, useEffect, useId, useState } from 'react';
import { useNewWorkSeats } from '../../store/newWorkSeats.js';
import { Check } from 'lucide-react';
import { setPickedForNewWork } from './useAgentRows.js';
import { deliveryStep, goodEnough, newWorkHelpers, setupAgents, setupMove, setupSteps, skillsWords, withRowRuntime } from '../../board/firstUse.js';
import { authOf, commandDisplay, type AgentRow } from '../../board/agentsModel.js';
import { runtimeStart } from '../../board/agentsCopy.js';
import { displayText } from '../../board/homePath.js';
import { getSetupKnown } from '../../api/learn.js';
import { useComposerPrefsStore } from '../../store/composerPrefs.js';
import { Command } from './CommandLine.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useFirstUseReads } from '../../store/firstUseReads.js';
import { NewProjectModal } from '../NewProjectModal.js';

/**
 * THE SETUP STEPS (DES-seats-page §5.2), above the Agents table on first use (`?setup=1`). Each
 * step's done state reads the same predicates as the landing rule (board/firstUse.ts), so the steps
 * never promise more than the completion rule checks. Reaching "good enough" here persists
 * `studio.setup.completedAt` once; "Skip setup" persists `skippedAt`. Both send studio to the Desk.
 */

function names(rows: readonly AgentRow[]): string {
  const n = rows.map((r) => r.name);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** Turn one agent on for new work in crew's pool. */
function pickForNewWork(rows: readonly AgentRow[], key: string): void {
  setPickedForNewWork(rows, key, true);
}

/** A command crew named, with Copy (the Agents modal's own command line). */
function CopyLine({ line, label }: { line: string; label: string }): React.ReactElement {
  return <Command c={{ line, display: commandDisplay(line), label }} />;
}

/** crew#1527: crew's delivery readiness (`GET /setup/known` `delivery`): `undefined` while read, `null` when it could
 *  not be read (an older service, or a read that failed). */
type DeliveryRead = unknown;

function Step({ n, done, testId, state, children }: { n: number; done: boolean; testId: string; state?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <li data-testid={testId} data-done={done} {...(state !== undefined ? { 'data-state': state } : {})} className={`wk-agents-setup-step${done ? ' wk-agents-setup-step--done' : ''}`}>
      <span aria-hidden className="wk-agents-setup-n">{done ? <Check size={14} /> : n}</span>
      <div>{children}</div>
    </li>
  );
}

export function SetupPanel({ rows, open, navigate, helpersKnown = true }: {
  rows: readonly AgentRow[];
  helpersKnown?: boolean;
  /** Open one agent's modal (keeps the setup steps open behind it). */
  open: (key: string) => void;
  navigate: Navigate;
}): React.ReactElement {
  const titleId = useId();
  const f = useFirstUseReads();
  const newWorkSeats = useNewWorkSeats();
  const [creating, setCreating] = useState(false);

  // crew#1527: whether a pull request can open before the first job, read once here and on Check again.
  const [delivery, setDelivery] = useState<DeliveryRead | undefined>(undefined);
  const readDelivery = useCallback((): void => {
    setDelivery(undefined);
    getSetupKnown().then((k) => setDelivery((k as { delivery?: unknown }).delivery ?? null), () => setDelivery(null));
  }, []);
  useEffect(() => { readDelivery(); }, [readDelivery]);
  const deliverPr = useComposerPrefsStore((s) => s.prefs.deliverPr);
  const setDeliverPr = useComposerPrefsStore((s) => s.update);
  const deliver = deliveryStep(delivery === undefined ? null : delivery, deliverPr);

  const checks = withRowRuntime(f.checks, rows);
  // crew#1844: a cluster never set up names its own command (crew fills in this computer's engine and state home).
  const noCluster = checks.downReason !== null && runtimeStart(checks.downReason).command !== null ? runtimeStart(checks.downReason) : null;
  const skills = f.checks.skillsReading;
  const facts = { rows, repos: f.repos, projects: f.projects, checks };
  const steps = setupSteps(facts);
  const counted = setupAgents(rows);
  const helperReadingKnown = helpersKnown && (steps.agentsDone || rows.every((r) => authOf(r.seat) !== 'unknown'));
  const ready = newWorkSeats.loaded && !newWorkSeats.saving && helperReadingKnown && f.state === 'ok' && f.counted && goodEnough(facts);
  // Good enough, reached here: persist it once (§5.1); from then on studio opens on the Desk.
  // A failed write is not retried on its own (no loop): the steps say so, and the next app load tries again.
  useEffect(() => {
    if (ready && f.setup.completedAt === undefined && f.setup.skippedAt === undefined && !f.saveFailed) void f.save({ completedAt: Date.now() });
  }, [ready, f]);

  // The counts are a reading like any other (real-data gate, 2026-10-13): until they answer, step 3 says
  // it is checking, never "not done"; a failed read says so and Skip still goes to the Desk (nothing saved).
  const placeKnown = f.counted;
  const placeFailed = !f.counted && f.state === 'failed';
  const reading = f.state === 'idle' || f.state === 'loading';

  // crew#1568 D05: only the helpers new work will use (ready and picked), and the ready ones left off.
  const { using: picked, off } = newWorkHelpers(rows, newWorkSeats.seats === null);
  const skip = (): void => { void f.save({ skippedAt: Date.now() }); navigate('/'); };

  return (
    <section className="wk-card wk-agents-setup" data-testid="agents-setup" aria-labelledby={titleId}>
      <div className="wk-agents-setup-main">
        <h2 id={titleId} className="wk-agents-setup-title">Welcome to studio. Let’s get your helpers ready.</h2>
        <p className="wk-agents-sub">Studio gives your work to your coding helpers. These steps check what they need before you start work.</p>
        <ol className="wk-agents-setup-steps">
          <Step n={1} done={helperReadingKnown && steps.agentsDone} testId="agents-setup-step-agents">
            <b>Get one helper ready.</b>{' '}
            <span data-testid="agents-setup-count">{!helperReadingKnown ? 'Not checked yet.' : steps.ready === 0 ? 'No helper can take new jobs yet.' : `${steps.ready} ${steps.ready === 1 ? 'helper can' : 'helpers can'} take new jobs now.`}</span>
            {/* The moves only while the step is open: once one agent counts, the table carries the rest. */}
            {!steps.agentsDone && (
              <>
                <div className="wk-agents-setup-moves">
                  {rows.map((r) => {
                    const m = setupMove(r, counted);
                    if (m === null) return null;
                    return (
                      <button key={r.key} type="button" data-testid="agents-setup-move" data-agent={r.key} data-kind={m.kind}
                        className={`wk-btn ${m.kind === 'sign-in' ? 'wk-btn--primary' : 'wk-btn--secondary'}`}
                        disabled={m.kind === 'use' && (!newWorkSeats.loaded || newWorkSeats.saving)}
                        onClick={() => (m.kind === 'use' ? pickForNewWork(rows, r.key) : open(r.key))}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                <span className="wk-agents-sub">Each sign-in opens the helper’s own sign-in; studio never sees your password.</span>
              </>
            )}
          </Step>
          <Step n={2} done={f.checks.skills === true} testId="agents-setup-step-skills" {...(skills !== undefined ? { state: skills.stage } : {})}>
            <b>Get skills ready.</b>{' '}
            {/* studio#1363: crew's own skills state decides the words (publishing at boot is not a to-do). */}
            {f.checks.skills === true ? skillsWords({ stage: 'published', command: null, garden: null })
              : skills !== undefined && skills.stage !== 'published' ? skillsWords(skills)
              : f.checks.skills === null ? 'Not checked yet.' : 'Not done. Publish skills before starting work.'}{' '}
            <button type="button" className="wk-btn wk-btn--link" onClick={() => navigate('/skills')}>Open Skills</button>
            {f.checks.skills !== true && skills?.stage === 'install' && skills.command !== null && <CopyLine line={skills.command} label="skills install" />}
          </Step>
          <Step n={3} done={f.checks.estate === true} testId="agents-setup-step-estate">
            <b>Set up the code map service.</b>{' '}
            {f.checks.estate === null ? 'Not checked yet.' : f.checks.estate ? 'Done. The code map service is ready.' : 'Not done. Install the code map service (wicked-estate) to add a repository.'}{' '}
            <button type="button" className="wk-btn wk-btn--link" onClick={() => navigate('/watch')}>Open Nerve Center</button>
          </Step>
          <Step n={4} done={checks.runtimeRequired === false || checks.runtime === true} testId="agents-setup-step-runtime">
            <b>Start the container runtime.</b>{' '}
            {checks.runtimeRequired === false ? 'Done. Helpers run on this computer without containers.'
              : checks.runtime === null || checks.runtimeRequired === null ? 'Not checked yet.'
              : checks.runtime ? 'Done. The container runtime is running.'
              : noCluster !== null ? `Not done. ${noCluster.title}. ${noCluster.step} then check again.`
              : `Not done. ${checks.downReason !== null ? `${checks.downReason.replace(/[.!]$/, '')}: start it` : 'Start Rancher Desktop'}, then check again.`}{' '}
            <button type="button" className="wk-btn wk-btn--link" onClick={() => navigate('/watch')}>Open Nerve Center</button>
            {checks.runtime !== true && noCluster?.command != null && <CopyLine line={noCluster.command} label="cluster setup" />}
          </Step>
          <Step n={5} done={deliver.done} testId="agents-setup-step-delivery" state={deliver.state}>
            <b>Choose how finished work is delivered.</b>{' '}
            <span data-testid="agents-setup-delivery">{delivery === undefined && deliverPr ? 'Checking your GitHub sign-in…' : deliver.words}</span>
            {deliver.state === 'blocked' && deliver.detail !== null && <span className="wk-agents-sub"> {displayText(deliver.detail)}</span>}
            {deliver.state === 'ready' && deliver.detail !== null && <span className="wk-agents-sub"> {displayText(deliver.detail)}</span>}
            {deliver.state === 'blocked' && deliver.commands.map((c) => <CopyLine key={c} line={c} label={c.startsWith('gh ') ? 'GitHub sign-in' : c.includes('user.name') ? 'git author name' : 'git author email'} />)}
            {(deliver.state === 'blocked' || deliver.state === 'unknown') && delivery !== undefined && (
              <div className="wk-agents-setup-moves">
                <button type="button" data-testid="agents-setup-delivery-local" className="wk-btn wk-btn--secondary" onClick={() => setDeliverPr({ deliverPr: false })}>Use local delivery</button>
                <button type="button" data-testid="agents-setup-delivery-check" className="wk-btn wk-btn--link" onClick={readDelivery}>Check again</button>
              </div>
            )}
            {deliver.state === 'local' && <button type="button" className="wk-btn wk-btn--link" onClick={() => navigate('/system')}>Open Settings</button>}
          </Step>
          <Step n={6} done={false} testId="agents-setup-step-defaults">
            <b>Choose the helpers new work uses</b> (optional).{' '}
            {picked.length > 0 ? `Right now: ${names(picked)}.` : 'Right now: none.'}
            {off.length > 0 ? ` ${names(off)} ${off.length === 1 ? 'is' : 'are'} off until you pick ${off.length === 1 ? 'it' : 'them'}.` : ''}{' '}
            <button type="button" data-testid="agents-setup-change" className="wk-btn wk-btn--link" onClick={() => navigate('/system')}>Change</button>
          </Step>
          <Step n={7} done={placeKnown && steps.placeDone} testId="agents-setup-step-project">
            <b>Create your first project.</b>{' '}
            {!placeKnown
              ? <span data-testid="agents-setup-place-reading" data-state={placeFailed ? 'failed' : 'reading'} role="status">
                {placeFailed ? 'Studio couldn’t read your projects and repositories just now.' : 'Checking your projects and repositories…'}
              </span>
              : steps.placeDone
              ? (steps.projects > 0
                ? `You already have ${steps.projects} ${steps.projects === 1 ? 'project' : 'projects'}.`
                : `You already have ${steps.repos} ${steps.repos === 1 ? 'repository' : 'repositories'}. Create a project to group them, or go to the Desk.`)
              : 'Name it; the project page then helps you attach a repository and start the first job.'}
            <div className="wk-agents-setup-moves">
              <button type="button" data-testid="agents-setup-project" className="wk-btn wk-btn--secondary" onClick={() => setCreating(true)}>Create a project</button>
            </div>
          </Step>
        </ol>
        {newWorkSeats.error !== null && <p role="alert" className="wk-agents-sub">{newWorkSeats.error}{' '}
          {!newWorkSeats.loaded && <button type="button" className="wk-btn wk-btn--link" onClick={() => void newWorkSeats.load()}>Try again</button>}
        </p>}
        <div className="wk-agents-setup-foot">
          {ready
            ? <button type="button" data-testid="agents-setup-desk" className="wk-btn wk-btn--primary" onClick={() => navigate('/')}>You’re ready: go to the Desk</button>
            : <button type="button" data-testid="agents-setup-skip" className="wk-btn wk-btn--quiet" onClick={skip} disabled={reading}>Skip setup and go to the Desk</button>}
          {f.saveFailed && <span className="wk-agents-sub" data-testid="agents-setup-unsaved" role="status">Studio couldn’t save that this time; it asks again the next time it opens.</span>}
        </div>
      </div>
      <aside className="wk-agents-setup-aside" data-testid="agents-setup-ready">
        <b>What “ready” means</b>
        <span>At least one helper signed in and working.</span>
        <span>Skills published, the code map service ready, and the container runtime running when needed.</span>
        <span>A project or a repository added.</span>
        <span className="wk-agents-sub">These steps stay on this page: “Setup guide” opens them again.</span>
      </aside>
      {creating && <NewProjectModal navigate={navigate} onClose={() => setCreating(false)} deskMode />}
    </section>
  );
}
