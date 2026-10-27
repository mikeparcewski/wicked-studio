import { useId, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { OverflowMenu, type MenuItem } from '../ui/OverflowMenu.js';

/**
 * THE CALM PAGE PATTERN (the operator-approved pages mockup, 2026-10-26: "needs more whitespace,
 * easy to scan … think humans, we get overwhelmed easy"). Every page that adopts it reads the same:
 *
 *  - a title, then ONE sentence with the live state, and at most one primary action (the rest sit
 *    behind that action's menu or a row's ⋯);
 *  - at most one filter (a two-way segment) beside the list's quiet label;
 *  - roomy two-line rows: a status dot, the thing in plain words, one muted line, one meta word.
 *    The whole row is the target and tints on hover; secondary moves are behind its ⋯ or details.
 *
 * Pure presentation: no reads, no writes — the page owns its data and hands words in.
 */

export type CalmTone = 'ok' | 'run' | 'gate' | 'fail' | 'quiet' | 'accent';

export function CalmPage({ children, 'data-testid': testId, className }: {
  children: React.ReactNode; 'data-testid'?: string | undefined; className?: string | undefined;
}): React.ReactElement {
  return (
    <div className={`wk-calm${className !== undefined ? ` ${className}` : ''}`} data-testid={testId}>
      <div className="wk-calm-col">{children}</div>
    </div>
  );
}

/** The title, the one sentence, and the page's one action (with its menu, when it has one). */
export function CalmHead({ title, sentence, action, sentenceTestId, titleTestId }: {
  title: string;
  sentence: React.ReactNode;
  action?: React.ReactNode | undefined;
  sentenceTestId?: string | undefined;
  titleTestId?: string | undefined;
}): React.ReactElement {
  return (
    <header className="wk-calm-head">
      <div className="wk-calm-hello">
        <h1 className="wk-calm-title" data-testid={titleTestId}>{title}</h1>
        <p className="wk-calm-sentence" data-testid={sentenceTestId} aria-live="polite">{sentence}</p>
      </div>
      {action !== undefined && action !== null && <div className="wk-calm-actions">{action}</div>}
    </header>
  );
}

/**
 * The primary action, and (when the page has more ways to act) a quiet menu beside it holding
 * them. Each menu item keeps its own testid so a journey can still reach it.
 */
export function CalmAction({ label, onClick, disabled, title, testId, icon, menu, menuLabel, menuTestId }: {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  title?: string | undefined;
  testId?: string | undefined;
  icon?: React.ReactNode | undefined;
  menu?: readonly MenuItem[] | undefined;
  menuLabel?: string | undefined;
  menuTestId?: string | undefined;
}): React.ReactElement {
  return (
    <span className="wk-calm-action">
      <button type="button" className="wk-calm-btn wk-calm-btn--primary" onClick={onClick} disabled={disabled} title={title} data-testid={testId}>
        {icon}{label}
      </button>
      {menu !== undefined && menu.length > 0 && (
        <span className="wk-calm-menu">
          <OverflowMenu label={menuLabel ?? 'More'} items={menu} {...(menuTestId !== undefined ? { 'data-testid': menuTestId } : {})} />
        </span>
      )}
    </span>
  );
}

/** A secondary button in the calm look (outlined, the same height as the primary). */
export function CalmButton({ children, onClick, disabled, testId, title, ariaLabel, tone = 'secondary' }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean | undefined; testId?: string | undefined; title?: string | undefined; ariaLabel?: string | undefined;
  tone?: 'secondary' | 'primary' | 'link' | undefined;
}): React.ReactElement {
  return (
    <button type="button" className={`wk-calm-btn wk-calm-btn--${tone}`} onClick={onClick} disabled={disabled}
      data-testid={testId} title={title} aria-label={ariaLabel}>{children}</button>
  );
}

