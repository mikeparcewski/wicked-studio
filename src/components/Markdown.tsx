import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const components: Components = {
  h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2" style={{ color: '#e6edf3' }}>{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5" style={{ color: '#e6edf3' }}>{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1" style={{ color: '#e6edf3' }}>{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#79c0ff' }}>
      {children}
    </a>
  ),
  img: ({ alt }) => (
    <span className="text-xs font-mono rounded px-1" style={{ background: 'rgba(230,237,243,0.08)', color: 'rgba(230,237,243,0.4)' }}>
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
          style={{ background: '#0d1117', color: '#e6edf3' }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded px-1.5 py-0.5 text-xs font-mono"
        style={{ background: 'rgba(230,237,243,0.1)', color: '#e6edf3' }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote
      className="pl-3 my-2 italic text-sm"
      style={{ borderLeft: '3px solid rgba(230,237,243,0.2)', color: 'rgba(230,237,243,0.6)' }}
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
  thead: ({ children }) => <thead style={{ borderBottom: '1px solid rgba(230,237,243,0.12)' }}>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr style={{ borderBottom: '1px solid rgba(230,237,243,0.06)' }}>{children}</tr>,
  th: ({ children }) => (
    <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'rgba(230,237,243,0.7)' }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5" style={{ color: '#e6edf3' }}>
      {children}
    </td>
  ),
  hr: () => <hr className="my-3" style={{ borderColor: 'rgba(230,237,243,0.1)' }} />,
  strong: ({ children }) => <strong className="font-semibold" style={{ color: '#e6edf3' }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: 'rgba(230,237,243,0.8)' }}>{children}</em>,
};

interface Props {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: Props): React.ReactElement {
  return (
    <div
      className={`text-sm leading-relaxed ${className ?? ''}`}
      style={{ color: '#e6edf3' }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
