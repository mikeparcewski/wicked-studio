import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closeDeckProposal, getDeckReview, HeadMovedError, interactiveDocUrl, openDeckProposal, postEvent, postFork, postSlideDecision,
  putDeckAudience, type DeckReview as Review, type SlideDecisionKind,
} from '../../api/interactive.js';
import { AUDIENCES, audienceLabel, deckOf, type AudiencePreset, type DeckSlide, type Length } from '../../board/deck.js';
import { diffSummary, slideDiff, type SlideDiffRow, type WordPart } from '../../board/deckDiff.js';
import { adaptItems, proposalView, reviewRows, reviewSummary, type ReviewRow } from '../../board/deckReview.js';
import { FEEDBACK_EVENT } from '../../interactive/feedbackBatch.js';

/**
 * P-D1 — a deck's review, drawn by the HOST beside the `wicked-deck` editor (DES-PRESENTATION-EDITOR-001
 * §3-§4; decisions D3, D4, D5, D8). A person's decision is never a plugin message (DES-EDITOR-PLUGINS-001
 * §8.4), so everything that decides lives here:
 *
 *  - per slide: Approve or Ask for changes (with a note), on the version shown. The badge is the
 *    engine's: an approval carries forward only while the slide's content hash is unchanged, else it
 *    reads "Approved on version 4 — changed since". Approvals are a record, never a delivery gate (D4).
 *  - the audience (Executives / Engineers / Customers, or your own words): recorded as is, or "rewrite
 *    it for them" — one governed edit run over the slides (the engine's structural path, the same one
 *    "rewrite this" uses), opened as a PROPOSAL (D3): compare it slide by slide, then Keep it or Drop it
 *    (Drop restores the version it adapted, refused when the deck moved on since).
 */

/** The version's HTML, read the way the frame reads it (crew's proxy, the doc route). */
async function versionHtml(projectId: string, docId: string, version: number): Promise<string> {
  const res = await fetch(interactiveDocUrl(projectId, docId, version));
  if (!res.ok) throw new Error(`version ${version} could not be read (${res.status})`);
  return res.text();
}