/** A list: its quiet uppercase label, the one filter (and quiet tools) on the right, then the rows. */
export function CalmSection({ label, labelNode, tools, children, 'data-testid': testId, ariaLabel }: {
  label?: string | undefined;
  /** A label that is itself a control (a quiet picker), in place of the plain words. */
  labelNode?: React.ReactNode | undefined;
  tools?: React.ReactNode | undefined;
  children: React.ReactNode;
  'data-testid'?: string | undefined;
  ariaLabel?: string | undefined;
}): React.ReactElement {
  return (
    <section className="wk-calm-sec" data-testid={testId} aria-label={ariaLabel ?? label}>
      <div className="wk-calm-sec-head">
        {labelNode ?? <h2 className="wk-calm-label">{label}</h2>}
        {tools !== undefined && tools !== null && <div className="wk-calm-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

/** The one filter: two (or three) words in a quiet pill track. */
export function CalmSeg<V extends string>({ label, value, onChange, options, 'data-testid': testId }: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: readonly { value: V; label: string; testId?: string }[];
  'data-testid'?: string | undefined;
}): React.ReactElement {
  return (
    <div className="wk-calm-seg" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-testid={o.testId}
          className={`wk-calm-seg-btn${o.value === value ? ' is-on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * A quiet search: a small "Search" button that opens into a field (and any extra filters), so the
 * list's head stays calm until someone wants to look something up. Open on its own when a search is
 * already in force.
 */
export function CalmSearch({ value, onChange, onSubmit, placeholder, label, testId, extra, startOpen = false, buttonTestId }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void | undefined;
  placeholder: string;
  label: string;
  testId?: string | undefined;
  /** More filters, shown only while the search is open (a tag filter, a kind picker). */
  extra?: React.ReactNode | undefined;
  startOpen?: boolean | undefined;
  buttonTestId?: string | undefined;
}): React.ReactElement {
  const [open, setOpen] = useState(startOpen || value !== '');
  if (!open) {
    return (
      <button type="button" className="wk-calm-quiet-btn" onClick={() => setOpen(true)} aria-label={label} data-testid={buttonTestId}>
        <Search size={15} aria-hidden /> <span>Search</span>
      </button>
    );
  }
  return (
    <span className="wk-calm-search">
      <span className="wk-calm-search-field">
        <Search size={15} aria-hidden className="wk-calm-search-icon" />
        {/* autoFocus: the field opened because someone pressed Search. */}
        <input type="search" className="wk-calm-search-input" placeholder={placeholder} aria-label={label} data-testid={testId}
          value={value} spellCheck={false} autoFocus={!startOpen}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit !== undefined) { e.preventDefault(); onSubmit(); } if (e.key === 'Escape' && value === '') setOpen(false); }} />
      </span>
      {extra}
    </span>
  );
}

/**
 * One row: dot, title, one muted line, the meta word — the whole main area is the target (a link or a
 * button). `menu` puts a ⋯ at the end; `details` gives the row a disclosure whose contents open under it.
 */
export function CalmRow({ tone, title, sub, meta, metaTone = 'quiet', href, onOpen, menu, menuLabel, menuTestId, details, detailsLabel, trailing,
  'data-testid': testId, openTestId, titleAttr, data, openData, openLabel }: {
  tone: CalmTone;
  title: React.ReactNode;
  sub?: React.ReactNode | undefined;
  meta?: React.ReactNode | undefined;
  metaTone?: CalmTone | undefined;
  /** A link row (the address the row opens). */
  href?: string | undefined;
  /** What a click on the row does (with `href`, the in-app navigation). */
  onOpen?: () => void | undefined;
  menu?: readonly MenuItem[] | undefined;
  menuLabel?: string | undefined;
  menuTestId?: string | undefined;
  /** What opens under the row (the details a person rarely needs). */
  details?: React.ReactNode | undefined;
  detailsLabel?: string | undefined;
  /** An action in place of (or beside) the meta word, e.g. "Sign in". */
  trailing?: React.ReactNode | undefined;
  'data-testid'?: string | undefined;
  openTestId?: string | undefined;
  titleAttr?: string | undefined;
  data?: Record<string, string | number | boolean | undefined> | undefined;
  /** Data attributes for the main target too (a journey selects it by them). */
  openData?: Record<string, string | undefined> | undefined;
  openLabel?: string | undefined;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const attrs = (d: Record<string, string | number | boolean | undefined> | undefined): Record<string, string> =>
    Object.fromEntries(Object.entries(d ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [`data-${k}`, String(v)]));
  const dataAttrs = attrs(data);
  const mainAttrs = attrs(openData);
  const body = (
    <>
      <span aria-hidden className="wk-calm-dot" data-tone={tone} />
      <span className="wk-calm-row-text">
        <span className="wk-calm-row-title" title={titleAttr}>{title}</span>
        {sub !== undefined && sub !== null && <span className="wk-calm-row-sub">{sub}</span>}
      </span>
      {meta !== undefined && meta !== null && <span className="wk-calm-row-meta" data-tone={metaTone}>{meta}</span>}
    </>
  );
  // The main target: a link (opens somewhere), a button that opens the details, or a button with its own move.
  const main = href !== undefined
    ? <a href={href} className="wk-calm-row-main" data-testid={openTestId} aria-label={openLabel} {...mainAttrs}
        onClick={(e) => { if (onOpen === undefined || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onOpen(); }}>{body}</a>
    : onOpen !== undefined
      ? <button type="button" className="wk-calm-row-main" data-testid={openTestId} aria-label={openLabel} onClick={onOpen} {...mainAttrs}>{body}</button>
      : details !== undefined
        ? <button type="button" className="wk-calm-row-main" data-testid={openTestId} aria-expanded={open} aria-controls={`${id}-details`} aria-label={openLabel} {...mainAttrs}
            onClick={() => setOpen((o) => !o)}>{body}</button>
        : <span className="wk-calm-row-main wk-calm-row-main--static">{body}</span>;
  // With a link or a move as the main target, the details get their own small disclosure.
  const ownToggle = details !== undefined && (href !== undefined || onOpen !== undefined);
  return (
    <li className={`wk-calm-row${open ? ' is-open' : ''}`} data-testid={testId} {...dataAttrs}>
      <div className="wk-calm-row-line">
        {main}
        {trailing !== undefined && trailing !== null && <span className="wk-calm-row-trailing">{trailing}</span>}
        {ownToggle && (
          <button type="button" className="wk-calm-icon-btn" aria-expanded={open} aria-controls={`${id}-details`}
            aria-label={detailsLabel ?? 'Details'} title={detailsLabel ?? 'Details'} data-testid="calm-row-details" onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={16} aria-hidden className="wk-calm-chev" />
          </button>
        )}
        {menu !== undefined && menu.length > 0 && (
          <span className="wk-calm-row-menu"><OverflowMenu label={menuLabel ?? 'More'} items={menu} {...(menuTestId !== undefined ? { 'data-testid': menuTestId } : {})} /></span>
        )}
      </div>
      {/* Rendered closed too (hidden), so what the row knows stays in the page for find-in-page off and for tests. */}
      {details !== undefined && (
        <div id={`${id}-details`} className="wk-calm-row-details" hidden={!open}>{details}</div>
      )}
    </li>
  );
}

export function CalmRows({ children, 'data-testid': testId, label }: { children: React.ReactNode; 'data-testid'?: string | undefined; label?: string }): React.ReactElement {
  return <ul className="wk-calm-rows" data-testid={testId} aria-label={label}>{children}</ul>;
}

/** The loading rows: the page's shape, quietly, while the reads are out. */
export function CalmLoading({ rows = 4, 'data-testid': testId, label = 'Loading' }: { rows?: number | undefined; 'data-testid'?: string | undefined; label?: string }): React.ReactElement {
  return (
    <div className="wk-calm-loading" data-testid={testId} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="wk-calm-loading-row" aria-hidden>
          <span className="wk-calm-loading-dot" />
          <span className="wk-calm-loading-lines"><span style={{ width: `${62 - (i % 3) * 12}%` }} /><span style={{ width: `${38 - (i % 2) * 8}%` }} /></span>
        </span>
      ))}
    </div>
  );
}

/** A designed empty state: one plain sentence, an optional second, and at most one move. */
export function CalmEmpty({ title, body, action, 'data-testid': testId }: {
  title: string; body?: React.ReactNode | undefined; action?: React.ReactNode | undefined; 'data-testid'?: string | undefined;
}): React.ReactElement {
  return (
    <div className="wk-calm-empty" data-testid={testId}>
      <p className="wk-calm-empty-title">{title}</p>
      {body !== undefined && <div className="wk-calm-empty-body">{body}</div>}
      {action !== undefined && <div className="wk-calm-empty-act">{action}</div>}
    </div>
  );
}

/** A details fact list, for what opens under a row (label, value). */
export function CalmFacts({ facts, 'data-testid': testId }: { facts: readonly { k: string; v: React.ReactNode; testId?: string }[]; 'data-testid'?: string }): React.ReactElement {
  return (
    <dl className="wk-calm-facts" data-testid={testId}>
      {facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd data-testid={f.testId}>{f.v}</dd></div>)}
    </dl>
  );
}

/** A quiet note line under the list head (a filter in force, a save, a stale read). */
export function CalmNote({ children, tone = 'quiet', 'data-testid': testId, role }: {
  children: React.ReactNode; tone?: 'quiet' | 'ok' | 'fail' | undefined; 'data-testid'?: string | undefined; role?: string | undefined;
}): React.ReactElement {
  return <p className="wk-calm-note" data-tone={tone} data-testid={testId} role={role}>{children}</p>;
}
