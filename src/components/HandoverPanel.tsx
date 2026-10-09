import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { OUTBOUND_TITLE, outboundKindFor } from '../api/outbound.js';
import {
  clockTime,
  HANDOVER_CHIP_ACTION,
  HANDOVER_CHIP_NOUN,
  handoverChips,
  handoverSettled,
  listedKeys,
  type HandoverChip,
  type HandoverChipKey,
  type HandoverItem,
} from '../board/handover.js';
import { COUNT_TONE_COLOR, countTone, type CountKind } from '../board/countTone.js';
import type { Handover } from '../hooks/useHandover.js';
import { useReusePreset } from '../hooks/useReusePreset.js';
import type { Navigate } from '../hooks/useRoute.js';
import { useQueueReveal } from '../store/queueReveal.js';
import { useHandoverProgress } from '../store/visit.js';
import { AnchoredOverlay } from './AnchoredOverlay.js';
import { ReusePresetPanel } from './FinishedRunRow.js';
import { Modal } from './Modal.js';
import { OutboundDraft } from './OutboundDraft.js';
import { ago } from './AgeStamp.js';
import { humanTitle } from './runIdentity.js';

/**
 * THE HANDOVER STRIP (studio wave 2b, behaviour 1; reworked on operator feedback — the old
 * four-column panel grew with its items and pushed every section off the page). ONE fixed-height
 * line: "Since 21:11 · 3h ago — [2 decisions due] [1 broke] [1 finished] [1 done for you] · Got it".
 *
 *   decisions due / broke → reveal those rows in the Needs You queue, where their Open gate /
 *                           Retry verbs already live (never duplicated here);
 *   finished              → an overlay: each finished run with its next use (Open, Draft update,
 *                           Reuse as preset — the Runs list's model);
 *   done for you          → an overlay: what your standing orders and the system did, each with
 *                           Open and its audit entry.
 *
 * "Got it" clears the handover (records the visit). It also clears itself once every item it
 * listed has been acted on or resolved (`handoverSettled`). Rendering + wiring only: the fold is
 * `useHandover` / `board/handover.ts`.
 */

const CHIP_KIND: Record<HandoverChipKey, CountKind> = {
  decisions: 'gate',
  broke: 'fail',
  finished: 'neutral',
  done: 'neutral',
};

