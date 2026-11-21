import type { SystemInfra } from '../../api/system.js';
import { healthText } from '../../board/rowHeadline.js';
import { useSeatImageRebuild } from '../../store/seatImageRebuild.js';
import { useSystemStore } from '../../store/systemSnapshot.js';

/** studio#936: crew owns the progress; the POST store owns a refusal to start. */
export function SeatImageRebuildNote({ rebuild }: { rebuild: SystemInfra['rebuild'] }): React.ReactElement | null {
  const refusal = useSeatImageRebuild((s) => s.refusal);
  // A snapshot read after the refusal supersedes it: the row says what holds now (coord W4 on #1254).
  const snapshotAt = useSystemStore((s) => s.snapshotAt);
  const lines = rebuild?.running
    ? ['Rebuilding seat images…', ...rebuild.tail.slice(-3)]
    : rebuild?.error ? [rebuild.error] : [];
  if (refusal !== null && (snapshotAt === null || snapshotAt <= refusal.at)) lines.push(refusal.reason);
  if (lines.length === 0) return null;
  return <span data-testid="seat-image-rebuild" role="status">{lines.map((line, i) => <span key={i} className="wk-nc-line">{healthText(line)}</span>)}</span>;
}
