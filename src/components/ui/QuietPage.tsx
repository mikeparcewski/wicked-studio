import { useRef } from 'react';

/**
 * The calm page pieces Jobs and Repositories share (styles/sections/jobs-repos.css; the approved pages
 * mockup, 2026-10-26): the head (a 32 px title, one sentence of live state, one primary action), the
 * page's one filter, designed loading rows and a designed empty state.
 */

export function QuietHead({ title, sentence, sentenceTestId, action, id, level = 1 }: {
  title: string; sentence: string; sentenceTestId?: string; action?: React.ReactNode; id?: string;
  /** 2 when the page sits under another page's title (a project's page names the project). */
  level?: 1 | 2;
}): React.ReactElement {
  const H = level === 1 ? 'h1' : 'h2';
  return (
    <header className="wk-jr-head">
      <div className="wk-jr-hello">
        <H className="wk-jr-title" {...(id !== undefined ? { id } : {})}>{title}</H>
        <p className="wk-jr-sentence" aria-live="polite" {...(sentenceTestId !== undefined ? { 'data-testid': sentenceTestId } : {})}>{sentence}</p>
      </div>
      {action}
    </header>
  );
}

/** The page's one filter: two or three words in a quiet track (a radio group; the arrows move). */
export function QuietFilter<T extends string>({ label, value, options, onChange, 'data-testid': testId }: {
  label: string; value: T; options: readonly { value: T; label: string; testId?: string }[]; onChange: (v: T) => void; 'data-testid'?: string;
}): React.ReactElement {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number): void => {
    const n = options.length;
    const to = (from + step + n) % n;
    onChange(options[to]!.value);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="wk-jr-seg" {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1} data-value={o.value} className="wk-jr-seg-opt"
          {...(o.testId !== undefined ? { 'data-testid': o.testId } : {})}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
          }}>{o.label}</button>
      ))}
    </div>
  );
}

/** Loading: the rows' own shape, breathing (never a spinner, never a zero). */
export function QuietLoading({ rows = 4, label, 'data-testid': testId }: { rows?: number; label: string; 'data-testid'?: string }): React.ReactElement {
  return (
    <ul className="wk-jr-loading" aria-busy="true" aria-label={label} data-testid={testId ?? 'skeleton'}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="wk-jr-loading-row" aria-hidden>
          <span className="wk-jr-bone wk-jr-bone--dot" />
          <span className="wk-jr-loading-lines"><span className="wk-jr-bone wk-jr-bone--title" /><span className="wk-jr-bone wk-jr-bone--sub" /></span>
          <span className="wk-jr-bone wk-jr-bone--word" />
        </li>
      ))}
    </ul>
  );
}

/** Empty: what is (not) here, in a sentence, and the one thing to do about it. */
export function QuietEmpty({ title, body, actions, 'data-testid': testId }: {
  title: string; body?: React.ReactNode; actions?: React.ReactNode; 'data-testid'?: string;
}): React.ReactElement {
  return (
    <div className="wk-jr-empty" {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      <p className="wk-jr-empty-title">{title}</p>
      {body !== undefined && <p className="wk-jr-empty-body">{body}</p>}
      {actions !== undefined && <div className="wk-jr-acts">{actions}</div>}
    </div>
  );
}
