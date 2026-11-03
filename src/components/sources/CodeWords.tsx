import { codeSpans } from './sourceModel.js';

/** crew's words with their `identifiers` set as code (every part as text: nothing is parsed as markup). */
export function CodeWords({ words }: { words: string }): React.ReactElement {
  return (
    <>
      {codeSpans(words).map((s, i) => (s.code ? <code key={i} className="wk-src-mono">{s.text}</code> : <span key={i}>{s.text}</span>))}
    </>
  );
}
