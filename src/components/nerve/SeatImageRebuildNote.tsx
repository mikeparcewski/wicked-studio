import type { SystemInfra } from '../../api/system.js';
import { healthText } from '../../board/rowHeadline.js';
import { useSeatImageRebuild } from '../../store/seatImageRebuild.js';

/** studio#936: crew owns the progress; the POST store owns a refusal to start. */
export function SeatImageRebuildNote({ rebuild }: { rebuild: SystemInfra['rebuild'] }): React.ReactElement | null {
  const refusal = useSeatImageRebuild((s) => s.refusal);
  const lines = rebuild?.running
    ? ['Rebuilding seat images…', ...rebuild.tail.slice(-3)]
    : rebuild?.error ? [rebuild.error] : [];
  if (refusal !== null) lines.push(refusal);
  if (lines.length === 0) return null;
  return <span data-testid="seat-image-rebuild" role="status">{lines.map((line, i) => <span key={i} className="wk-nc-line">{healthText(line)}</span>)}</span>;
}
