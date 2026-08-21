/**
 * The shared shell of one home metrics-bar tile (DES-FEEDBACK-001 §2.2, slice E):
 * a 2xs uppercase title on the left, the current value in mono on the right,
 * and the SVG chart beneath — compact enough to live inside the 64px band.
 *
 * Every tile carries a `data-question` attribute naming the operator question
 * it answers, verbatim from §2.1 (EC19): a chart without a question is
 * decoration and is rejected.
 */

interface Props {
  testId: string;
  /** The §2.1 named operator question, verbatim (EC19). */
  question: string;
  title: string;
  /** The current-value caption (mono, right-aligned). */
  value: string;
  /** Extra data-* attributes for the rigs. */
  data?: Record<string, string | number>;
  children: React.ReactNode;
}

export function MetricTile({ testId, question, title, value, data, children }: Props): React.ReactElement {
  return (
    <div
      data-testid={testId}
      data-question={question}
      {...data}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '4px',
        padding: '0 var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            fontWeight: 'var(--weight-bold)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-dim)',
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
          }}
        >
          {title}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--text-2xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}