export function HandoverPanel({ handover, navigate, now, runs }: {
  handover: Handover;
  navigate: Navigate;
  now: number;
  runs: readonly SessionView[];
}): React.ReactElement | null {
  const { since, sections, dismiss } = handover;
  const chips = useMemo(() => handoverChips(sections), [sections]);
  const progress = useHandoverProgress();
  const [open, setOpen] = useState<HandoverChipKey | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const chipEls = useRef<Partial<Record<HandoverChipKey, HTMLButtonElement | null>>>({});

  // Remember what the handover has listed for this absence, once every section has been read.
  const listed = useMemo(() => listedKeys(sections), [sections]);
  const reading = sections.some((s) => s.state === 'loading');
  useEffect(() => {
    if (since !== null && !reading && listed.length > 0) progress.noteListed(since, listed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the list's content
  }, [since, reading, listed.join('\n')]);

  // Everything listed has been acted on or resolved: nothing is left to hand over.
  const mine = progress.since === since ? progress : null;
  const settled = since !== null && mine !== null && handoverSettled(sections, mine.listed, mine.acted);
  useEffect(() => {
    if (settled && drafting === null) dismiss();
  }, [settled, drafting, dismiss]);

  const closeOverlay = useCallback(() => setOpen(null), []);

  if (since === null) return null;
  const acted = (key: string): void => useHandoverProgress.getState().markActed(key);
  const shown = chips.filter((c) => c.items.length > 0 || c.state !== 'ready');

  const press = (c: HandoverChip): void => {
    if (HANDOVER_CHIP_ACTION[c.key] === 'reveal') {
      setOpen(null);
      useQueueReveal.getState().reveal(c.items.map((i) => i.key));
      return;
    }
    setOpen((cur) => (cur === c.key ? null : c.key));
  };

  const openChip = open !== null ? chips.find((c) => c.key === open) : undefined;
  const draftView = drafting !== null ? runs.find((v) => v.session.id === drafting) : undefined;

  return (
    <section
      data-testid="handover-panel"
      aria-label="While you were away"
      className="wk-handover wk-handover--desk-away"
    >
      <span className="wk-handover-label">While you were away</span>
      <span data-testid="handover-since" className="wk-handover-since" title={`Away from ${clockTime(since)}`}>
        Since {clockTime(since)} · {ago(since, now)} ago
      </span>
      <span aria-hidden className="wk-handover-sep">—</span>
      {shown.length === 0 && (
        <span className="wk-handover-quiet">nothing needs you from it</span>
      )}
      {shown.map((c) => {
        const tone = countTone(c.items.length, CHIP_KIND[c.key]);
        const overlay = HANDOVER_CHIP_ACTION[c.key] === 'overlay';
        const failed = c.state === 'failed';
        return (
          <button
            key={c.key}
            ref={(el) => { chipEls.current[c.key] = el; }}
            type="button"
            className="wk-chip wk-handover-chip"
            data-testid="handover-chip"
            data-section={c.key}
            data-count={c.items.length}
            data-state={c.state}
            data-tone={tone}
            disabled={failed || (c.state === 'loading' && c.items.length === 0)}
            aria-haspopup={overlay ? 'dialog' : undefined}
            aria-expanded={overlay ? open === c.key : undefined}
            title={
              failed
                ? 'This daemon cannot say what the system did (the audit read failed).'
                : overlay
                  ? `Show what ${HANDOVER_CHIP_NOUN[c.key](c.items.length).replace('done for you', 'was done for you')}`
                  : 'Show them in Needs you'
            }
            onClick={() => press(c)}
          >
            {failed ? (
              <span>{HANDOVER_CHIP_NOUN[c.key](0)}: cannot say</span>
            ) : (
              <>
                <b className="wk-handover-count" style={{ color: COUNT_TONE_COLOR[tone] ?? 'var(--ink-high)' }}>
                  {c.state === 'loading' && c.items.length === 0 ? '…' : c.items.length}
                </b>
                <span>{HANDOVER_CHIP_NOUN[c.key](c.items.length)}</span>
              </>
            )}
          </button>
        );
      })}
      <button type="button" data-testid="handover-dismiss" className="wk-btn wk-btn--sm wk-btn--quiet wk-handover-dismiss" onClick={dismiss} title="Clear this handover — it returns after your next absence">
        Got it
      </button>

      {openChip !== undefined && (
        <AnchoredOverlay
          anchor={chipEls.current[openChip.key] ?? null}
          onClose={closeOverlay}
          label={openChip.key === 'finished' ? 'What finished while you were away' : 'What was done for you while you were away'}
          testId="handover-overlay"
          section={openChip.key}
          width={openChip.key === 'finished' ? 520 : 480}
        >
          {openChip.key === 'finished' && <p className="wk-overlay-head">Finished while you were away</p>}
          {openChip.key === 'finished' ? (
          <ul className="wk-overlay-list">
            {openChip.items.map((it) => (
                <FinishedItem
                  key={it.key}
                  item={it}
                  view={runs.find((v) => v.session.id === it.runId)}
                  now={now}
                  onOpen={() => { acted(it.key); setOpen(null); navigate(it.path); }}
                  onDraft={() => { acted(it.key); setDrafting(it.runId); }}
                  onReuse={() => acted(it.key)}
                />
            ))}
          </ul>
          ) : (
            // Who acted stays said: what your standing orders did, then what the system did.
            openChip.groups.map((g) => (
              <div key={g.key} data-testid="handover-overlay-group" data-group={g.key} className="wk-overlay-group">
                <p className="wk-overlay-subhead">{g.title}</p>
                <ul className="wk-overlay-list">
                  {g.items.map((it) => (
                    <DoneItem
                      key={it.key}
                      item={it}
                      now={now}
                      onOpen={() => { acted(it.key); setOpen(null); navigate(it.path); }}
                      onAudit={() => acted(it.key)}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </AnchoredOverlay>
      )}
      {drafting !== null && (
        <Modal title={OUTBOUND_TITLE[outboundKindFor(draftView?.session.status ?? 'completed')]} onClose={() => setDrafting(null)}>
          <OutboundDraft kind={outboundKindFor(draftView?.session.status ?? 'completed')} runId={drafting} />
        </Modal>
      )}
    </section>
  );
}

function ItemHead({ item, now }: { item: HandoverItem; now: number }): React.ReactElement {
  return (
    <span className="wk-overlay-item-head">
      <span className="wk-overlay-item-title" title={item.subject}>{humanTitle(item.subject)}</span>
      <span className="wk-overlay-item-text" title={item.text}>{item.text}</span>
      {item.at !== null && <span className="wk-overlay-item-age">{ago(item.at, now)} ago</span>}
    </span>
  );
}

/** A finished run and what it can become next (the Runs list's next-use model, Wave C). */
function FinishedItem({ item, view, now, onOpen, onDraft, onReuse }: {
  item: HandoverItem;
  view: SessionView | undefined;
  now: number;
  onOpen: () => void;
  onDraft: () => void;
  onReuse: () => void;
}): React.ReactElement {
  return view === undefined ? (
    <FinishedRow item={item} now={now} onOpen={onOpen} onDraft={onDraft} />
  ) : (
    <FinishedRunRowItem item={item} view={view} now={now} onOpen={onOpen} onDraft={onDraft} onReuse={onReuse} />
  );
}

function FinishedRunRowItem({ view, onReuse, ...rest }: {
  item: HandoverItem;
  view: SessionView;
  now: number;
  onOpen: () => void;
  onDraft: () => void;
  onReuse: () => void;
}): React.ReactElement {
  const reuse = useReusePreset(view);
  const s = reuse.state;
  const panelOpen = s.phase === 'open' || s.phase === 'saving' || s.phase === 'error';
  const move = reuse.steps.length > 0 && s.phase !== 'saved' ? (
    <button
      type="button"
      data-testid="handover-item-reuse"
      className="wk-btn wk-btn--sm wk-btn--secondary"
      aria-expanded={panelOpen}
      title={`Save this run's ${reuse.steps.length}-step plan as a preset you can launch by name`}
      onClick={() => { onReuse(); if (panelOpen) reuse.close(); else reuse.open(); }}
    >
      Reuse as preset
    </button>
  ) : s.phase === 'saved' ? (
    <span data-testid="run-reuse-saved" className="wk-overlay-note" style={{ color: 'var(--status-done)' }}>
      {`Saved as preset “${s.name}” — launch it with /workflow-${s.name}`}
    </span>
  ) : null;
  return <FinishedRow {...rest} move={move} panel={panelOpen ? <ReusePresetPanel reuse={reuse} /> : null} />;
}

function FinishedRow({ item, now, onOpen, onDraft, move = null, panel = null }: {
  item: HandoverItem;
  now: number;
  onOpen: () => void;
  onDraft: () => void;
  move?: React.ReactNode;
  panel?: React.ReactNode;
}): React.ReactElement {
  return (
    <li data-testid="handover-item" data-run-id={item.runId ?? undefined} className="wk-overlay-item">
      <ItemHead item={item} now={now} />
      <span className="wk-overlay-item-acts">
        <a
          href={item.path}
          data-testid="handover-item-open"
          className="wk-btn wk-btn--sm wk-btn--link"
          onClick={(e) => { e.preventDefault(); onOpen(); }}
        >
          Open ›
        </a>
        {item.runId !== null && (
          <button
            type="button"
            data-testid="handover-item-draft"
            className="wk-btn wk-btn--sm wk-btn--secondary"
            title="Draft an update about this run from its record. Nothing is sent: edit it, then copy it out"
            onClick={onDraft}
          >
            Draft update
          </button>
        )}
        {move}
      </span>
      {panel}
    </li>
  );
}

/** An action a standing order or the system took for you: Open (its run) and its audit entry. */
function DoneItem({ item, now, onOpen, onAudit }: {
  item: HandoverItem;
  now: number;
  onOpen: () => void;
  onAudit: () => void;
}): React.ReactElement {
  const [showAudit, setShowAudit] = useState(false);
  const a = item.audit;
  return (
    <li data-testid="handover-item" data-run-id={item.runId ?? undefined} className="wk-overlay-item">
      <ItemHead item={item} now={now} />
      <span className="wk-overlay-item-acts">
        {item.runId !== null && (
          <a
            href={item.path}
            data-testid="handover-item-open"
            className="wk-btn wk-btn--sm wk-btn--link"
            onClick={(e) => { e.preventDefault(); onOpen(); }}
          >
            Open ›
          </a>
        )}
        {a !== undefined && (
          <button
            type="button"
            data-testid="handover-item-audit"
            className="wk-btn wk-btn--sm wk-btn--quiet"
            aria-expanded={showAudit}
            onClick={() => { onAudit(); setShowAudit(!showAudit); }}
          >
            {showAudit ? 'Hide audit entry' : 'Audit entry'}
          </button>
        )}
      </span>
      {showAudit && a !== undefined && (
        <dl data-testid="handover-item-audit-entry" className="wk-overlay-audit">
          <dt>action</dt><dd>{a.action}</dd>
          <dt>actor</dt><dd>{a.actor}</dd>
          <dt>at</dt><dd>{new Date(a.ts).toLocaleString()}</dd>
          {item.runId !== null && (<><dt>run</dt><dd>{item.runId}</dd></>)}
          {a.detail !== undefined && Object.keys(a.detail).length > 0 && (
            <><dt>detail</dt><dd>{JSON.stringify(a.detail)}</dd></>
          )}
        </dl>
      )}
    </li>
  );
}
