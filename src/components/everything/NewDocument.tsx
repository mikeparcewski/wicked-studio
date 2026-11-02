import { useEffect, useMemo, useRef, useState } from 'react';
import { createDoc, listDocs, UNFILED_MOUNT } from '../../api/interactive.js';
import { api } from '../../api/client.js';
import { setCachedRoster } from '../../store/rosterCache.js';
import type { ArtifactProposal, ProposalEdits } from '../../api/chatArtifacts-wire.js';
import { formSources, proposalFormEdits, proposalFormOf, proposalHelperEligible, repoKeysOf, type ProposalForm } from '../../board/artifactProposal.js';
import { apiStatus } from '../../api/errors.js';
import type { Project, RosterSeat } from '../../api/types.js';
import { chosenSeats, defaultDocSeats, docClisJson } from '../../board/docSeats.js';
import { newDocBody, newDocName } from '../../board/newDocument.js';
import { useRoster } from '../../hooks/useRoster.js';
import { docSlug } from '../../interactive/docSlug.js';
import { useDocsCache } from '../../store/docsCache.js';
import { DocSubjectPicker, type DocFormat, type SubjectStatus } from '../DocSubjectPicker.js';

/** studio#765: one helper writes the document and a different one checks it. */
export const MIN_DOC_SEATS = 2;

/**
 * DES-CHAT-ARTIFACTS-001 §4.2 (slice A3): New document in "answer this proposal" mode. A chat's create card opens it with
 * crew's resolution filled in (title, what it is about, the sources as chips, the repositories, the two helpers); Make
 * it answers THAT proposal with typed edits (`POST /chats/:id/proposals/:pid`), never a create of its own. The project
 * changes only in a chat filed in no project, and then a run or document chip from elsewhere is struck at once; crew
 * re-checks everything at Go.
 */
export interface AnswerProposal {
  proposal: ArtifactProposal;
  /** Only a chat filed in no project may move its document. */
  projectChangeable: boolean;
  /** A retry fills the same document again: its repositories stay as they were. */
  fixed?: boolean;
  /** An interrupted Go: it resumes with its accepted choices, and only its helpers may change. */
  helpersOnly?: boolean;
  /** Answer the proposal with these edits; resolves `null` when crew accepted it, else crew's words. */
  onSubmit: (edits: ProposalEdits) => Promise<string | null>;
  /** The card's last refusal of this form's answer (the card keeps it, so it survives the form closing). */
  error?: string | null;
}

/** New document: the form Made opens, or (A3) the same form answering a chat's proposal. */
export function NewDocument(props: Parameters<typeof NewDocumentForm>[0] | { answer: AnswerProposal; projects: readonly Project[]; onClose: () => void }): React.ReactElement {
  return 'answer' in props
    ? <AnswerProposalForm answer={props.answer} projects={props.projects} onClose={props.onClose} />
    : <NewDocumentForm {...props} />;
}

/**
 * S16a-4d: "New document" on Everything › Made — project, name (derived from the brief unless
 * edited), what it is about, the format and the repositories (DocSubjectPicker as it is). One press
 * sends exactly one `POST …/interactive/api/docs` carrying the council chosen here (studio#302: one
 * toggle per roster seat, defaulted like the Build composer minus the seats that will not answer,
 * sent as `clisJson`; with every seat unchecked, or before the roster is read, Create is refused). A collision keeps the form and names the
 * document with "Open it"; any other refusal keeps the form with the daemon's words verbatim;
 * nothing is retried by itself. On success the door closes onto the new document (`open=`).
 */
