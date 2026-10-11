import { useDisplayText } from '../../hooks/useHomePath.js';

/**
 * THE ONE DISCLOSURE FOR INTERNALS (design/UI-CONTRACT.md §4.3; studio#682, UX-003). Raw engine and
 * tool text (stderr, env vars, ruleset JSON, API paths) lives here, closed by default, never in the
 * default layer. Always sanitized: home paths read `~` and the mac temp dir `$TMPDIR`; the "Show
 * technical details" setting only lets full paths through (useDisplayText). Renders nothing for empty text.
 */
export function TechDetails({ summary = 'Technical details', text, defaultOpen = false, 'data-testid': testId = 'tech-details' }: {
  summary?: string;
  text: string | readonly string[];
  defaultOpen?: boolean;
  'data-testid'?: string;
}): React.ReactElement | null {
  const show = useDisplayText();
  const lines = (typeof text === 'string' ? [text] : [...text]).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return null;
  return (
    <details data-testid={testId} className="wk-tech-details" {...(defaultOpen ? { open: true } : {})}>
      <summary className="wk-tech-details-summary">{summary}</summary>
      <pre data-tech="on" className="wk-tech-details-body">{lines.map(show).join('\n')}</pre>
    </details>
  );
}
