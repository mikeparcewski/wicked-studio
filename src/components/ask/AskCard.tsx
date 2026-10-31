import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Ask, AskAnswer, AskOption } from '../../api/ask.js';
import { initialOption, initialPicks, pickBounds } from '../../board/askModel.js';

/**
 * THE GUIDED ASK (design DES-GUIDED-CHAT; the operator's approved mockup learn-and-panels state h). One renderer for
 * every question a person answers inline: a gate, a seat's or MCP server's question, the power-mode pause, a setup
 * step. It replaces button rows inside bubbles:
 *
 *  - choose / confirm_reason: option cards in a radio group, the recommended one marked and preselected; the option
 *    you are on (hovered, else selected) says what happens ("If you choose this: …"); a danger option asks for a
 *    reason; nothing is sent until the primary button.
 *  - confirm: two halves; picking one is the answer.
 *  - pick: chips (checkboxes) with a count, Select all, and the bounds; a disabled chip stays visible with why.
 *  - scale: a slider over named steps, with the step's consequence.
 *  - text: a short text box, optionally "Nothing to add".
 *
 * Keyboard: Tab reaches the group's one selected card; arrows / Home / End move the selection; a digit picks the
 * nth option; Enter on a card answers with it. Every control carries its own label for a screen reader.
 *
 * The host owns the answer: `onAnswer` gets an `AskAnswer` and turns it into its own wire body (a gate's goes
 * through the 10 s undo queue). Once answered the host draws {@link AskRecord} in the card's place.
 */

export interface AskReason {
  /** The label over the box ("Why stop? (kept with the record)"). */
  label: string;
  placeholder?: string;
  /** Words already in the box (a send-back's failing items), still the person's to edit. */
  prefill?: string;
  /** The primary button's words while this option is selected ("Stop with this reason"). */
  send?: string;
  /** Said before the box (what the move does, when it must be read before the words: a floor override). */
  note?: React.ReactNode;
  /** The label's test id (a gate keeps its journeys' ids). */
  labelTestId?: string;
}

export interface AskCardProps {
  ask: Ask;
  onAnswer: (answer: AskAnswer) => void;
  busy?: boolean;
  /** Draw the who / question header (a host that draws its own question, a gate row, passes false). */
  header?: boolean;
  /** Pills and words for the header's eyebrow ("Gate" · "The engine asks"). */
  tag?: string;
  /** The option to start on instead of the ask's default (a gate's derived move). */
  start?: string | null;
  /** The reason box for an option that asks for one; absent: "Why? (kept with the record)". */
  reasonFor?: (o: AskOption) => AskReason;
  /** The primary button's words for the selected option (absent: the option's label). */
  confirmLabel?: (o: AskOption) => string;
  /** More attributes on an option's card (a gate's legacy test ids, its title). */
  optionProps?: (o: AskOption, index: number) => Record<string, string | undefined>;
  /** More inside an option's card (a seat's track record). */
  optionExtra?: (o: AskOption) => React.ReactNode;
  /** More attributes on the primary button, for the selected option (a card's legacy `data-draft`). */
  confirmProps?: (o: AskOption | null) => Record<string, string | undefined>;
  /** More inside the primary button, for the selected option (the creator seat's record on Deliver). */
  confirmExtra?: (o: AskOption | null) => React.ReactNode;
  /** A quiet line under the primary button ("You can undo for 10 s after you continue."). */
  footnote?: React.ReactNode;
  /** More in the button row, after the primary (a move that is not an answer: sign a helper in). */
  aside?: React.ReactNode;
  /** The primary act when the host leads with a move that is not an answer (sign a helper in): replaces the confirm
   *  button until an option is selected. */
  leadAct?: React.ReactNode;
  /** The selected option changed (a host that shows more about it). */
  onSelect?: (id: string | null) => void;
  /** Escape inside the reason box. */
  onCancelReason?: () => void;
  /** Test ids: a gate keeps the ones its journeys read. */
  testIds?: Partial<Record<'root' | 'group' | 'option' | 'consequence' | 'confirm' | 'send' | 'reason' | 'reasonLabel', string>>;
  /** Override the focus target id for the reason box (a gate's label `htmlFor`). */
  reasonId?: string;
}

const tid = (ids: AskCardProps['testIds'], k: keyof NonNullable<AskCardProps['testIds']>, d: string): string => ids?.[k] ?? d;

