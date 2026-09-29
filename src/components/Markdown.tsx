import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { ChatCitationItem } from '../api/chat-wire.js';
import { CitationBadge } from './citations.js';

/**
 * A file reference, as agents write them into transcripts: any href that is not
 * an external URL (`https://…`), an anchor, or a mail link. Covers absolute
 * paths (`/w2/auth/NOTES.md`) and bare relative names (`NOTES.md`) — both used
 * to render as underlined `target="_blank"` anchors that dead-clicked
 * (DES-UX-001 §1.1-5: "evidence links do nothing on click").
 */
function isFileRef(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') && !href.startsWith('#');
}

/** A GFM table delimiter row: `|---|:--:|`, `--- | ---` — at least one pipe, only dashes/colons in cells. */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|\s*$/;
/** A fence opener/closer: up to 3 spaces, then 3+ backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The cell count of a pipe-bounded row (`| a | b |` → 2). */
function cellCount(row: string): number {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
}

/**
 * Where a header row glued to the text before it starts: the first pipe OUTSIDE inline code whose
 * remainder is a whole pipe-bounded row with the delimiter's column count. `-1` when there is none.
 */
function gluedHeaderStart(line: string, delimiter: string): number {
  const columns = cellCount(delimiter);
  let ticks = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '`') ticks += 1;
    if (c !== '|' || i === 0 || ticks % 2 === 1 || line.slice(0, i).trim() === '') continue;
    const rest = line.slice(i).trimEnd();
    if (rest.endsWith('|') && rest.length > 1 && cellCount(rest) === columns) return i;
  }
  return -1;
}

/**
 * studio#237 (d): a table whose header row does not start its own line never parses — a streamed
 * reply that joined two blocks with no newline ("…I'll list them.| File | What |") left the header
 * glued to the sentence before it, and the whole table rendered as one fused paragraph. When the
 * line above a pipe-led delimiter row ends in a whole header row (outside inline code, the
 * delimiter's column count), that row moves onto its own line behind a blank one. Fenced code is
 * left alone.
 */
export function normaliseTables(md: string): string {
  if (!md.includes('|')) return md;
  const lines = md.split('\n');
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line);
    if (f !== null) {
      const marker = f[1]!;
      if (fence === null) fence = { char: marker[0]!, len: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.len && line.trim() === marker) fence = null;
      out.push(line);
      continue;
    }
    const next = lines[i + 1];
    if (fence === null && next !== undefined && next.trimStart().startsWith('|') && DELIMITER_ROW.test(next)
      && !line.trimStart().startsWith('|')) {
      const at = gluedHeaderStart(line, next);
      if (at > 0) {
        out.push(line.slice(0, at).trimEnd(), '', line.slice(at));
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Is this `code` node a fenced BLOCK? Block fences always include a trailing \n or a language. */
function isCodeBlock(className: string | undefined, children: React.ReactNode): boolean {
  return !!className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'));
}

/** The `code` renderer, extracted so the citation-marking pass (crew#561) can wrap its output
 *  instead of re-implementing the dress. */
function codeElement({
  className,
  children,
}: {
  className?: string | undefined;
  children?: React.ReactNode | undefined;
}): React.ReactElement {
  if (isCodeBlock(className, children)) {
    return (
      <code
        className={`block overflow-auto rounded-lg px-4 py-3 text-xs leading-5 font-mono my-2 ${className ?? ''}`}
        style={{ background: 'var(--surface-base)', color: 'var(--ink-high)' }}
      >
        {children}
      </code>
    );
  }
  return (
    <code
      className="rounded px-1.5 py-0.5 text-xs font-mono"
      style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)' }}
    >
      {children}
    </code>
  );
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2" style={{ color: 'var(--ink-high)' }}>{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5" style={{ color: 'var(--ink-high)' }}>{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1" style={{ color: 'var(--ink-high)' }}>{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
      {children}
    </a>
  ),
  img: ({ alt }) => (
    <span className="text-xs font-mono rounded px-1" style={{ background: 'var(--surface-raised)', color: 'var(--ink-dim)' }}>
      [image{alt ? `: ${alt}` : ''}]
    </span>
  ),
  code: codeElement,
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote
      className="pl-3 my-2 italic text-sm"
      style={{ borderLeft: '3px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
    >
      {children}
    </blockquote>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="text-xs w-full border-collapse font-mono">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ borderBottom: '1px solid var(--surface-raised)' }}>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr style={{ borderBottom: '1px solid var(--surface-raised)' }}>{children}</tr>,
  th: ({ children }) => (
    <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5" style={{ color: 'var(--ink-high)' }}>
      {children}
    </td>
  ),
  hr: () => <hr className="my-3" style={{ borderColor: 'var(--surface-raised)' }} />,
  strong: ({ children }) => <strong className="font-semibold" style={{ color: 'var(--ink-high)' }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: 'var(--ink-body)' }}>{children}</em>,
};

interface Props {
  children: string;
  className?: string;
  /**
   * Citation verdicts to mark IN PLACE (crew#561): raw token → the daemon's item. An inline-code
   * token that is a flagged citation renders inside a {@link CitationBadge} — struck through and
   * `UNVERIFIED` for a fabrication, `→ the real place` for a corrected line ref. The text itself is
   * never rewritten; `undefined` (the default) renders exactly as before.
   */
  marks?: ReadonlyMap<string, ChatCitationItem> | undefined;
  /**
   * Evidence-reference wiring (DES-UX-001 §1.3-4c): when provided, a link whose
   * href is a FILE reference (not an external URL) resolves through this
   * callback — the run view opens it in the slice-I FileViewer via
   * `GET /runs/:id/files` — instead of a dead `target="_blank"` click.
   * External http(s) links keep today's exact behavior.
   */
  onOpenFile?: (path: string) => void;
}

export function Markdown({ children, className, onOpenFile, marks }: Props): React.ReactElement {
  const resolved = useMemo<Components>(() => {
    // crew#561: an inline-code token that IS a flagged citation wears the daemon's verdict. Block
    // fences are left alone — a code sample is not a citation, and striking through a line of a
    // diff would corrupt what the reader came to read.
    const marked: Components =
      marks === undefined || marks.size === 0
        ? components
        : {
            ...components,
            code: ({ className: codeClass, children: codeChildren }) => {
              const rendered = codeElement({ className: codeClass, children: codeChildren });
              const raw = typeof codeChildren === 'string' ? codeChildren.trim() : '';
              const item = raw === '' || isCodeBlock(codeClass, codeChildren) ? undefined : marks.get(raw);
              return item === undefined ? rendered : <CitationBadge item={item}>{rendered}</CitationBadge>;
            },
          };
    if (onOpenFile === undefined) return marked;
    return {
      ...marked,
      a: ({ href, children: linkChildren }) => {
        if (typeof href === 'string' && isFileRef(href)) {
          return (
            <a
              href={href}
              data-testid="evidence-ref"
              className="underline"
              style={{ color: 'var(--accent)' }}
              onClick={(e) => {
                e.preventDefault();
                onOpenFile(href);
              }}
            >
              {linkChildren}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
            {linkChildren}
          </a>
        );
      },
    };
  }, [onOpenFile, marks]);

  return (
    <div
      className={`text-sm leading-relaxed ${className ?? ''}`}
      style={{ color: 'var(--ink-high)' }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={resolved}>
        {normaliseTables(children)}
      </ReactMarkdown>
    </div>
  );
}
