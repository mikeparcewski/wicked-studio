import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

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
  code: ({ className, children }) => {
    // Block fences always include a trailing \n; inline code never does.
    const isBlock = !!className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'));
    if (isBlock) {
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
  },
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
   * Evidence-reference wiring (DES-UX-001 §1.3-4c): when provided, a link whose
   * href is a FILE reference (not an external URL) resolves through this
   * callback — the run view opens it in the slice-I FileViewer via
   * `GET /runs/:id/files` — instead of a dead `target="_blank"` click.
   * External http(s) links keep today's exact behavior.
   */
  onOpenFile?: (path: string) => void;
}

export function Markdown({ children, className, onOpenFile }: Props): React.ReactElement {
  const resolved = useMemo<Components>(() => {
    if (onOpenFile === undefined) return components;
    return {
      ...components,
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
  }, [onOpenFile]);

  return (
    <div
      className={`text-sm leading-relaxed ${className ?? ''}`}
      style={{ color: 'var(--ink-high)' }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={resolved}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