export function AskCard(props: AskCardProps): React.ReactElement {
  const { ask, header = true } = props;
  return (
    <div
      data-testid={tid(props.testIds, 'root', /* testid */ 'ask-card')}
      data-ask-kind={ask.kind}
      data-ask-host={ask.host}
      role="group"
      aria-label={ask.prompt}
      className={`wk-ask${ask.host === 'gate' ? ' wk-ask--gate' : ''}${header ? '' : ' wk-ask--bare'}`}
    >
      {header && (
        <>
          <p className="wk-ask-who">
            {props.tag !== undefined && <span className="wk-ask-tag" data-tone={ask.host === 'gate' ? 'gate' : 'accent'}>{props.tag}</span>}
            <span>{ask.from.label}</span>
          </p>
          <p className="wk-ask-q" data-testid="ask-question">{ask.prompt}</p>
          {ask.detail !== undefined && <p className="wk-ask-sub">{ask.detail}</p>}
        </>
      )}
      {ask.kind === 'choose' || ask.kind === 'confirm' || ask.kind === 'confirm_reason' ? <ChooseBody {...props} />
        : ask.kind === 'pick' ? <PickBody {...props} />
        : ask.kind === 'scale' ? <ScaleBody {...props} />
        : <TextBody {...props} />}
    </div>
  );
}

