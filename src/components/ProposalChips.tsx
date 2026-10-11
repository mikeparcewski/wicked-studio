import { proposalKind, type Proposal } from '../api/proposals.js';
import { TechDetails } from './ui/index.js';

export const KIND_COLOR: Record<'memory' | 'policy' | 'other', string> = {
  memory: 'var(--accent)',
  policy: 'var(--status-gate)',
  other: 'var(--ink-muted)',
};

export function severityWord(severity: string): string {
  return severity === 'warn' ? 'warning' : severity;
}

export function shortContent(content: string): string {
  const words = content.replace(/\s+/g, ' ').trim();
  return words.length > 60 ? `${words.slice(0, 60).trimEnd()}…` : words;
}

export function KindChip({ proposal }: { proposal: Proposal }): React.ReactElement {
  const kind = proposalKind(proposal);
  return (
    <span data-testid="proposal-kind-chip" data-kind={kind} className="wk-tag">
      {kind === 'memory' ? 'Memory' : kind === 'policy' ? 'Policy' : 'Proposal'}
    </span>
  );
}

/** Raw metadata stays in the shared disclosure, closed by default. */
export function KeyValueChips({ testid, entries }: {
  testid: string;
  entries: Record<string, string>;
}): React.ReactElement {
  return (
    <div data-testid={testid}>
      <TechDetails text={Object.entries(entries).map(([key, value]) => `${key}: ${value}`)} />
    </div>
  );
}
