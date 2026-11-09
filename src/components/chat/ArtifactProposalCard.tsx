import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileText, GitBranch, Palette } from 'lucide-react';
import { api } from '../../api/client.js';
import type { AskAnswer } from '../../api/ask.js';
import { parseArtifactRef, type ArtifactProposal, type ChatProposalView, type ProposalEdits, type ProposalSource, type ProtectedEdit } from '../../api/chatArtifacts-wire.js';
import type { SessionView } from '../../api/types.js';
import { getVersions } from '../../api/interactive.js';
import { useProjectsStore } from '../../store/projects.js';
import { NewDocument } from '../everything/NewDocument.js';
import {
  changeRoute,
  GO_WORDS,
  noteSettled,
  proposalAsk,
  proposalRecordLine,
  proposalRefusal,
  proposalStarting,
  PROPOSAL_STARTING_MS,
  proposalResultWords,
  proposalTimeWords,
  keptByAccepted,
  protectedGroups,
  refineGoEdits,
  refineOutcome,
  refineOutcomeLine,
  type RefineOutcome,
  isProposalView,
  shownProposal,
  THEME_LIMITS,
  themeChangeWords,
  themeDisclosure,
  type ProposalEntry,
} from '../../board/artifactProposal.js';
import { SETTINGS_THEME_PATH } from '../../board/settingsTabs.js';
import { canonicalDelta, effectiveAppearance, mergedAppearance, themePatchOf, useAppearanceStore } from '../../theming/appearance.js';
import { contrastWords, measureTheme, type ContrastCheck } from '../../theming/themeContrast.js';
import { ThemeSwatches } from '../ThemeSwatches.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';

/**
 * A CHAT'S PROPOSAL CARD (DES-CHAT-ARTIFACTS-001 §4.2, slice A2): what a seat proposed to make, drawn from crew's own
 * resolution — What, the brief or what to show, From (a struck source says why the draft will never see it), About,
 * Helpers, Time and cost, Stops, Filed in — answered on `AskCard` (`host: 'chat'`). The primary (Make it / Make the
 * change / Preview) is preselected but never focused, so Enter in the composer still sends a message. Only a click
 * answers it: Go and Not now go to `POST /chats/:id/proposals/:pid`; Change something is routed per kind: a create opens
 * New document in "answer this proposal" mode under the card (slice A3), the others a note until their slices land.
 * Once answered or replaced, the card collapses to its headline and one record line, with the facts behind Details; an
 * interrupted Go offers Go again.
 */
export interface ArtifactProposalCardProps {
  chatId: string;
  /** The proposal as this tab draws it (already reconciled: a settled one never reopens). */
  entry: ProposalEntry;
  /** The proposing seat's display name ("Claude Code"). */
  seatName: string;
  /** The daemon runs the test configuration (Go starts nothing): said on the card. */
  stub: boolean;
  /** Something was recorded (or refused): re-read the chat. */
  onChanged: () => void;
  /** (A5) The run this proposal's Go started (its slot's), when it is known: a refine says what became of it. */
  run?: SessionView | null;
}

const terminal = (s: ChatProposalView['state']): boolean => s === 'decided' || s === 'superseded';

/** What a theme card shows (slice A7): its changes against the tab's appearance, and the contrast of the merged result. */
interface ThemeFacts {
  changes: string[];
  check: ContrastCheck;
  seatName: string;
}