/** Choose one (and confirm, confirm_reason): radio cards, the consequence line, the reason box, the primary. */
function ChooseBody({ ask, onAnswer, busy = false, start, reasonFor, confirmLabel, optionProps, optionExtra, confirmProps, confirmExtra, footnote, aside, leadAct, onSelect, onCancelReason, testIds, reasonId }: AskCardProps): React.ReactElement {
  const options = useMemo(() => ask.options ?? [], [ask.options]);
  const enabled = options.filter((o) => o.disabled === undefined);
  const [sel, setSel] = useState<string | null>(() => (start !== undefined ? start : initialOption(ask)));
  const [hover, setHover] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  // An option that asks for words opens its box once the person takes it (picks it, or presses the primary on it):
  // a preselected one never opens a box, or a prefilled one would be sent unread, and never takes the caret.
  const [engaged, setEngaged] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const autoId = useId();
  const boxId = reasonId ?? `${autoId}-reason`;
  // A new start (the host's derived move arrived) moves the selection once.
  const startRef = useRef(start);
  useEffect(() => {
    if (start === startRef.current) return;
    startRef.current = start;
    if (start !== undefined) setSel(start);
  }, [start]);
  useEffect(() => { onSelect?.(sel); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = options.find((o) => o.id === sel) ?? null;
  const shown = options.find((o) => o.id === (hover ?? sel)) ?? null;
  const needsReason = current !== null && (current.needsReason === true || ask.kind === 'confirm_reason');
  const open = needsReason && current !== null && engaged === current.id;
  const reasonCfg: AskReason | null = current === null || !open ? null
    : reasonFor?.(current) ?? { label: current.tone === 'danger' ? `Why ${current.label.toLowerCase()}? (kept with the record)` : 'Why? (kept with the record)', placeholder: 'One line is enough' };
  const reasonText = current === null ? '' : reasons[current.id] ?? reasonCfg?.prefill ?? '';

  // Opening a reason box puts the caret at its end (a prefilled send-back note is the person's to finish).
  const reasonFor_ = open ? current?.id ?? null : null;
  useEffect(() => {
    if (reasonFor_ === null) return;
    const el = reasonRef.current;
    if (el === null) return;
    el.focus({ preventScroll: true });
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* a field that refuses a selection still has focus */ }
    // Into view above the dock's sticky primary (its room is the box's scroll-margin, ask-card.css).
    el.scrollIntoView?.({ block: 'nearest' });
  }, [reasonFor_]);

  const commit = (o: AskOption | null): void => {
    if (o === null || o.disabled !== undefined || busy) return;
    const needs = o.needsReason === true || ask.kind === 'confirm_reason';
    if (needs) {
      if (o.id !== sel || engaged !== o.id) { setSel(o.id); setEngaged(o.id); return; }
      const r = (reasons[o.id] ?? reasonFor?.(o).prefill ?? '').trim();
      if (r === '') { setMissing(true); reasonRef.current?.focus(); return; }
      onAnswer({ askId: ask.id, option: o.id, reason: r });
      return;
    }
    onAnswer({ askId: ask.id, option: o.id });
  };

  const pick = (o: AskOption): void => {
    if (o.disabled !== undefined) return;
    setSel(o.id);
    setMissing(false);
    setEngaged(o.needsReason === true || ask.kind === 'confirm_reason' ? o.id : null);
    if (ask.kind === 'confirm' && o.needsReason !== true) onAnswer({ askId: ask.id, option: o.id });
  };

  const focusOption = (id: string): void => {
    groupRef.current?.querySelector<HTMLElement>(`[data-ask-option="${CSS.escape(id)}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent, o: AskOption): void => {
    const i = enabled.findIndex((x) => x.id === o.id);
    let to: AskOption | undefined;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') to = enabled[0];
    else if (e.key === 'End') to = enabled[enabled.length - 1];
    else if (/^[1-9]$/.test(e.key)) to = enabled[Number(e.key) - 1];
    else if (e.key === 'Enter') { e.preventDefault(); if (sel !== o.id) setSel(o.id); commit(o); return; }
    if (to === undefined) return;
    e.preventDefault();
    setSel(to.id);
    setMissing(false);
    setEngaged(null);
    focusOption(to.id);
  };

  const tabStop = sel !== null && enabled.some((o) => o.id === sel) ? sel : enabled[0]?.id ?? null;
  const confirmWords = current === null ? 'Choose an option' : reasonCfg?.send ?? confirmLabel?.(current) ?? current.label;
  const consId = `${autoId}-cons`;

  return (
    <>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={ask.prompt}
        aria-describedby={consId}
        data-testid={tid(testIds, 'group', /* testid */ 'ask-options')}
        // A typed letter goes on to the page's composer (§5.6 rule 4): only arrows, digits and Enter act here.
        data-releases-letters="true"
        className={ask.kind === 'confirm' ? 'wk-ask-yn' : `wk-ask-opts${options.length > 4 ? ' wk-ask-opts--many' : ''}`}
      >
        {options.map((o, i) => {
          const on = o.id === sel;
          const extra = optionProps?.(o, i) ?? {};
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-ask-option={o.id}
              data-testid={tid(testIds, 'option', /* testid */ 'ask-option')}
              data-selected={on ? 'true' : 'false'}
              {...(o.tone !== undefined ? { 'data-tone': o.tone } : {})}
              tabIndex={o.id === tabStop ? 0 : -1}
              {...(o.id === tabStop ? { 'data-ask-focus': 'true' } : {})}
              disabled={busy || o.disabled !== undefined}
              aria-disabled={o.disabled !== undefined ? true : undefined}
              title={o.disabled ?? o.consequence ?? o.label}
              className="wk-ask-opt"
              onClick={() => pick(o)}
              onKeyDown={(e) => onKey(e, o)}
              onMouseEnter={() => setHover(o.id)}
              onMouseLeave={() => setHover(null)}
              {...extra}
            >
              <b className="wk-ask-opt-label">{o.label}</b>
              {o.sub !== undefined && <span className="wk-ask-opt-sub">{o.sub}</span>}
              {o.disabled !== undefined && <span className="wk-ask-opt-sub wk-ask-opt-why" data-testid="ask-option-why">{o.disabled}</span>}
              {o.meta !== undefined && <span className="wk-ask-meta" data-testid="ask-option-meta">{o.meta}</span>}
              {optionExtra?.(o)}
              {/* After the words (drawn in the corner), so the card's name reads label first. */}
              {o.recommended === true && ask.kind !== 'confirm' && <span className="wk-ask-rec" data-testid="ask-recommended">Recommended</span>}
            </button>
          );
        })}
      </div>
      {/* What happens next, for the option you are on: reserved height, so hovering never moves a card. */}
      <p id={consId} data-testid={tid(testIds, 'consequence', /* testid */ 'ask-consequence')} {...(shown !== null ? { 'data-option': shown.id } : {})} aria-live="polite" className="wk-ask-cons">
        {shown?.consequence !== undefined ? <><b>If you choose this:</b> {shown.consequence}</> : null}
      </p>
      {reasonCfg !== null && current !== null && (
        <div className="wk-ask-reason" data-testid="ask-reason">
          {reasonCfg.note}
          <label htmlFor={boxId} data-testid={reasonCfg.labelTestId ?? tid(testIds, 'reasonLabel', /* testid */ 'ask-reason-label')}>{reasonCfg.label}</label>
          <textarea
            id={boxId}
            ref={reasonRef}
            data-testid={tid(testIds, 'reason', /* testid */ 'ask-reason-text')}
            className="wk-ask-text"
            rows={3}
            value={reasonText}
            placeholder={reasonCfg.placeholder}
            aria-required="true"
            aria-invalid={missing && reasonText.trim() === '' ? true : undefined}
            onChange={(e) => { const v = e.target.value; setReasons((r) => ({ ...r, [current.id]: v })); setMissing(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEngaged(null); onCancelReason?.(); }
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(current); }
            }}
          />
        </div>
      )}
      {ask.kind !== 'confirm' && (
        <div className="wk-ask-go">
          {current === null && leadAct !== undefined && leadAct !== null ? leadAct : (
            <button
              type="button"
              data-testid={open ? tid(testIds, 'send', /* testid */ 'ask-send') : tid(testIds, 'confirm', /* testid */ 'ask-confirm')}
              data-option={current?.id}
              disabled={busy || current === null || (open && reasonText.trim() === '')}
              onClick={() => commit(current)}
              className={`wk-gate2-btn ${current?.tone === 'danger' ? 'wk-ask-btn--danger' : 'wk-gate2-btn--primary'}`}
              {...(confirmProps?.(current) ?? {})}
            >
              {busy ? 'Sending…' : confirmWords}
              {!busy && confirmExtra?.(current)}
            </button>
          )}
          {aside}
          {footnote !== undefined && footnote !== null && <span className="wk-ask-foot">{footnote}</span>}
        </div>
      )}
    </>
  );
}

/** Pick several: checkbox chips, a count with the bounds, Select all, the primary. */
function PickBody({ ask, onAnswer, busy = false, footnote, aside, testIds }: AskCardProps): React.ReactElement {
  const options = ask.options ?? [];
  const [picked, setPicked] = useState<string[]>(() => initialPicks(ask));
  const { min, max } = pickBounds(ask);
  const toggle = (o: AskOption): void => {
    if (o.disabled !== undefined) return;
    setPicked((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : p.length >= max ? p : [...p, o.id]));
  };
  const usable = options.filter((o) => o.disabled === undefined);
  const n = picked.length;
  const ok = n >= min && n <= max;
  const first = options.find((o) => o.id === picked[0]);
  // An ask that allows none (`multi.min: 0`) says so plainly when nothing is ticked: the answer is "keep none".
  const words = n === 0 ? 'Keep none' : n === 1 && first !== undefined ? `Use ${first.label}` : `Use these ${n}`;
  const countWords = n === 0 && min === 0 ? 'None picked · that is an answer too'
    : `${n} picked${n < min ? ` · pick at least ${min}` : ''}${max < usable.length ? ` · at most ${max}` : ''}`;
  return (
    <>
      <div role="group" aria-label={ask.prompt} data-testid={tid(testIds, 'group', /* testid */ 'ask-options')} className="wk-ask-chips">
        {options.map((o) => {
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              {...(o.id === options.find((x) => x.disabled === undefined)?.id ? { 'data-ask-focus': 'true' } : {})}
              data-ask-option={o.id}
              data-testid={tid(testIds, 'option', /* testid */ 'ask-option')}
              disabled={busy || o.disabled !== undefined || (!on && n >= max)}
              aria-disabled={o.disabled !== undefined ? true : undefined}
              title={o.disabled ?? o.consequence ?? o.label}
              aria-label={`${o.label}${o.meta !== undefined ? `, ${o.meta}` : ''}${o.disabled !== undefined ? `, not available: ${o.disabled}` : ''}`}
              className="wk-ask-chip"
              onClick={() => toggle(o)}
            >
              <i aria-hidden className="wk-ask-box"><Check size={12} strokeWidth={3} /></i>
              {o.label}
              {o.meta !== undefined && <small aria-hidden>{o.meta}</small>}
            </button>
          );
        })}
      </div>
      {options.some((o) => o.disabled !== undefined) && (
        <p className="wk-ask-why-off" data-testid="ask-options-off">
          {options.filter((o) => o.disabled !== undefined).map((o) => `${o.label}: ${o.disabled}`).join(' · ')}
        </p>
      )}
      <div className="wk-ask-go">
        <button type="button" data-testid={tid(testIds, 'confirm', /* testid */ 'ask-confirm')} disabled={busy || !ok}
          data-none={n === 0 ? 'true' : undefined}
          onClick={() => onAnswer({ askId: ask.id, options: options.filter((o) => picked.includes(o.id)).map((o) => o.id) })}
          className={`wk-gate2-btn ${n === 0 ? 'wk-gate2-btn--secondary' : 'wk-gate2-btn--primary'}`}>
          {busy ? 'Sending…' : words}
        </button>
        {usable.length > 1 && usable.length <= max && (
          <button type="button" data-testid="ask-select-all" disabled={busy} onClick={() => setPicked(usable.map((o) => o.id))} className="wk-btn wk-btn--quiet wk-btn--sm">Select all</button>
        )}
        <span className="wk-ask-foot" data-testid="ask-count" aria-live="polite">{countWords}</span>
        {aside}
        {footnote}
      </div>
    </>
  );
}

/** A point on a scale: a slider over named steps (or a number range) and what the step means. */
function ScaleBody({ ask, onAnswer, busy = false, testIds }: AskCardProps): React.ReactElement {
  const scale = ask.scale ?? { steps: ['Low', 'High'] };
  const named = 'steps' in scale;
  const lo = named ? 0 : scale.min;
  const hi = named ? scale.steps.length - 1 : scale.max;
  const step = named ? 1 : scale.step;
  const [v, setV] = useState<number>(() => (typeof ask.default === 'number' ? Math.min(hi, Math.max(lo, ask.default)) : lo));
  const label = named ? scale.steps[v] ?? String(v) : String(v);
  const cons = named ? scale.consequences?.[v] : undefined;
  return (
    <>
      <div className="wk-ask-scale">
        <span aria-hidden>{named ? scale.steps[0] : scale.labels[0]}</span>
        <input type="range" data-ask-focus="true" min={lo} max={hi} step={step} value={v} disabled={busy}
          data-testid={tid(testIds, 'option', /* testid */ 'ask-scale')} aria-label={ask.prompt} aria-valuetext={label}
          onChange={(e) => setV(Number(e.target.value))} />
        <span aria-hidden>{named ? scale.steps[scale.steps.length - 1] : scale.labels[1]}</span>
        <span className="wk-ask-scale-v" data-testid="ask-scale-value">{label}</span>
      </div>
      <p data-testid={tid(testIds, 'consequence', /* testid */ 'ask-consequence')} aria-live="polite" className="wk-ask-cons">{cons ?? null}</p>
      <div className="wk-ask-go">
        <button type="button" data-testid={tid(testIds, 'confirm', /* testid */ 'ask-confirm')} disabled={busy} onClick={() => onAnswer({ askId: ask.id, value: v })} className="wk-gate2-btn wk-gate2-btn--primary">
          {busy ? 'Sending…' : 'Set it'}
        </button>
      </div>
    </>
  );
}

/** Short text: a box, Send, and "Nothing to add" when the answer is optional. */
function TextBody({ ask, onAnswer, busy = false, testIds, aside }: AskCardProps): React.ReactElement {
  const [t, setT] = useState('');
  const id = useId();
  const max = ask.text?.maxChars;
  const optional = ask.text?.optional === true;
  const send = (): void => { if (busy || (t.trim() === '' && !optional)) return; onAnswer({ askId: ask.id, text: t.trim() }); };
  return (
    <>
      <label htmlFor={id} className="sr-only">{ask.prompt}</label>
      <textarea id={id} data-ask-focus="true" data-testid={tid(testIds, 'reason', /* testid */ 'ask-text')} className="wk-ask-text" rows={2} value={t} disabled={busy}
        placeholder={ask.text?.placeholder} {...(max !== undefined ? { maxLength: max } : {})}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <div className="wk-ask-go">
        <button type="button" data-testid={tid(testIds, 'confirm', /* testid */ 'ask-confirm')} disabled={busy || (t.trim() === '' && !optional)} onClick={send} className="wk-gate2-btn wk-gate2-btn--primary">
          {busy ? 'Sending…' : 'Send'}
        </button>
        {optional && <button type="button" data-testid="ask-skip" disabled={busy} onClick={() => onAnswer({ askId: ask.id, text: '' })} className="wk-btn wk-btn--quiet wk-btn--sm">Nothing to add</button>}
        {aside}
      </div>
    </>
  );
}

/**
 * The answered ask, collapsed to one plain line ("You chose: Split into two lanes"), with its meta at the end: a gate's
 * undo countdown ("Sends in 8 s · Undo"), "sent" and the time, or "just now".
 */
export function AskRecord({ line, meta, testId = 'ask-record', className }: { line: string; meta?: React.ReactNode; testId?: string; className?: string }): React.ReactElement {
  return (
    <div data-testid="ask-record-row" role="status" className={`wk-ask-record${className !== undefined ? ` ${className}` : ''}`}>
      <Check size={16} aria-hidden className="wk-ask-record-ok" />
      <span data-testid={testId}>{line}</span>
      {meta !== undefined && meta !== null && <span className="wk-ask-record-meta">{meta}</span>}
    </div>
  );
}