function NewDocumentForm({ projects, initialProject, initialFormat = '', onClose, onCreated, onOpen }: {
  projects: readonly Project[];
  /** The ambient project (`?project=`), preselected; null = Unfiled. */
  initialProject: string | null;
  /** studio#768: the format the list it opened from makes (a Pages list: a web page); '' = from the brief. */
  initialFormat?: DocFormat;
  onClose: () => void;
  /** The document was created: its project, canonical name and the format it was made in. */
  onCreated: (projectId: string, name: string, format: DocFormat) => void;
  /** "Open it" on a collision: the existing document's project and name. */
  onOpen: (projectId: string, name: string) => void;
}): React.ReactElement {
  const [projectId, setProjectId] = useState<string>(initialProject ?? UNFILED_MOUNT);
  const [brief, setBrief] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [repoRefs, setRepoRefs] = useState<string[]>([]);
  const [format, setFormat] = useState<DocFormat>(initialFormat);
  const [noGrounding, setNoGrounding] = useState(false);
  const [subject, setSubject] = useState<SubjectStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  // studio#302: the council. The roster is read-only here (the shared cache, one GET /roster).
  const roster = useRoster();
  const defaults = useMemo(() => (roster === null ? null : defaultDocSeats(roster)), [roster]);
  const [seatPick, setSeatPick] = useState<ReadonlySet<string> | null>(null);
  const selected = seatPick ?? defaults?.selected ?? null;
  // Counted against the CURRENT roster: a pick whose seats a roster refresh dropped must not send `[]`.
  const chosen = roster !== null && selected !== null ? chosenSeats(roster, selected) : null;
  // No roster yet (or none answered): no council can be chosen, so nothing is created — a create
  // without seats would convene the whole roster, which is the bug (codex r1 on #302).
  // studio#765: a document's draft needs a second helper to check it (evaluator ≠ creator); with one,
  // the create succeeded and the draft then failed at plan, leaving an empty page. Said up front.
  const seatBlocked = chosen === null || chosen.length < MIN_DOC_SEATS;
  const leftOut = (defaults?.leftOut ?? []).filter((x) => selected === null || !selected.has(x.key));
  const toggleSeat = (key: string): void => {
    if (selected === null) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSeatPick(next);
  };
  const shownName = nameEdited ? name : newDocName(brief, '');
  const blocked = brief.trim() === '' || subject === 'loading' || (subject === 'error' && !noGrounding) || seatBlocked;

  const create = async (): Promise<void> => {
    if (sending.current || blocked) return;
    sending.current = true;
    setBusy(true);
    setCollision(null);
    setError(null);
    const body = newDocBody(projectId, {
      brief, typedName: nameEdited ? name : '', repoRefs, format,
      ...(roster !== null && selected !== null ? { clisJson: docClisJson(roster, selected) } : {}),
    });
    try {
      const created = await createDoc(projectId, body);
      // The list shows it at once: one re-read of this project's documents into the shared cache.
      void listDocs(projectId).then((docs) => useDocsCache.getState().deposit(projectId, docs)).catch(() => undefined);
      onCreated(projectId, created.name, format);
    } catch (e) {
      const wire = e instanceof Error ? e.message : String(e);
      if (apiStatus(e) === 409 || /\b409\b|already exists/i.test(wire)) setCollision(docSlug(body.name ?? newDocName(brief, nameEdited ? name : "")));
      else setError(wire);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <div data-testid="made-new-document-form" role="group" aria-label="New document" className="wk-made-new">
      <label className="wk-made-new-field">
        <span>Project</span>
        <select data-testid="made-new-document-project" className="wk-field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value={UNFILED_MOUNT}>Unfiled</option>
          {projects.filter((p) => p.id !== UNFILED_MOUNT).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="wk-made-new-field">
        <span>What is it about?</span>
        <textarea data-testid="made-new-document-brief" className="wk-field" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="A one-page brief for the offsite: agenda, budget, who goes" />
      </label>
      <label className="wk-made-new-field">
        <span>Name</span>
        <input data-testid="made-new-document-name" className="wk-field" value={shownName} onChange={(e) => { setName(e.target.value); setNameEdited(true); }} />
      </label>
      <DocSubjectPicker
        projectId={projectId}
        mode="document"
        repoRefs={repoRefs}
        onRepoRefs={setRepoRefs}
        format={format}
        onFormat={setFormat}
        noGrounding={noGrounding}
        onNoGrounding={setNoGrounding}
        onStatus={setSubject}
      />
      {(roster === null || selected === null) && (
        <p data-testid="made-new-document-council" className="wk-made-new-field">Reading which helpers are available…</p>
      )}
      {roster !== null && selected !== null && (
        <div data-testid="made-new-document-seats" role="group" aria-label="Helpers" className="wk-made-new-field">
          <span>Helpers</span>
          <span className="wk-prop-btns">
            {roster.map((s) => {
              const on = selected.has(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  data-testid="made-new-document-seat"
                  data-seat={s.key}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggleSeat(s.key)}
                  className="wk-chip"
                  title={on ? `${s.display_name || s.key} works on this document. Click to leave it out.` : `${s.display_name || s.key} is left out. Click to add it.`}
                >
                  {s.display_name || s.key}
                </button>
              );
            })}
          </span>
          <span data-testid="made-new-document-council" role={seatBlocked ? 'alert' : undefined}>
            {seatBlocked
              ? (chosen ?? []).length === 0
                ? 'Choose two helpers: one writes the document and another checks it.'
                : 'Add a second helper: one writes the document and another checks it.'
              : `Helpers: ${(chosen ?? []).map((s) => s.display_name || s.key).join(' · ')}`}
            {leftOut.length > 0 && ` — left out: ${leftOut.map((x) => `${x.key} (${x.detail})`).join(', ')}`}
          </span>
        </div>
      )}
      {collision !== null && (
        <p data-testid="made-new-document-collision" role="alert" className="wk-artifact-line wk-artifact-line--bad">
          A document named “{collision}” already exists —{' '}
          <button type="button" data-testid="made-new-document-open" onClick={() => onOpen(projectId, collision)} className="wk-since-toggle">Open it</button>
          {' '}or change the name.
        </p>
      )}
      {error !== null && <p data-testid="made-new-document-error" role="alert" className="wk-artifact-line wk-artifact-line--bad">{error}</p>}
      <div className="wk-prop-btns">
        <button type="button" data-testid="made-new-document-create" disabled={busy || blocked} onClick={() => void create()} className="wk-prop-btn wk-prop-btn--primary">{busy ? 'Creating…' : 'Create'}</button>
        <button type="button" onClick={onClose} disabled={busy} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
      </div>
    </div>
  );
}

/** Two helpers exactly: one writes, a different one checks (crew refuses anything else at Go). */
const ANSWER_SEATS = 2;

function AnswerProposalForm({ answer, projects, onClose }: { answer: AnswerProposal; projects: readonly Project[]; onClose: () => void }): React.ReactElement {
  const p = answer.proposal;
  const [form, setForm] = useState<ProposalForm>(() => proposalFormOf(p));
  const [busy, setBusy] = useState(false);
  const error = answer.error ?? null;
  const sending = useRef(false);
  const roster = useRoster();
  // A roster that cannot be read is said, with a retry; the shared cache tells every reader once it can.
  const [rosterError, setRosterError] = useState(false);
  const [rosterTry, setRosterTry] = useState(0);
  useEffect(() => {
    if (roster !== null) return;
    let cancelled = false;
    setRosterError(false);
    Promise.resolve()
      .then(() => api.getRoster())
      .then(({ roster: r }) => { if (!cancelled) setCachedRoster(r); })
      .catch(() => { if (!cancelled) setRosterError(true); });
    return () => { cancelled = true; };
  }, [roster, rosterTry]);
  const only = answer.helpersOnly === true;
  /** Check the unavailable chosen helpers' sign-in again (crew's bounded `/roster?refresh=<key>`, the Agents page's
   *  Check now): one check at a time, its answer deposited in the shared cache only while this form is open. */
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const seatsRef = useRef<HTMLDivElement | null>(null);
  const refreshRoster = async (keys: readonly string[]): Promise<void> => {
    if (checking || keys.length === 0) return;
    setChecking(true);
    setCheckFailed(false);
    try {
      let latest: RosterSeat[] | null = null;
      let fresh = true;
      for (const key of keys) {
        const r = await api.getRoster(key);
        if (!Array.isArray(r?.roster)) throw new Error('roster: no list');
        latest = r.roster;
        // `timed_out`: no fresh answer, the roster is the last reading (crew's contract) — said, not taken as checked.
        if (r.refresh?.key === key && r.refresh.outcome === 'timed_out') fresh = false;
      }
      if (!alive.current || latest === null) return;
      setCachedRoster(latest);
      if (!fresh) setCheckFailed(true);
      // The control that asked may be gone now (every chosen helper can work): focus stays in the helpers, but only
      // when it was lost with that control, never taken from where the person moved on to meanwhile.
      requestAnimationFrame(() => {
        const at = document.activeElement;
        if (alive.current && (at === null || at === document.body)) seatsRef.current?.focus();
      });
    } catch {
      if (alive.current) setCheckFailed(true);
    } finally {
      if (alive.current) setChecking(false);
    }
  };
  // Opened from a control that is now gone: focus goes to the form itself (never to Make it).
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { formRef.current?.focus(); }, []);
  const labelOf = (id: string | null): string => (id === null ? 'Unfiled' : projects.find((x) => x.id === id)?.name ?? id);
  const chips = formSources(p, form, labelOf);
  const moved = form.project !== p.filedIn.projectId;
  const toggle = (list: readonly string[], key: string): string[] => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const seatName = (key: string): string => {
    const s = roster?.find((x) => x.key === key);
    return s === undefined ? key : s.display_name || s.key;
  };
  // Crew's own rule at Go: a helper must be on the roster AND able to work now (not signed out, not opt-in, …).
  const eligible = (key: string): boolean => roster !== null && roster.some((s) => s.key === key && proposalHelperEligible(s as never));
  const blocked = roster === null || form.title.trim() === '' || form.helpers.length !== ANSWER_SEATS || !form.helpers.every(eligible);
  const go = async (): Promise<void> => {
    if (sending.current || blocked) return;
    sending.current = true;
    setBusy(true);
    try {
      await answer.onSubmit(proposalFormEdits(p, form, labelOf));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div data-testid="proposal-answer-form" role="group" aria-label={`Change this proposal: ${p.what.label}`} className="wk-made-new wk-proposal-answer" ref={formRef} tabIndex={-1}>
      <p className="wk-made-new-field wk-proposal-answer-what"><span>Answer this proposal</span><b>{p.what.label}</b></p>
      <label className="wk-made-new-field">
        <span>Filed in</span>
        {answer.projectChangeable ? (
          <select data-testid="proposal-answer-project" className="wk-field" value={form.project ?? ''} disabled={busy}
            onChange={(e) => setForm({ ...form, project: e.target.value === '' ? null : e.target.value })}>
            <option value="">Not in a project · this chat</option>
            {projects.filter((x) => x.id !== UNFILED_MOUNT && x.id !== 'default').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : (
          <span data-testid="proposal-answer-project-fixed">{p.filedIn.label} {answer.fixed === true ? '(a retry keeps its document where it is)' : '(this chat’s project)'}</span>
        )}
      </label>
      <label className="wk-made-new-field">
        <span>Title</span>
        <input data-testid="proposal-answer-title" className="wk-field" value={form.title} disabled={busy || only} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label className="wk-made-new-field">
        <span>What is it about?</span>
        <textarea data-testid="proposal-answer-brief" className="wk-field" rows={3} value={form.brief} disabled={busy || only} onChange={(e) => setForm({ ...form, brief: e.target.value })} />
      </label>
      {chips.length > 0 && (
        <div data-testid="proposal-answer-sources" role="group" aria-label="Made from" className="wk-made-new-field">
          <span>From</span>
          <span className="wk-proposal-chips">
            {chips.map((s) => s.status === 'ok' ? (
              <button key={s.token} type="button" data-testid="proposal-answer-source" data-token={s.token} data-status="ok" aria-pressed={s.kept} disabled={busy || only}
                onClick={() => setForm({ ...form, sources: toggle(form.sources, s.token) })}
                title={s.kept ? `${s.label} is used. Click to leave it out.` : `${s.label} is left out. Click to use it.`}
                className={`wk-chip wk-proposal-chip${s.kept ? '' : ' wk-proposal-chip--off'}`}>
                {s.label}
              </button>
            ) : (
              <span key={s.token} data-testid="proposal-answer-source" data-token={s.token} data-status="struck" className="wk-proposal-chip wk-proposal-chip--struck">
                <span className="wk-sr-only">Left out: </span>
                <s>{s.label}</s>
                <span className="wk-proposal-chip-why">{` · ${s.reason ?? 'left out'}`}</span>
              </span>
            ))}
          </span>
        </div>
      )}
      {p.repos.length > 0 && (
        <div data-testid="proposal-answer-repos" role="group" aria-label="About these repositories" className="wk-made-new-field">
          <span>About</span>
          <span className="wk-proposal-chips">
            {repoKeysOf(p).map(({ key, label }) => {
              const on = form.repos.includes(key);
              return (
                <button key={key} type="button" data-testid="proposal-answer-repo" data-repo={key} aria-pressed={on} disabled={busy || answer.fixed === true}
                  onClick={() => setForm({ ...form, repos: toggle(form.repos, key) })}
                  title={on ? `${label} grounds it. Click to leave it out.` : `${label} is left out. Click to use it.`}
                  className={`wk-chip wk-proposal-chip${on ? '' : ' wk-proposal-chip--off'}`}>
                  {label}
                </button>
              );
            })}
          </span>
        </div>
      )}
      {moved && (
        <p data-testid="proposal-answer-recheck" role="status" className="wk-made-new-field wk-proposal-note">
          Filing it in {labelOf(form.project)}: when you press Make it, the conversation and the answers it names are
          checked against {labelOf(form.project)}, and anything outside it is left out. A repository you keep must be in{' '}
          {labelOf(form.project)}, or Make it is refused with the reason.
        </p>
      )}
      <div data-testid="proposal-answer-seats" ref={seatsRef} tabIndex={-1} role="group" aria-label="Helpers" className="wk-made-new-field">
        <span>Helpers</span>
        <span className="wk-prop-btns">
          {/* The roster's seats, plus any the proposal chose that the roster no longer has (said, and removable). */}
          {roster === null && !rosterError && <span data-testid="proposal-answer-council-reading">Reading which helpers are available…</span>}
          {roster === null && rosterError && (
            <span data-testid="proposal-answer-council-error" role="alert">
              Studio couldn’t read which helpers are available.{' '}
              <button type="button" data-testid="proposal-answer-council-retry" className="wk-since-toggle" onClick={() => setRosterTry((n) => n + 1)}>Retry</button>
            </span>
          )}
          {roster !== null && [
            ...roster.filter((s) => proposalHelperEligible(s as never) || form.helpers.includes(s.key)).map((s) => ({ key: s.key, name: s.display_name || s.key, gone: !proposalHelperEligible(s as never) })),
            ...form.helpers.filter((k) => !roster.some((s) => s.key === k)).map((k) => ({ key: k, name: k, gone: true })),
          ].map((s) => {
            const on = form.helpers.includes(s.key);
            return (
              <button key={s.key} type="button" data-testid="proposal-answer-seat" data-seat={s.key} aria-pressed={on} disabled={busy || (s.gone && !on)}
                {...(s.gone ? { 'data-gone': 'true' } : {})}
                onClick={() => setForm({ ...form, helpers: toggle(form.helpers, s.key) })}
                title={s.gone ? `${s.name} can no longer help here. Click to leave it out.` : on ? `${s.name} helps. Click to leave it out.` : `${s.name} is left out. Click to add it.`}
                className="wk-chip">
                {s.gone ? `${s.name} (not available)` : s.name}
              </button>
            );
          })}
        </span>
        <span data-testid="proposal-answer-council" role={form.helpers.length !== ANSWER_SEATS ? 'alert' : 'status'}>
          {roster !== null && !form.helpers.every(eligible)
            ? <>A helper on this proposal is no longer available: leave it out and choose another, or{' '}
                <button type="button" data-testid="proposal-answer-council-refresh" className="wk-since-toggle" disabled={checking}
                  onClick={() => void refreshRoster(form.helpers.filter((k) => !eligible(k)))}>{checking ? 'checking…' : 'check the helpers again'}</button>.
                {checkFailed && <span data-testid="proposal-answer-council-check-failed"> Studio couldn’t get a fresh answer; try once more.</span>}</>
            : form.helpers.length === ANSWER_SEATS
              ? `${seatName(form.helpers[0]!)} and ${seatName(form.helpers[1]!)}: one writes, the other checks`
              : 'Choose two helpers: one writes the document and another checks it.'}
        </span>
      </div>
      {error !== null && <p data-testid="proposal-answer-error" role="alert" className="wk-artifact-line wk-artifact-line--bad">{error}</p>}
      <div className="wk-prop-btns">
        <button type="button" data-testid="proposal-answer-go" disabled={busy || blocked} onClick={() => void go()} className="wk-prop-btn wk-prop-btn--primary">{busy ? 'Starting…' : 'Make it'}</button>
        <button type="button" data-testid="proposal-answer-cancel" onClick={onClose} disabled={busy} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
      </div>
    </div>
  );
}