const goTo = (path: string): void => {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export function ArtifactProposalCard({ chatId, entry, seatName, stub, onChanged, run = null }: ArtifactProposalCardProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  /** A Go of this tab is on its way (from the card or its helpers-only form). */
  const [going, setGoing] = useState(false);
  // A refusal's words, and whether its own view settled the card (only then does it stay beside a settled card: a stale
  // refusal never hangs under an answer another tab gave meanwhile).
  const [error, setError] = useState<{ words: string; settles: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  // A3: Change something on a create opens New document under the card, answering this proposal.
  const [answering, setAnswering] = useState(false);
  // Focus follows the controls a person used: into the form when it opens from them, back to Change something (or the
  // interrupted card's Change helpers) when it closes.
  const restoreFocus = useRef(false);
  const changeHelpersRef = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (answering || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target = changeHelpersRef.current ?? sectionRef.current?.querySelector<HTMLElement>('[data-ask-option="change"]') ?? null;
    target?.focus();
  }, [answering]);
  const projects = useProjectsStore((s) => s.projects);
  // The daemon's answer to THIS card's request, shown at once while the re-read catches up: a settled one stays (a
  // stale read never reopens it); an open one (a refusal's fresh facts: the document moved) stands until the next read
  // of the chat arrives, which carries the same or newer facts.
  const [answered, setAnswered] = useState<{ view: ProposalEntry; against: ProposalEntry } | null>(null);
  // Compared by content, not identity: a re-read that brings the same (older) facts keeps the refusal's newer ones.
  // Two accepting records of one proposal are told apart by when each was recorded (another tab's Go is a new one).
  const same = (a: ProposalEntry, b: ProposalEntry): boolean =>
    a.state === b.state && a.acceptingAt === b.acceptingAt && JSON.stringify(shownProposal(a)) === JSON.stringify(shownProposal(b));
  const view: ProposalEntry = answered !== null && !terminal(entry.state) && (terminal(answered.view.state) || same(answered.against, entry)) ? answered.view : entry;
  const p = shownProposal(view);
  const open = view.state === 'open';
  // A7: a theme proposal is previewed on this tab, measured on the exact merged result, and applied from the preview.
  const stored = useAppearanceStore((s) => s.appearance);
  const preview = useAppearanceStore((s) => s.preview);
  const save = useAppearanceStore((s) => s.save);
  const saving = save.state === 'saving';
  const previewingThis = preview !== null && preview.chatId === chatId && preview.pid === entry.pid;
  const themeFacts = useMemo<ThemeFacts | null>(() => {
    if (p.kind !== 'theme' || p.theme === undefined) return null;
    // The preview of THIS card is what Apply saves: the whole accumulated delta (with any Theme-page moves) against the
    // saved appearance. Any other card shows what its Preview would show: its patch over what the tab shows now.
    if (previewingThis && preview !== null) {
      return { changes: themeChangeWords(stored, canonicalDelta(stored, preview.delta)), check: measureTheme(effectiveAppearance({ appearance: stored, preview })), seatName };
    }
    const patch = themePatchOf(p.theme.patch);
    // The base Preview will build on (the store's rule): this chat's preview, else the saved appearance.
    const current = preview !== null && preview.chatId === chatId ? effectiveAppearance({ appearance: stored, preview }) : stored;
    if (Object.keys(patch).length === 0) return { changes: [], check: { ratios: null, colors: null, ok: false, failing: ['this proposal names nothing studio can change'] }, seatName };
    return { changes: themeChangeWords(current, canonicalDelta(current, patch)), check: measureTheme(mergedAppearance(current, patch)), seatName };
  }, [p, stored, preview, previewingThis, seatName, chatId]);
  const themeRefused = themeFacts === null || themeFacts.check.ok ? null : `Can’t preview: ${themeFacts.check.failing.join('; ')}`;
  const startThemePreview = (): void => {
    if (p.theme === undefined || themeRefused !== null) return;
    useAppearanceStore.getState().startPreview({ name: p.theme.name, seat: seatName, chatId, pid: entry.pid, patch: themePatchOf(p.theme.patch) });
  };
  // An Apply of this card's preview from the bar or the Theme page: re-read the chat, so the card shows it answered
  // even without the live frame.
  const savedThis = useAppearanceStore((s) => s.answered === entry.pid);
  useEffect(() => {
    if (savedThis) onChanged();
  }, [savedThis]); // eslint-disable-line react-hooks/exhaustive-deps
  // Focus follows the controls a keyboard used: Preview → the preview's Apply; Back to mine → Preview again.
  const themeFocus = useRef<'apply' | 'go' | null>(null);
  useEffect(() => {
    const want = themeFocus.current;
    if (want === null) return;
    themeFocus.current = null;
    const el = want === 'apply'
      ? sectionRef.current?.querySelector<HTMLElement>('[data-testid="artifact-proposal-theme-apply"]')
      : sectionRef.current?.querySelector<HTMLElement>('[data-ask-option="go"]');
    el?.focus();
  }, [previewingThis]);
  // A5: the protected edits the person lets this refine change (Keep it is the default). Only ids the card shows count:
  // a re-resolved card (the document moved) draws new ids, all kept again.
  const [letChange, setLetChange] = useState<ReadonlySet<string>>(new Set());
  // Any re-resolution (a new head, a new list) starts over with every edit kept, ids that survived included (review r1:
  // a choice is made on one card, never carried to the next).
  const resolutionKey = `${p.pid}\u0000${p.target?.base ?? ''}\u0000${(p.protected ?? []).map((e) => e.id).join('\u0000')}`;
  useEffect(() => {
    setLetChange((was) => (was.size === 0 ? was : new Set()));
  }, [resolutionKey]);
  const toggle = (id: string, change: boolean): void => setLetChange((was) => {
    const next = new Set(was);
    if (change) next.add(id);
    else next.delete(id);
    return next;
  });
  // How many edits the accepted Go kept: from crew's own accepting record, never from what this tab sent.
  const outcome = useRefineOutcome(p, view.state === 'decided' && view.decision === 'go' && p.kind === 'refine' && !stub ? run : null, keptByAccepted(view));
  const detailsId = useId();
  // A card that settles drops the note it showed while it was open.
  useEffect(() => {
    if (!open) {
      setNote(null);
      setAnswering(false);
    }
  }, [open]);

  /** One answer at a time from this card, whichever control sent it (the card's choices or the open form). */
  const sending = useRef(false);
  /** Answer the proposal; resolves crew's refusal words, or `null` when it was taken. */
  const answerWith = async (decision: 'go' | 'not_now', edits?: ProposalEdits): Promise<string | null> => {
    if (sending.current) return 'An answer to this proposal is already on its way.';
    sending.current = true;
    setBusy(true);
    setGoing(decision === 'go');
    // A new answer starts clean: the last one's refusal no longer says anything about this one.
    setRefusedAt(null);
    setError(null);
    setNote(null);
    const keep = (v: ChatProposalView): void => {
      // Crew's view replaces the proposal (with what was accepted, as crew answers it), never the card's place. It
      // stands against the record this answer was sent from: a newer record (another tab's Go, told apart by its time)
      // wins over it. The wire view carries no record time, so an accepting one keeps that record's.
      const next: ProposalEntry = { pid: entry.pid, turnId: entry.turnId, at: entry.at, ...v,
        ...(v.state === 'accepting' && entry.state === 'accepting' && entry.acceptingAt !== undefined ? { acceptingAt: entry.acceptingAt } : {}) };
      if (terminal(v.state)) noteSettled(chatId, next);
      setAnswered({ view: next, against: entry });
    };
    try {
      const r = await api.decideChatProposal(chatId, entry.pid, { decision, ...(edits !== undefined ? { edits } : {}) });
      if (isProposalView(r.view)) keep(r.view);
      return null;
    } catch (err: unknown) {
      const refusal = proposalRefusal(err);
      if (refusal.view !== null) keep(refusal.view);
      // The card keeps every refusal; where it shows depends on what is on screen when it renders (the form while it is
      // open, else under the card), never on the response alone: a live record may already have closed the form.
      setError({ words: refusal.words, settles: refusal.view !== null && terminal(refusal.view.state) });
      // Only crew's launch_failed says THIS Go's accepting record stopped. A refusal before accepting recorded nothing
      // of this Go's, and a transport failure proves nothing: an accepting record on screen then is someone else's Go
      // (another tab), or this one still starting.
      if (refusal.code === 'launch_failed') setRefusedAt(Date.now());
      return refusal.words;
    } finally {
      sending.current = false;
      setBusy(false);
      setGoing(false);
      onChanged();
    }
  };
  const decide = (decision: 'go' | 'not_now'): void => {
    // Only an open card's Go carries the person's choice; Go again resumes the accepted one with its frozen choices.
    if (decision === 'go' && p.kind === 'refine' && view.state === 'open') {
      void answerWith('go', refineGoEdits(p, letChange));
      return;
    }
    void answerWith(decision);
  };
  const onAnswer = (a: AskAnswer): void => {
    // A7: Preview records nothing (the Apply does); Not now ends this card's preview.
    if (a.option === 'go' && p.kind === 'theme') {
      if (sectionRef.current?.contains(document.activeElement) === true) themeFocus.current = 'apply';
      startThemePreview();
    }
    else if (a.option === 'go' || a.option === 'not_now') {
      if (a.option === 'not_now' && previewingThis) useAppearanceStore.getState().endPreview();
      decide(a.option);
    } else if (a.option === 'change') {
      setError(null);
      const route = changeRoute(p.kind);
      if (route.kind === 'form') setAnswering(true);
      else if (route.kind === 'theme') {
        startThemePreview();
        if (themeRefused === null) goTo(SETTINGS_THEME_PATH);
      } else setNote(route.note);
    }
  };
  // A saved Apply re-reads the chat through `savedThis` (whichever surface applied it).
  const applyTheme = (): void => { void useAppearanceStore.getState().applyPreview(); };

  // A3: a real Go takes seconds; while it starts (this tab's request, or a Go recorded moments ago in another tab) the
  // card says so instead of "Interrupted · Go again".
  // Judged against the clock at every render; the timer only makes a render happen when the window closes.
  const [, setTick] = useState(0);
  // A Go whose launch crew said failed (launch_failed) is not starting, whatever its age: the
  // card offers Go again at once. A newer accepting record (another Go) starts the window again.
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const refused = refusedAt !== null && view.state === 'accepting' && (view.acceptingAt ?? 0) <= refusedAt;
  // This tab's Go on its way is starting whatever came before it (from the card or the helpers-only form alike).
  const starting = going || (!refused && proposalStarting(view, Date.now(), false));
  useEffect(() => {
    if (view.state !== 'accepting' || busy || view.acceptingAt === undefined) return;
    // Never skipped: a window that closed between the render and this effect still gets its render (delay 0).
    const left = Math.max(0, view.acceptingAt + PROPOSAL_STARTING_MS - Date.now());
    const t = setTimeout(() => setTick((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [view.state, view.acceptingAt, busy]);
  const line = proposalRecordLine(view, starting);
  const result = proposalResultWords(view);
  return (
    <section
      data-testid="artifact-proposal"
      data-pid={entry.pid}
      data-kind={p.kind}
      data-state={view.state}
      aria-label={`Proposal from ${seatName}: ${p.what.label}`}
      className={`wk-ask wk-proposal${open ? '' : ' wk-proposal--settled'}`}
      ref={sectionRef}
    >
      <p className="wk-ask-who">
        {p.kind === 'theme' ? <Palette size={16} aria-hidden /> : p.kind === 'onboard' ? <GitBranch size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
        <span>{p.kind === 'theme'
          ? (open ? `Theme proposal from ${seatName} · nothing changes until you apply it` : `Theme proposal from ${seatName}`)
          : (open ? `Proposal from ${seatName} · nothing starts until you choose` : `Proposal from ${seatName}`)}</span>
      </p>
      <p className="wk-ask-q" data-testid="artifact-proposal-what">{p.what.label}</p>
      {open || view.state === 'accepting' ? (
        <>
          {p.what.outcome !== null && p.what.outcome !== '' && <p className="wk-ask-sub">{p.what.outcome}</p>}
          <ProposalLines p={p} id={detailsId} theme={themeFacts} />
        </>
      ) : null}
      {open && p.blocked !== null && (
        <p data-testid="artifact-proposal-blocked" className="wk-proposal-blocked">
          <b>Can’t start here yet.</b> {p.blocked}. Nothing was started.
        </p>
      )}
      {(open || view.state === 'accepting') && stub && (
        <p data-testid="artifact-proposal-stub" className="wk-proposal-stub">Test configuration: {open ? GO_WORDS[p.kind] : 'Go again'} records your click and starts nothing.</p>
      )}
      {open && p.kind === 'refine' && p.protected !== undefined && (
        <ProtectedEditsBlock p={p} letChange={letChange} onToggle={toggle} disabled={busy} />
      )}
      {open && previewingThis ? (
        <div className="wk-proposal-again" data-testid="artifact-proposal-previewing" role="group" aria-label={`Previewing ${p.theme?.name ?? 'the theme'}`}>
          <AskRecord line={`Previewing ${p.theme?.name ?? 'the theme'} on this tab only`} testId="artifact-proposal-record" />
          <button type="button" data-testid="artifact-proposal-theme-apply" className="wk-btn wk-btn--primary wk-btn--sm" disabled={busy || saving} onClick={applyTheme}>{saving ? 'Saving…' : 'Apply'}</button>
          <button type="button" data-testid="artifact-proposal-theme-back" className="wk-btn wk-btn--quiet wk-btn--sm" disabled={saving} onClick={() => { themeFocus.current = 'go'; useAppearanceStore.getState().endPreview(); }}>Back to mine</button>
          <button type="button" data-testid="artifact-proposal-theme-open" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => goTo(SETTINGS_THEME_PATH)}>Open in Theme</button>
        </div>
      ) : open && answering ? null : open ? (
        <AskCard ask={proposalAsk(view, { stub, themeRefused })} header={false} busy={busy} onAnswer={onAnswer}
          confirmLabel={(o) => (o.id === 'change' ? (p.kind === 'theme' ? 'Open in Theme' : 'Change something') : o.label)}
          testIds={{ root: 'artifact-proposal-ask', confirm: 'artifact-proposal-confirm' }} />
      ) : view.state === 'accepting' ? (
        <div className="wk-proposal-again">
          <AskRecord line={line ?? ''} testId="artifact-proposal-record" />
          {!starting && !answering && <button type="button" data-testid="artifact-proposal-go-again" className="wk-btn wk-btn--primary wk-btn--sm" disabled={busy} onClick={() => decide('go')}>Go again</button>}
          {/* An interrupted Go resumes with its accepted choices; only its helpers may change (one may have signed out). */}
          {!starting && !answering && p.kind === 'create' && (
            <button type="button" data-testid="artifact-proposal-change-helpers" ref={changeHelpersRef} className="wk-btn wk-btn--quiet wk-btn--sm" disabled={busy} onClick={() => { setError(null); setAnswering(true); }}>Change helpers</button>
          )}
        </div>
      ) : (
        <>
          <div className="wk-proposal-settled">
            <AskRecord line={line ?? ''} testId="artifact-proposal-record" {...(result !== null ? { meta: result } : {})} />
            {/* Mounted before it says anything, so a screen reader hears the outcome when it arrives. */}
            {p.kind === 'refine' && (
              <p data-testid="artifact-proposal-outcome" data-outcome={outcome.kind} role="status"
                className={`wk-proposal-outcome${outcome.kind === 'failed' ? ' wk-proposal-outcome--failed' : ''}`}>
                {refineOutcomeLine(outcome) ?? ''}
              </p>
            )}
            <button type="button" data-testid="artifact-proposal-details" className="wk-btn wk-btn--quiet wk-btn--sm"
              aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((d) => !d)}>
              {details ? 'Hide details' : 'Details'}
            </button>
          </div>
          {/* After the button that opens it (reading order), present but hidden while collapsed (a valid target). */}
          <div id={detailsId} hidden={!details} data-testid="artifact-proposal-details-region">
            {details && (
              <>
                {p.what.outcome !== null && p.what.outcome !== '' && <p className="wk-ask-sub">{p.what.outcome}</p>}
                <ProposalLines p={p} theme={themeFacts} />
              </>
            )}
          </div>
        </>
      )}
      {(open || view.state === 'accepting') && answering && (
        <NewDocument
          projects={projects}
          onClose={() => {
            setAnswering(false);
            setError(null);
            restoreFocus.current = true;
          }}
          answer={{
            proposal: p,
            error: error?.words ?? null,
            // The project moves only in a chat filed in no project (crew re-checks); a retry keeps its document.
            projectChangeable: open && entry.proposal.filedIn.projectId === null && p.artifactRef === undefined,
            fixed: !open || p.artifactRef !== undefined,
            ...(open ? {} : { helpersOnly: true }),
            onSubmit: async (edits) => {
              const refused = await answerWith('go', edits);
              if (refused === null) setAnswering(false);
              return refused;
            },
          }}
        />
      )}
      {open && note !== null && <p data-testid="artifact-proposal-note" role="status" className="wk-proposal-note">{note}</p>}
      {error !== null && !answering && (!terminal(view.state) || (error.settles && view.state !== 'superseded')) && <p data-testid="artifact-proposal-error" role="alert" className="wk-proposal-error">{error.words}</p>}
    </section>
  );
}

/** Crew's facts, one per line, each only when crew stated it (a theme's changes and contrast are studio's measure). */
function ProposalLines({ p, id, theme }: { p: ArtifactProposal; id?: string; theme?: ThemeFacts | null }): React.ReactElement {
  const time = proposalTimeWords(p);
  const has = (v: string | null | undefined): v is string => v !== null && v !== undefined && v.trim() !== '';
  return (
    <dl {...(id !== undefined ? { id } : {})} className="wk-proposal-lines" data-testid="artifact-proposal-lines">
      {p.target !== undefined && <Row k="Changes" testId="artifact-proposal-target">{p.target.title} · v{p.target.base}</Row>}
      {p.kind === 'refine' && has(p.brief) && <Row k="Ask" testId="artifact-proposal-brief">{p.brief}</Row>}
      {p.kind === 'create' && has(p.brief) && <Row k="Brief" testId="artifact-proposal-brief">{p.brief}</Row>}
      {p.touches !== undefined && p.touches.length > 0 && <Row k="Parts" testId="artifact-proposal-touches">{p.touches.join(', ')}</Row>}
      {p.theme !== undefined && theme !== undefined && theme !== null ? (
        <>
          {theme.check.colors !== null && <Row k="Looks" testId="artifact-proposal-theme-swatches"><ThemeSwatches colors={theme.check.colors} /></Row>}
          <Row k="Changes" testId="artifact-proposal-theme">{theme.changes.length > 0 ? theme.changes.join(' · ') : p.theme.changes.join(', ')}</Row>
          <Row k="Contrast" testId="artifact-proposal-theme-contrast">
            <span data-ok={theme.check.ok ? 'true' : 'false'} className={theme.check.ok ? undefined : 'wk-proposal-contrast-low'}>
              {theme.check.ok ? contrastWords(theme.check) : `${contrastWords(theme.check)}${theme.check.ratios !== null ? ` · too low: ${theme.check.failing.join('; ')}` : ''}`}
            </span>
          </Row>
          <Row k="Limits" testId="artifact-proposal-theme-limits">{THEME_LIMITS}</Row>
          <Row k="Checked" testId="artifact-proposal-theme-disclosure">{themeDisclosure(theme.seatName)}</Row>
        </>
      ) : p.theme !== undefined && p.theme.changes.length > 0 ? <Row k="Changes" testId="artifact-proposal-theme">{p.theme.changes.join(', ')}</Row> : null}
      {p.kind === 'onboard' && p.onboard !== undefined && (
        <>
          <Row k="Repository" testId="artifact-proposal-onboard-url">{p.onboard.url}</Row>
          {p.onboard.existing !== null
            ? <Row k="Registered" testId="artifact-proposal-onboard-existing">{`Already registered as ${p.onboard.existing.name}`}</Row>
            : <Row k="Name" testId="artifact-proposal-onboard-name">{p.onboard.name}</Row>}
          {p.onboard.checkout !== null && <Row k="Clones to" testId="artifact-proposal-onboard-checkout">{p.onboard.checkout}</Row>}
        </>
      )}
      {p.demo !== undefined && has(p.demo.url) && <Row k="Records" testId="artifact-proposal-demo">{p.demo.url}</Row>}
      {p.demo !== undefined && has(p.demo.audience) && <Row k="For" testId="artifact-proposal-audience">{p.demo.audience}</Row>}
      {p.demo !== undefined && has(p.demo.show) && <Row k="Shows" testId="artifact-proposal-show">{p.demo.show}</Row>}
      {p.sources.length > 0 && (
        <Row k="From" testId="artifact-proposal-from">
          <span className="wk-proposal-chips">{p.sources.map((s) => <SourceChip key={s.token} s={s} />)}</span>
        </Row>
      )}
      {p.repos.length > 0 && <Row k="About" testId="artifact-proposal-about">{p.repos.join(', ')}</Row>}
      {p.helpers !== null && <Row k="Helpers" testId="artifact-proposal-helpers">{p.helpers.label}</Row>}
      {time !== null && <Row k="Time, cost" testId="artifact-proposal-time">{time}</Row>}
      {has(p.stops) && <Row k="Stops" testId="artifact-proposal-stops">{p.stops}</Row>}
      <Row k={p.kind === 'onboard' ? 'Project' : 'Filed in'} testId="artifact-proposal-filed">{p.filedIn.label}</Row>
      {has(p.reason) && <Row k="Why" testId="artifact-proposal-reason">{p.reason}</Row>}
    </dl>
  );
}

function Row({ k, testId, children }: { k: string; testId: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="wk-proposal-row" data-testid={testId}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A source chip. A struck one is struck through on screen and starts with "Left out:" for a screen reader, then crew's
 *  reason verbatim (or "left out" when crew gave none) — the same facts both ways, nothing invented. */
function SourceChip({ s }: { s: ProposalSource }): React.ReactElement {
  if (s.status === 'ok') return <span data-testid="artifact-proposal-source" data-status="ok" className="wk-proposal-chip">{s.label}</span>;
  const reason = s.reason !== undefined && s.reason.trim() !== '' ? s.reason : null;
  return (
    <span data-testid="artifact-proposal-source" data-status="struck" className="wk-proposal-chip wk-proposal-chip--struck">
      <span className="wk-sr-only">Left out: </span>
      <s>{s.label}</s>
      <span className="wk-proposal-chip-why">{reason !== null ? ` · ${reason}` : ' · left out'}</span>
    </span>
  );
}

/**
 * A5 (DES §6.1-6.2): the person's own edits a refine keeps. The ones the ask is about are listed inline, the rest
 * folded under "Keeping N more of your edits"; each says Keep it (the default) or Let this change it. Only the person
 * releases an edit: what the seat pointed at decides nothing.
 */
function ProtectedEditsBlock({ p, letChange, onToggle, disabled }: {
  p: ArtifactProposal; letChange: ReadonlySet<string>; onToggle: (id: string, change: boolean) => void; disabled: boolean;
}): React.ReactElement {
  const { touched, rest } = protectedGroups(p);
  const [more, setMore] = useState(false);
  const moreId = useId();
  if (touched.length === 0 && rest.length === 0) {
    return <p data-testid="artifact-proposal-protected-none" className="wk-proposal-kept-none">You have no edits of your own on this document to keep.</p>;
  }
  return (
    <div data-testid="artifact-proposal-protected" className="wk-proposal-kept">
      <p className="wk-proposal-kept-head">Your own edits are kept unless you let this change one.</p>
      {touched.length > 0 && (
        <ul className="wk-proposal-kept-list">
          {touched.map((e) => <ProtectedEditRow key={e.id} e={e} change={letChange.has(e.id)} onToggle={onToggle} disabled={disabled} />)}
        </ul>
      )}
      {rest.length > 0 && (
        <>
          <button type="button" data-testid="artifact-proposal-protected-more" className="wk-btn wk-btn--quiet wk-btn--sm"
            aria-expanded={more} aria-controls={moreId} onClick={() => setMore((m) => !m)}>
            {touched.length > 0
              ? `Keeping ${rest.length} more of your edit${rest.length === 1 ? '' : 's'}`
              : rest.length === 1 ? 'Keeping your 1 edit' : `Keeping all ${rest.length} of your edits`}
            {rest.some((e) => letChange.has(e.id)) ? ` · ${rest.filter((e) => letChange.has(e.id)).length} let change` : ''}
          </button>
          <ul id={moreId} hidden={!more} className="wk-proposal-kept-list">
            {more && rest.map((e) => <ProtectedEditRow key={e.id} e={e} change={letChange.has(e.id)} onToggle={onToggle} disabled={disabled} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function ProtectedEditRow({ e, change, onToggle, disabled }: {
  e: ProtectedEdit; change: boolean; onToggle: (id: string, change: boolean) => void; disabled: boolean;
}): React.ReactElement {
  const name = useId();
  return (
    <li data-testid="artifact-proposal-protected-edit" data-edit-id={e.id} data-change={change ? 'true' : 'false'} className="wk-proposal-kept-row">
      <span className="wk-proposal-kept-label">Your edit: {e.label}</span>
      <span role="radiogroup" aria-label={`Your edit: ${e.label}`} className="wk-proposal-kept-choice">
        <label className={`wk-proposal-kept-opt${change ? '' : ' wk-proposal-kept-opt--on'}`}>
          <input type="radio" name={name} checked={!change} disabled={disabled} onChange={() => onToggle(e.id, false)} data-testid="artifact-proposal-keep" />
          Keep it
        </label>
        <label className={`wk-proposal-kept-opt${change ? ' wk-proposal-kept-opt--on' : ''}`}>
          <input type="radio" name={name} checked={change} disabled={disabled} onChange={() => onToggle(e.id, true)} data-testid="artifact-proposal-let-change" />
          Let this change it
        </label>
      </span>
    </li>
  );
}

/** How often a started refine's document is read for its version, and for how long (crew lands it within seconds). */
const OUTCOME_POLL_MS = 3_000;
const OUTCOME_POLL_FOR_MS = 5 * 60_000;

/**
 * A5: what became of a started refine. "Kept your N edits" only once a version that run made is in the document (crew
 * checked the edits AND interactive landed it on the head it started from); a refusal says crew's reason.
 */
function useRefineOutcome(p: ArtifactProposal, run: SessionView | null, kept: number | null): RefineOutcome {
  const [versions, setVersions] = useState<ReadonlyArray<{ version: number; run_id?: string | null }> | null>(null);
  const ref = p.target?.ref ?? null;
  const runId = run?.session.id ?? null;
  const failed = run !== null && (run.session as { landing_failed?: unknown }).landing_failed != null;
  // The status re-arms the watch: a refine still running when the window closed is read again once it ends.
  const status = run !== null ? String((run.session as { status?: unknown }).status ?? '') : '';
  useEffect(() => {
    const parsed = ref === null ? null : parseArtifactRef(ref);
    if (parsed === null || runId === null || failed) return;
    const projectId = parsed.projectId;
    const doc = parsed.docId;
    let stop = false;
    const until = Date.now() + OUTCOME_POLL_FOR_MS;
    const read = async (): Promise<void> => {
      try {
        const m = await getVersions(projectId, doc);
        if (stop) return;
        setVersions(m.versions);
        if (m.versions.some((v) => v.run_id === runId)) return;
      } catch {
        /* read again */
      }
      if (!stop && Date.now() < until) timer = setTimeout(() => void read(), OUTCOME_POLL_MS);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    void read();
    return () => {
      stop = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [ref, runId, failed, status]);
  return refineOutcome(run === null ? null : (run as unknown as { session: { id: string; landing_failed?: { reason?: unknown } | null } }), versions, kept);
}