function Words({ parts, testid }: { parts: readonly WordPart[]; testid: string }): React.ReactElement {
  return (
    <span data-testid={testid} className="wk-diff-words">
      {parts.map((p, i) => (p.change === 'added' ? <ins key={i} className="wk-diff-add">{p.text}</ins>
        : p.change === 'removed' ? <del key={i} className="wk-diff-del">{p.text}</del> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

const KIND_WORDS: Record<SlideDiffRow['kind'], string> = { added: 'Added', removed: 'Removed', changed: 'Changed', same: 'Same words' };

function Compare({ rows, base, proposed }: { rows: SlideDiffRow[]; base: number; proposed: number }): React.ReactElement {
  const shown = rows.filter((r) => r.kind !== 'same' || r.moved || r.notesChanged);
  const same = rows.length - shown.length;
  return (
    <div data-testid="deck-compare" className="wk-deck-compare" aria-label={`Version ${base} compared with version ${proposed}`}>
      <p data-testid="deck-compare-summary" className="wk-deck-compare-head">Version {base} → {proposed}: {diffSummary(rows)}</p>
      <ol className="wk-deck-compare-list">
        {shown.map((r, i) => {
          const s = r.after ?? r.before!;
          return (
            <li key={i} data-testid="deck-compare-row" data-kind={r.kind} data-moved={r.moved} data-notes={r.notesChanged} className="wk-deck-compare-row">
              <p className="wk-deck-compare-title">
                <span className="wk-tag">{KIND_WORDS[r.kind]}{r.moved ? ' · moved' : ''}{r.notesChanged ? ' · notes' : ''}</span>{' '}
                {r.after !== null ? `Slide ${r.after.n}` : `Was slide ${r.before!.n}`}{s.title === '' ? '' : ` — ${s.title}`}
                {r.moved && r.before !== null && r.after !== null && <> (was {r.before.n})</>}
              </p>
              {r.words !== null && <p className="wk-deck-compare-text"><Words parts={r.words} testid="deck-compare-words" /></p>}
              {r.notes !== null && <p className="wk-deck-compare-text">Notes: <Words parts={r.notes} testid="deck-compare-notes" /></p>}
            </li>
          );
        })}
      </ol>
      {same > 0 && <p className="wk-deck-compare-same">{same} slide{same === 1 ? '' : 's'} unchanged.</p>}
    </div>
  );
}

type Busy = null | 'deciding' | 'audience' | 'starting' | 'keeping' | 'dropping';

export function DeckReview({ projectId, docId, head, onForked }: {
  projectId: string;
  docId: string;
  /** The version the editor shows (the one it read). */
  head: number;
  /** The head moved because of a host action here (Drop forks the base): tell the editor. */
  onForked: (head: number) => void;
}): React.ReactElement {
  const [review, setReview] = useState<Review | null | 'absent'>(null);
  const [slides, setSlides] = useState<DeckSlide[]>([]);
  // The version the review and the slides shown were READ for: every decision names it, and nothing
  // decides while it trails the head the editor shows (codex r1).
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [asks, setAsks] = useState(0);
  const [line, setLine] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [asking, setAsking] = useState<{ id: string; note: string } | null>(null);
  const [form, setForm] = useState<null | { preset: AudiencePreset; label: string; length: Length; keepApproved: boolean }>(null);
  const [compare, setCompare] = useState<{ base: number; proposed: number; rows: SlideDiffRow[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getDeckReview(projectId, docId, head), versionHtml(projectId, docId, head)])
      .then(([r, html]) => { if (!cancelled) { setReview(r === null ? 'absent' : r); setSlides(deckOf(html)); setLoadedFor(head); } })
      .catch((e: unknown) => { if (!cancelled) setLine({ bad: true, text: `The review could not be read: ${e instanceof Error ? e.message : String(e)}` }); });
    return () => { cancelled = true; };
  }, [projectId, docId, head, asks]);

  // A proposal waiting for its run: re-read now and then, so "ready" shows without a reload.
  const waiting = review !== null && review !== 'absent' && review.proposal !== null && head <= review.proposal.base;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => setAsks((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, [waiting]);

  // A compare is of one proposed version: when the head moves on, it is no longer what Keep would keep,
  // and a compare still being read for an older head is dropped when it arrives (codex r2).
  const headRef = useRef(head);
  headRef.current = head;
  useEffect(() => { setCompare((c) => (c !== null && c.proposed !== head ? null : c)); }, [head]);

  // The "a helper is rewriting it" line is about the wait: once the proposal is ready it gives way.
  const ready = review !== null && review !== 'absent' && review.proposal !== null && head > review.proposal.base;
  useEffect(() => { if (ready) setLine(null); }, [ready]);

  const reread = (): void => setAsks((n) => n + 1);
  const fail = (what: string, e: unknown): void => setLine({ bad: true, text: `${what}: ${e instanceof Error ? e.message : String(e)}` });

  const decide = useCallback(async (s: DeckSlide, decision: SlideDecisionKind | 'cleared', note?: string) => {
    if (s.id === null || loadedFor === null) return;
    const version = loadedFor;
    setBusy('deciding');
    try {
      await postSlideDecision(projectId, docId, { version, slide_id: s.id, decision, ...(note !== undefined && note.trim() !== '' ? { note: note.trim() } : {}) });
      setLine({ bad: false, text: decision === 'approved' ? `Slide ${s.n} approved on version ${version}.` : decision === 'cleared' ? `Slide ${s.n}’s review cleared.` : `Changes asked on slide ${s.n}.` });
      setAsking(null);
      reread();
    } catch (e) { fail('Not recorded', e); } finally { setBusy(null); }
  }, [projectId, docId, loadedFor]);

  if (review === null) return <section data-testid="deck-review" data-state="loading" className="wk-deck-review" aria-label="Review" />;
  if (review === 'absent') {
    return (
      <section data-testid="deck-review" data-state="absent" className="wk-deck-review" aria-label="Review">
        <p className="wk-deck-review-note">This document engine keeps no slide reviews yet: update wicked-interactive to approve slides and change the audience.</p>
      </section>
    );
  }

  const rows = reviewRows(slides, review);
  const proposal = proposalView(review.proposal, head);
  const behind = loadedFor !== head;
  const locked = busy !== null || behind;

  const recordAudience = async (): Promise<void> => {
    if (form === null) return;
    setBusy('audience');
    try {
      await putDeckAudience(projectId, docId, { version: head, preset: form.preset, ...(form.preset === 'custom' ? { label: form.label } : {}) });
      setLine({ bad: false, text: `Audience recorded: ${audienceLabel({ preset: form.preset, label: form.label })}.` });
      setForm(null);
      reread();
    } catch (e) { fail('Not recorded', e); } finally { setBusy(null); }
  };

  /** Rewrite it for them (D3): open the proposal, then send one structural batch over the slides. */
  const adapt = async (): Promise<void> => {
    if (form === null) return;
    const audience = { preset: form.preset, label: form.preset === 'custom' ? form.label : null };
    const items = adaptItems(rows, audience, form.length, form.keepApproved);
    if (items.length === 0) { setLine({ bad: true, text: 'Every slide is approved and kept as it is: there is nothing to rewrite.' }); return; }
    setBusy('starting');
    try {
      await openDeckProposal(projectId, docId, { base: head, preset: form.preset, ...(form.preset === 'custom' ? { label: form.label } : {}) });
      try {
        await postEvent(projectId, { event_type: FEEDBACK_EVENT, payload: { document_id: docId, version: head, expect_head: head, author: 'studio', items } });
      } catch (e) {
        // Nothing was sent: the proposal is closed again, so it never waits for a run that never started.
        // When even that fails, it is said, and the rail re-reads so the proposal can be dropped (codex r1).
        const closed = await closeDeckProposal(projectId, docId, { outcome: 'dropped' }).then(() => true, () => false);
        if (!closed) {
          setLine({ bad: true, text: `Not started (${e instanceof Error ? e.message : String(e)}), and the proposal it opened could not be closed: drop it below.` });
          setForm(null);
          reread();
          return;
        }
        throw e;
      }
      setLine({ bad: false, text: `A helper is rewriting ${items.length} slide${items.length === 1 ? '' : 's'} for ${audienceLabel(audience)}. It opens here as a proposal to compare.` });
      setForm(null);
      reread();
    } catch (e) { fail('Not started', e); reread(); } finally { setBusy(null); }
  };

  const openCompare = async (base: number, proposed: number): Promise<void> => {
    try {
      const [a, b] = await Promise.all([versionHtml(projectId, docId, base), versionHtml(projectId, docId, proposed)]);
      if (headRef.current !== proposed) return;
      setCompare({ base, proposed, rows: slideDiff(deckOf(a), deckOf(b)) });
    } catch (e) { fail('The versions could not be compared', e); }
  };

  const keep = async (proposed: number): Promise<void> => {
    setBusy('keeping');
    try {
      await closeDeckProposal(projectId, docId, { outcome: 'kept', version: proposed });
      setLine({ bad: false, text: `Kept: version ${proposed} is the deck for ${proposal.state === 'none' ? '' : proposal.audience}.` });
      setCompare(null);
      reread();
    } catch (e) { fail('Not kept', e); } finally { setBusy(null); }
  };

  const drop = async (base: number): Promise<void> => {
    setBusy('dropping');
    try {
      // Restore the version it adapted — ALWAYS with `expect_head` (codex r1): a rewrite that lands between
      // the click and this fork is a refusal, never buried under a closed proposal.
      const r = await postFork(projectId, docId, base, undefined, head);
      onForked(r.version);
      await closeDeckProposal(projectId, docId, { outcome: 'dropped' });
      setLine({ bad: false, text: head > base ? `Dropped: version ${base} is back.` : `Dropped: version ${base} is the deck. A rewrite still running would land as a new version you can undo.` });
      setCompare(null);
      reread();
    } catch (e) {
      if (e instanceof HeadMovedError) setLine({ bad: true, text: `Not dropped: the deck changed since — version ${e.head}.` });
      else fail('Not dropped', e);
    } finally { setBusy(null); }
  };

  return (
    <section data-testid="deck-review" data-state="ready" data-version={head} className="wk-deck-review" aria-label="Review">
      <header className="wk-deck-review-head">
        <h3 className="wk-deck-review-title">Review</h3>
        <p data-testid="deck-review-summary" className="wk-deck-review-summary">{reviewSummary(rows)}</p>
        <p className="wk-deck-review-note">Approvals are a record of review: they don’t hold up delivery.</p>
        {behind && <p data-testid="deck-review-reading" className="wk-deck-review-note">Reading version {head}…</p>}
      </header>

      <div data-testid="deck-audience" data-preset={review.audience?.preset ?? ''} className="wk-deck-audience">
        <span>Audience: <b data-testid="deck-audience-label">{audienceLabel(review.audience)}</b></span>
        {form === null && proposal.state === 'none' && (
          <button type="button" data-testid="deck-audience-change" className="wk-since-toggle" disabled={locked}
            onClick={() => setForm({ preset: review.audience?.preset ?? 'exec', label: review.audience?.label ?? '', length: 'keep', keepApproved: true })}>
            {review.audience === null ? 'Set it' : 'Change it'}
          </button>
        )}
      </div>

      {form !== null && (
        <fieldset data-testid="deck-audience-form" className="wk-deck-audience-form">
          <legend>Who is this deck for?</legend>
          {AUDIENCES.map((a) => (
            <label key={a.preset} className="wk-deck-radio">
              <input type="radio" name="deck-audience" data-testid="deck-audience-preset" value={a.preset} checked={form.preset === a.preset} onChange={() => setForm({ ...form, preset: a.preset })} /> {a.label}
            </label>
          ))}
          <label className="wk-deck-radio">
            <input type="radio" name="deck-audience" data-testid="deck-audience-preset" value="custom" checked={form.preset === 'custom'} onChange={() => setForm({ ...form, preset: 'custom' })} /> Someone else
          </label>
          {form.preset === 'custom' && (
            <input type="text" data-testid="deck-audience-custom" aria-label="Who, in your words" maxLength={200} placeholder="The board of trustees" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="wk-deck-input" />
          )}
          <p className="wk-deck-form-row">
            <label>Length{' '}
              <select data-testid="deck-audience-length" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value as Length })}>
                <option value="keep">Keep it</option>
                <option value="shorten">Shorter</option>
                <option value="expand">Longer</option>
              </select>
            </label>
          </p>
          <label className="wk-deck-radio">
            <input type="checkbox" data-testid="deck-audience-keep-approved" checked={form.keepApproved} onChange={(e) => setForm({ ...form, keepApproved: e.target.checked })} /> Keep the slides I approved as they are
          </label>
          <p className="wk-deck-review-note">
            Rewriting starts one helper run over the slides. It opens as a proposal: you compare it slide by slide, then keep it or drop it.
          </p>
          <p className="wk-deck-form-row">
            <button type="button" data-testid="deck-audience-adapt" className="wk-btn wk-btn--primary wk-btn--sm" disabled={locked || (form.preset === 'custom' && form.label.trim() === '')} onClick={() => void adapt()}>Rewrite it for them</button>{' '}
            <button type="button" data-testid="deck-audience-record" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={locked || (form.preset === 'custom' && form.label.trim() === '')} onClick={() => void recordAudience()}>Just record it</button>{' '}
            <button type="button" data-testid="deck-audience-cancel" className="wk-since-toggle" onClick={() => setForm(null)}>Cancel</button>
          </p>
        </fieldset>
      )}

      {proposal.state !== 'none' && (
        <div data-testid="deck-proposal" data-state={proposal.state} className="wk-deck-proposal">
          {proposal.state === 'waiting'
            ? <p>Rewriting version {proposal.base} for {proposal.audience}: a helper is working on it. It opens here when it lands.</p>
            : <p>Proposed for {proposal.audience}: version {proposal.proposed} (from version {proposal.base}).</p>}
          <p className="wk-deck-form-row">
            {proposal.state === 'ready' && (
              <>
                <button type="button" data-testid="deck-proposal-compare" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => void (compare === null ? openCompare(proposal.base, proposal.proposed) : Promise.resolve(setCompare(null)))}>{compare === null ? 'Compare' : 'Hide the compare'}</button>{' '}
                <button type="button" data-testid="deck-proposal-keep" className="wk-btn wk-btn--primary wk-btn--sm" disabled={locked} onClick={() => void keep(proposal.proposed)}>Keep it</button>{' '}
              </>
            )}
            <button type="button" data-testid="deck-proposal-drop" className="wk-btn wk-btn--quiet wk-btn--sm" disabled={locked} onClick={() => void drop(proposal.base)}>Drop it</button>
          </p>
          {compare !== null && compare.proposed === head && <Compare rows={compare.rows} base={compare.base} proposed={compare.proposed} />}
        </div>
      )}

      {line !== null && <p data-testid="deck-review-line" className={`wk-artifact-line${line.bad ? ' wk-artifact-line--bad' : ''}`}>{line.text}</p>}

      <ol data-testid="deck-review-slides" className="wk-deck-review-list">
        {rows.map((r: ReviewRow) => (
          <li key={r.slide.id ?? `#${r.slide.n}`} data-testid="deck-review-row" data-slide-id={r.slide.id ?? ''} data-state={r.state} className={`wk-deck-review-row wk-deck-review-row--${r.state}`}>
            <p className="wk-deck-review-slide"><span className="wk-slide-n">{r.slide.n}</span> {r.slide.title === '' ? `Slide ${r.slide.n}` : r.slide.title}</p>
            <p data-testid="deck-review-badge" className="wk-deck-review-badge">{r.words}</p>
            {r.slide.id !== null && (
              asking?.id === r.slide.id ? (
                <p className="wk-deck-form-row">
                  <input type="text" data-testid="deck-review-note" aria-label={`What should change on slide ${r.slide.n}`} maxLength={2000} placeholder="What should change" value={asking.note} onChange={(e) => setAsking({ id: asking.id, note: e.target.value })} className="wk-deck-input" />
                  <button type="button" data-testid="deck-review-save-changes" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={locked} onClick={() => void decide(r.slide, 'changes_requested', asking.note)}>Save</button>
                  <button type="button" className="wk-since-toggle" onClick={() => setAsking(null)}>Cancel</button>
                </p>
              ) : (
                <p className="wk-deck-form-row">
                  {r.state !== 'approved' && <button type="button" data-testid="deck-review-approve" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={locked} onClick={() => void decide(r.slide, 'approved')}>Approve</button>}
                  {r.state !== 'changes' && <button type="button" data-testid="deck-review-ask" className="wk-since-toggle" disabled={locked} onClick={() => setAsking({ id: r.slide.id!, note: r.note ?? '' })}>Ask for changes</button>}
                  {r.state !== 'none' && <button type="button" data-testid="deck-review-clear" className="wk-since-toggle" disabled={locked} onClick={() => void decide(r.slide, 'cleared')}>Clear</button>}
                </p>
              )
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
