import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { RepoEntry } from '../../api/types.js';
import { gatePostureWord, workflowLaunchBody } from '../../board/launchModel.js';
import { workflowRequiresQe } from '../../board/assuranceModel.js';
import { workflowItems, WORKFLOWS_LOADING_LINE } from '../../board/workflowCommand.js';
import { sessionPath } from '../../board/sessionModel.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from '../composerDefaults.js';
import type { ConfirmMode } from '../ContextPopover.js';
import { useModalEscape } from '../Modal.js';
import { QeAcceptanceOptions, ReducedAssuranceOptIn } from '../session/AssuranceReceipt.js';
import { Switch } from '../ui/Switch.js';
import { TechDetails } from '../ui/TechDetails.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useLaunchPreview } from '../../hooks/useLaunchPlan.js';
import { useCapabilities } from '../../store/capabilities.js';
import { isOptInKey, OPT_IN_NOTE, seatOff, useComposerSeats } from '../../store/composerSeats.js';
import { clearAboutChips } from '../../store/composerChips.js';
import { usePlanCatalog } from '../../store/planCatalog.js';
import { useProjectsStore } from '../../store/projects.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import { workflowLabel } from '../../board/workflowNames.js';
import { useLaunchWizard, type LaunchDraft } from '../../store/launchWizard.js';

type Step = 'workflow' | 'what' | 'where' | 'options' | 'review';
const STEP_TITLE: Record<Step, string> = {
  workflow: 'Choose the kind of job',
  what: 'The work',
  where: 'Where does it work?',
  options: 'How should it run?',
  review: 'Check and launch',
};

/**
 * THE LAUNCH WIZARD (operator 2026-10-11 15:15Z: "someone just starts a new job by selecting a
 * workflow and we do the wizard in a modal"). Mounted once by the app shell; opened through
 * `openLaunchWizard` from every start point. Steps: (the workflow, when none was named) → what you
 * want → where (repository, project) → options (only the ones this workflow uses) → review →
 * Launch. A modal dialog: focus is trapped inside, Escape closes (the draft stays in its store);
 * on a phone it is a full-height sheet. Launch sends `workflowLaunchBody` — the same body the
 * composer's inline strip sent.
 */
export function LaunchWizard({ navigate }: { navigate?: (path: string) => void }): React.ReactElement | null {
  const open = useLaunchWizard((s) => s.open);
  const draft = useLaunchWizard((s) => s.draft);
  if (!open || draft === null) return null;
  return <WizardDialog draft={draft} navigate={navigate} />;
}

