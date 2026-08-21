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
}

export function LanguageBar({ breakdown }: Props): React.ReactElement {
  const entries = breakdown === null ? [] : Object.entries(breakdown).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);

  if (breakdown === null || total === 0) {
    return (
      <div data-testid="language-bar" data-state="empty">
        <p className="text-sm font-mono italic" style={{ color: 'var(--ink-dim)', margin: 0 }}>
          Language mix not indexed yet — run onboarding to build the code graph.
        </p>
      </div>
    );
  }

  const sorted = entries.sort(([, a], [, b]) => b - a);

  return (
    <div data-testid="language-bar" data-state="ready" data-langs={sorted.length}>
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
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          by files indexed
        </span>
      </div>
    </div>
  );
}
