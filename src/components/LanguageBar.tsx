/**
 * Language composition bar (DES-FEEDBACK-001 §3.1/§3.3, slice E): "What is
 * this repo actually built of?" — a proportional segmented bar + labels.
 *
 * WIRE HONESTY — where the breakdown comes from. `RepoEntry` carries NO
 * language field; the real language signal on this wire is the `lang` each
 * `CodeGraphNode` carries (`GET /repos/:id/graph`, estate indexing). The page
 * derives files-per-language from the graph it already fetched and passes it
 * here; no graph yet ⇒ the honest not-indexed state, never an invented mix.
 * The unit is FILES INDEXED (not linguist's bytes) and the label says so.
 *
 * SAMPLE HONESTY (studio#1406): that graph is the served SLICE (capped by the node limit), and crew sends no
 * per-language count for the whole index, so on a repository bigger than the slice the mix is the slice's. The label
 * names the files the percentages count (the breakdown's own sum) against `indexedFiles`, the repository's whole-store
 * file count: "in 24 of the 217 files indexed". Only a breakdown that counts every indexed file reads "by number of
 * files"; with no usable whole-store count it reads "in the 24 files shown".
 *
 * COLOR EXEMPTION (§3.3): language colors are a universal developer convention
 * (GitHub's linguist palette); overriding them with the token accent would
 * make TypeScript look indigo-violet, destroying recognition. This is the ONLY
 * sanctioned raw-color exemption in the codebase — each literal carries the
 * design's lint comment. Unlisted languages fall back to `var(--ink-dim)`.
 */

/** linguist display names + hex, keyed by estate's lowercase `lang` values. */
const LANG_META: Record<string, { label: string; color: string }> = {
  // eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token
  typescript: { label: 'TypeScript', color: '#3178c6' },
  // eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token
  javascript: { label: 'JavaScript', color: '#f7df1e' },
  // eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token
  css: { label: 'CSS', color: '#563d7c' },
  // eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token
  python: { label: 'Python', color: '#3572a5' },
  // eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token
  rust: { label: 'Rust', color: '#dea584' },
  // eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token
  go: { label: 'Go', color: '#00add8' },
};
const FALLBACK = 'var(--ink-dim)';

const MAX_LABELS = 4;

export function langMeta(lang: string): { label: string; color: string } {
  return LANG_META[lang.toLowerCase()] ?? {
    label: lang.charAt(0).toUpperCase() + lang.slice(1) || 'Other',
    color: FALLBACK,
  };
}

interface Props {
  /** lowercase `lang` → files indexed, or `null` when the graph is not built. */
  breakdown: Record<string, number> | null;
  /** studio#461: what to say when there is no mix to draw — the page knows whether the graph was
   *  never built, built with no code in it, or not read. Defaults to the not-built sentence. */
  emptyText?: string;
  /** The files the repository has indexed (the wire's whole-store count), when the breakdown is a graph slice; `null`
   *  when the wire did not say. Omitted: the breakdown is the whole repository. */
  indexedFiles?: number | null;
}

const files = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;

/** What the percentages are of (studio#1406): `counted` files, the breakdown's own sum, against the files indexed. */
function basis(counted: number, indexedFiles: number | null | undefined): { text: string; sample: boolean } {
  if (indexedFiles === undefined || indexedFiles === counted) return { text: 'by number of files', sample: false };
  // No whole-store count, or one smaller than what was counted (read at another moment): only the slice is known.
  if (indexedFiles === null || indexedFiles < counted) return { text: `in the ${files(counted)} shown`, sample: true };
  return { text: `in ${counted.toLocaleString('en-US')} of the ${files(indexedFiles)} indexed`, sample: true };
}

export function LanguageBar({ breakdown, emptyText, indexedFiles }: Props): React.ReactElement {
  const entries = breakdown === null ? [] : Object.entries(breakdown).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);

  if (breakdown === null || total === 0) {
    return (
      <div data-testid="language-bar" data-state="empty">
        <p className="wk-pg-repo-empty">
          {emptyText ?? 'Language mix not indexed yet — run onboarding to build the code graph.'}
        </p>
      </div>
    );
  }

  const sorted = entries.sort(([, a], [, b]) => b - a);
  const of = basis(total, indexedFiles);

  return (
    <div data-testid="language-bar" data-state="ready" data-langs={sorted.length} data-sample={of.sample ? 'true' : 'false'}>
      <div
        style={{
          display: 'flex',
          height: '8px',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
        }}
      >
        {sorted.map(([lang, files]) => (
          <div
            key={lang}
            data-testid="language-segment"
            data-lang={lang}
            title={`${langMeta(lang).label} — ${files} ${files === 1 ? 'file' : 'files'}`}
            style={{ flexBasis: `${(files / total) * 100}%`, background: langMeta(lang).color }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '16px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'baseline' }}>
        {sorted.slice(0, MAX_LABELS).map(([lang, files]) => (
          <span
            key={lang}
            data-testid="language-label"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-sans)' }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                background: langMeta(lang).color, marginRight: '4px',
              }}
            />
            {langMeta(lang).label} {Math.round((files / total) * 100)}%
          </span>
        ))}
        <span data-testid="language-basis" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>{of.text}</span>
      </div>
    </div>
  );
}