function WizardDialog({ draft, navigate }: { draft: LaunchDraft; navigate?: ((path: string) => void) | undefined }): React.ReactElement {
  const { close: closeStore, update, finish } = useLaunchWizard.getState();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // codex r1: a launch in flight holds the dialog open (no second POST from a reopened draft).
  const launchingRef = useRef(false);
  const close = (): void => { if (!launchingRef.current) closeStore(); };
  useModalEscape(close);
  // codex r1: focus returns to whatever opened the wizard when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener !== null && opener.isConnected) opener.focus(); };
  }, []);

  const defs = useWorkflowDefs();
  const presetsState = usePlanCatalog((s) => s.presets[draft.projectId ?? '']);
  const presets = Array.isArray(presetsState) ? presetsState : null;
  const rows = useMemo(() => workflowItems('', defs, presets), [defs, presets]);
  const roster = useRoster();
  const projects = useProjectsStore((s) => s.projects) ?? [];
  const dropped = useComposerSeats((s) => s.dropped);
  const picked = useComposerSeats((s) => s.picked);
  const toggleSeat = useComposerSeats((s) => s.toggle);
  const deliverGateCap = useCapabilities((s) => s.deliverGate);
  const reducedCap = useCapabilities((s) => s.reducedAssurance);
  const chatIdOnLaunch = useCapabilities((s) => s.chatIdOnLaunch);
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos());
  const [qeCap, setQeCap] = useState(false);
  const [force, setForce] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(draft.workflowId === null ? 'workflow' : 'what');

  useEffect(() => { if (repos === null) fetchReposCached().then(setRepos, () => setRepos([])); }, [repos]);
  useEffect(() => { if ((useProjectsStore.getState().projects ?? []).length === 0) void useProjectsStore.getState().load(); }, []);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.getHealth()).then((h) => {
      const caps = (h as unknown as { capabilities?: Record<string, unknown> }).capabilities ?? {};
      if (live) setQeCap(caps['qeAcceptanceOverride'] === true);
    }).catch(() => { /* no override offered */ });
    return () => { live = false; };
  }, []);

  const row = rows.find((r) => r.workflowId === draft.workflowId) ?? null;
  const def = (defs ?? []).find((d) => d.id === draft.workflowId) ?? null;
  // A named def that runs no code is not a delivering launch; an unknown one (a preset) may deliver.
  const deliverVisible = draft.workflowId !== null && (def === null ? true : def.phases.some((p) => p.executes_code));
  const offerQe = qeCap && workflowRequiresQe(def);

  // Where: the user's pick, else the repository the opening context names, else a sole repository.
  const defaultRepo = useMemo(() => {
    const list = repos ?? [];
    const ctx = draft.contextRepo === null ? undefined : list.find((r) => r.id === draft.contextRepo || r.name === draft.contextRepo);
    if (ctx !== undefined) return ctx.id;
    return list.length === 1 ? list[0]?.id ?? null : null;
  }, [repos, draft.contextRepo]);
  const repoRef = draft.repoRef !== null ? (draft.repoRef === '' ? null : draft.repoRef) : defaultRepo;
  const repoName = repoRef === null ? null : ((repos ?? []).find((r) => r.id === repoRef)?.name ?? repoRef);
  const projectName = draft.projectId === null ? null : (projects.find((p) => p.id === draft.projectId)?.name ?? null);

  // Options: the helpers a workflow launch convenes (council-enabled, addressable), minus the dropped.
  const eligible = useMemo(() => userSeats(roster).filter((s) => s.enabled_for_council), [roster]);
  const seats = eligible.filter((s) => !seatOff(s.key, dropped, picked));
  const offerReduced = reducedCap && seats.length === 1;
  const beforeOrd = COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd;
  const autoDeliver = draft.confirmMode === 'none';
  const deliver: 'pr' | 'none' | null = deliverVisible ? (draft.deliverOn ? 'pr' : 'none') : null;
  const preview = useLaunchPreview({
    plan: null, workflow: draft.workflowId ?? '', projectId: draft.projectId, repoRef, deliver, mode: undefined,
    confirm: draft.confirmMode, beforeOrd,
  });

  // What each step needs before Next: words; a repository; a helper and, for a skip, its reason.
  const blocker: string | null =
    step === 'workflow' ? (draft.workflowId === null ? 'Choose the kind of job.' : null)
      : step === 'what' ? (draft.intent.trim() === '' ? 'Say what you want done.' : null)
        : step === 'where' ? (repoRef === null ? 'Choose the repository this works in.' : null)
          : step === 'options' ? (eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.'
            : offerQe && draft.skipQe && draft.skipQeReason.trim() === '' ? 'Say why QE acceptance is skipped.' : null)
            : null;
  // Review re-checks every rule (codex r1: another tab may have dropped the last helper meanwhile).
  const launchBlocker: string | null =
    draft.workflowId === null ? 'Choose the kind of job.'
      : draft.intent.trim() === '' ? 'Say what you want done.'
        : repoRef === null ? 'Choose the repository this works in.'
          : eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.'
            : offerQe && draft.skipQe && draft.skipQeReason.trim() === '' ? 'Say why QE acceptance is skipped.' : null;
  const order: Step[] = ['workflow', 'what', 'where', 'options', 'review'];
  const goNext = (): void => {
    if (blocker !== null) return;
    const i = order.indexOf(step);
    setStep(order[Math.min(i + 1, order.length - 1)]!);
  };
  const goBack = (): void => {
    const i = order.indexOf(step);
    setStep(order[Math.max(i - 1, 1)]!);
  };

  // Focus: the step's first control on every step; Tab stays inside the dialog.
  useEffect(() => {
    const el = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus="true"]')
      ?? dialogRef.current?.querySelector<HTMLElement>('button, select, textarea, input');
    el?.focus();
  }, [step]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea, input, a[href], summary') ?? [])];
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const launch = async (): Promise<void> => {
    if (draft.workflowId === null || launching || launchBlocker !== null) return;
    launchingRef.current = true;
    setLaunching(true);
    setError(null);
    try {
      const key = draft.composerKey;
      const chatId = chatIdOnLaunch && key !== null && key !== 'desk' && !key.startsWith('run:') ? key : null;
      const body = workflowLaunchBody({
        workflowId: draft.workflowId,
        intent: draft.intent,
        seats,
        repoRef,
        projectId: draft.projectId,
        humanConfirm: await preview.resolveHumanConfirm(),
        deliver,
        autoDeliverGate: autoDeliver && deliverGateCap === true,
        reducedAssurance: offerReduced && draft.reduced,
        skipQeReason: offerQe && draft.skipQe ? draft.skipQeReason : null,
        chatId,
      });
      if (offerQe && force && !draft.skipQe) body.forceQeAcceptance = true;
      const { runId } = await api.launchRun(body);
      useProvenanceStore.getState().markLaunchedHere(runId);
      if (key !== null) clearAboutChips(key);
      finish();
      navigate?.(chatId !== null ? sessionPath(chatId) : sessionPath(`run:${runId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  const title = draft.workflowId !== null ? `New job: ${workflowLabel(row?.key ?? draft.workflowId)}` : 'New job';
  return (
    <div className="wk-launch-wizard-scrim" data-testid="launch-wizard-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="launch-wizard"
        className="wk-launch-wizard"
        onKeyDown={onKeyDown}
      >
        <header className="wk-launch-wizard-head">
          <div>
            <h2 id={titleId} className="wk-launch-wizard-title">{title}</h2>
            <p className="wk-launch-wizard-progress" data-testid="launch-wizard-progress">
              Step {order.indexOf(step) + (draft.workflowId === null || step === 'workflow' ? 1 : 0)} of {draft.workflowId === null || step === 'workflow' ? 5 : 4}: {STEP_TITLE[step]}
            </p>
          </div>
          <button type="button" className="wk-btn wk-btn--icon wk-btn--quiet" aria-label="Close (your choices are kept)" title="Close (your choices are kept)" data-testid="launch-wizard-close" disabled={launching} onClick={close}>×</button>
        </header>

        <div className="wk-launch-wizard-body" data-testid="launch-wizard-step" data-step={step}>
          {step === 'workflow' && (
            <fieldset className="wk-launch-wizard-fieldset">
              <legend className="wk-field-label">The kind of job</legend>
              {defs === null && <p className="wk-field-note">{WORKFLOWS_LOADING_LINE}</p>}
              <div className="wk-launch-wizard-choices">
                {rows.map((r, i) => (
                  <button
                    key={r.cmd}
                    type="button"
                    data-testid={`launch-wizard-workflow-${r.workflowId}`}
                    data-autofocus={i === 0 ? 'true' : undefined}
                    aria-pressed={draft.workflowId === r.workflowId}
                    className={`wk-launch-wizard-choice${draft.workflowId === r.workflowId ? ' wk-launch-wizard-choice--on' : ''}`}
                    onClick={() => {
                      // codex r1: another kind of job starts its own options (nothing carried over).
                      if (r.workflowId !== draft.workflowId) update({ workflowId: r.workflowId, reduced: false, skipQe: false, skipQeReason: '' });
                      setStep('what');
                    }}
                  >
                    <span className="wk-launch-wizard-choice-name">{workflowLabel(r.key)}</span>
                    <span className="wk-launch-wizard-choice-line">{r.line}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {step === 'what' && (
            <label className="wk-launch-wizard-field">
              <span className="wk-field-label">What do you want done?</span>
              <textarea
                data-testid="launch-wizard-intent"
                data-autofocus="true"
                className="wk-field wk-launch-wizard-intent"
                rows={5}
                value={draft.intent}
                placeholder="Describe the outcome, the way you would to a teammate"
                onChange={(e) => update({ intent: e.target.value })}
              />
              <span className="wk-field-note">{row?.line !== undefined && row.line !== '' ? `This job: ${row.line}` : 'The helpers plan the steps from this; you approve the plan before work starts.'}</span>
            </label>
          )}

          {step === 'where' && (
            <>
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Repository</span>
                <select
                  data-testid="launch-wizard-repo"
                  data-autofocus="true"
                  className="wk-field"
                  value={repoRef ?? ''}
                  onChange={(e) => update({ repoRef: e.target.value })}
                >
                  <option value="">Choose a repository…</option>
                  {(repos ?? []).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}
                </select>
                <span className="wk-field-note">The code this job reads and changes{draft.contextRepo !== null && repoRef === defaultRepo && repoRef !== null ? ' (the one this session already works in)' : ''}.</span>
              </label>
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Project</span>
                <select
                  data-testid="launch-wizard-project"
                  className="wk-field"
                  value={draft.projectId ?? ''}
                  onChange={(e) => update({ projectId: e.target.value === '' ? null : e.target.value })}
                >
                  <option value="">Not in a project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="wk-field-note">Optional. Files the job with a project so it shows up there.</span>
              </label>
            </>
          )}

          {step === 'options' && (
            <>
              {eligible.length > 0 && (
                <fieldset className="wk-launch-wizard-fieldset" data-testid="launch-wizard-helpers">
                  <legend className="wk-field-label">Helpers</legend>
                  <div className="wk-launch-wizard-seats">
                    {eligible.map((s, i) => {
                      const on = !seatOff(s.key, dropped, picked);
                      return (
                        <button
                          key={s.key}
                          type="button"
                          data-testid="launch-wizard-seat"
                          data-key={s.key}
                          data-autofocus={i === 0 ? 'true' : undefined}
                          aria-pressed={on}
                          aria-describedby={isOptInKey(s.key) ? 'launch-wizard-optin-note' : undefined}
                          className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}
                          onClick={() => toggleSeat(s.key)}
                        >
                          {seatLabel(s)}
                        </button>
                      );
                    })}
                  </div>
                  <span className="wk-field-note">Who plans, builds and checks the work. Different helpers check each other’s work.</span>
                  {eligible.some((s) => isOptInKey(s.key)) && (
                    <span id="launch-wizard-optin-note" className="wk-field-note" data-testid="launch-wizard-optin-note">
                      {eligible.filter((s) => isOptInKey(s.key)).map(seatLabel).join(', ')}: {OPT_IN_NOTE}
                    </span>
                  )}
                </fieldset>
              )}
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Ask me</span>
                <select
                  data-testid="launch-wizard-gate"
                  className="wk-field"
                  value={draft.confirmMode}
                  onChange={(e) => update({ confirmMode: e.target.value as ConfirmMode })}
                >
                  <option value="before">{gatePostureWord('before', beforeOrd)}</option>
                  <option value="all">{gatePostureWord('all', beforeOrd)}</option>
                  <option value="none">{gatePostureWord('none', beforeOrd, deliver === 'pr' && deliverGateCap === true)}</option>
                </select>
                <span className="wk-field-note">When the job stops for your yes before it goes on.</span>
              </label>
              {deliverVisible && (
                <div className="wk-launch-wizard-field" data-testid="launch-wizard-deliver">
                  <Switch label="Deliver as a pull request when done" checked={draft.deliverOn} onChange={(v) => update({ deliverOn: v })} data-testid="launch-wizard-deliver-toggle" />
                  <span className="wk-field-note">{draft.deliverOn ? (autoDeliver && deliverGateCap === true ? 'It pushes and opens the pull request without asking.' : 'It asks you once more before it pushes.') : 'The work stays on its branch; you can deliver it later from the session.'}</span>
                </div>
              )}
              {offerReduced && <ReducedAssuranceOptIn checked={draft.reduced} onChange={(v) => update({ reduced: v })} testId="launch-wizard-reduced" />}
              {offerQe && (
                <QeAcceptanceOptions
                  skip={draft.skipQe} reason={draft.skipQeReason} force={force}
                  onSkip={(v) => update({ skipQe: v })} onReason={(v) => update({ skipQeReason: v })} onForce={setForce}
                  testId="launch-wizard-qe"
                />
              )}
            </>
          )}

          {step === 'review' && (
            <dl className="wk-launch-wizard-review" data-testid="launch-wizard-review">
              <div><dt>Job</dt><dd>{workflowLabel(row?.key ?? draft.workflowId ?? '')}</dd></div>
              <div><dt>What</dt><dd className="wk-launch-wizard-review-intent">{draft.intent.trim()}</dd></div>
              <div><dt>Where</dt><dd>{repoName ?? 'No repository'}{projectName !== null ? ` · in ${projectName}` : ''}</dd></div>
              {seats.length > 0 && <div><dt>Helpers</dt><dd>{seats.map(seatLabel).join(', ')}</dd></div>}
              <div><dt>Ask me</dt><dd>{gatePostureWord(draft.confirmMode, beforeOrd, deliver === 'pr' && deliverGateCap === true)}</dd></div>
              {deliverVisible && <div><dt>Delivery</dt><dd>{draft.deliverOn ? 'A pull request when done' : 'Stays on its branch'}</dd></div>}
              {offerReduced && draft.reduced && <div><dt>Checks</dt><dd>Reduced assurance (one helper builds and reviews)</dd></div>}
              {offerQe && draft.skipQe && <div><dt>QE acceptance</dt><dd>Skipped: {draft.skipQeReason.trim()}</dd></div>}
            </dl>
          )}

          {error !== null && (
            <div role="alert" data-testid="launch-wizard-error" className="wk-composer-note wk-composer-note--bad">
              Couldn’t launch this. Your choices are kept, so you can try again.
              <TechDetails text={error} data-testid="launch-wizard-error-detail" />
            </div>
          )}
        </div>

        <footer className="wk-launch-wizard-foot">
          {(step === 'review' ? launchBlocker : blocker) !== null && step !== 'workflow' && <p className="wk-field-note" data-testid="launch-wizard-blocker" role="status">{step === 'review' ? launchBlocker : blocker}</p>}
          <div className="wk-launch-wizard-actions">
            {step !== 'workflow' && step !== 'what' && (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-back" onClick={goBack}>Back</button>
            )}
            {step === 'what' && (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-change" onClick={() => setStep('workflow')}>Change job</button>
            )}
            {step === 'review' ? (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-launch" disabled={launching || launchBlocker !== null} onClick={() => { void launch(); }}>
                {launching ? 'Launching…' : error !== null ? 'Try again' : 'Launch'}
              </button>
            ) : step !== 'workflow' && (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-next" disabled={blocker !== null} onClick={goNext}>Next</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
