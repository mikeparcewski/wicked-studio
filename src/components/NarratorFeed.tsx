import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { CoreEvent, SessionView, StageKind, UnitStatus, WorkUnit } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore } from '../store/runtime.js';
import { LiveNarration } from './LiveNarration.js';
import { Markdown } from './Markdown.js';
import { ArtifactCard } from './ArtifactCard.js';
import {
  buildFeed,
  narrate,
  sortFeedEvents,
  type FeedItem,
  type NarrationTone,
  type NarratorContext,
} from './narrator.js';

/**
 * The narrated run feed (DES-RUN-NARRATOR §2, §4-§5): ONE chronological stream
 * — deterministic narration lines over the run's CoreEvent trail, each spoken
 * unit's output group anchored where its story ends, artifact cards behind the
 * lines that produced them. This is the only scrolling region of the run page;
 * the now-bar and the approval dock are pinned siblings.
 *
 * Two lenses share the renderer: `feed` (lines + units + artifacts) and
 * `units` (the unit groups alone, ord order — the terminal run's Units tab for
 * non-post-mortem runs, preserving the crew#272 output blocks verbatim).
 */

const EMPTY_EVENTS: CoreEvent[] = [];

// Agent identity under the token contract (DES-VISION-001 §2.11).
const CLI_AVATAR = { bg: 'var(--surface-raised)', fg: 'var(--ink-body)' } as const;

function cliInitials(key: string): string {
  const parts = key.split(/[-_]/);
  if (parts.length > 1) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return key.slice(0, 2).toUpperCase();
}

function CliAvatar({ cli }: { cli: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold font-mono select-none"
      style={{ background: CLI_AVATAR.bg, color: CLI_AVATAR.fg }}
    >
      {cliInitials(cli)}
    </span>
  );
}

// Stage pill — process vocabulary, not run state (§1.5 rule 2).
const STAGE_BADGE: Record<StageKind, { bg: string; color: string }> = {
  recon:   { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
  build:   { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
  review:  { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
  test:    { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
};

const UNIT_STATUS_TEXT: Record<UnitStatus, string> = {
  pending:     'queued',
  distributed: 'dispatched',
  done:        'done',
  rejected:    'rejected',
};

export function unitKey(runId: string, unitId: string, ord: number): string {
  return unitId.startsWith(`${runId}:`) ? unitId.slice(runId.length + 1) : `u${ord}`;
}

/**
 * The unit's phase name (crew#272): the unit-id suffix (`run-1:survey` →
 * `survey`); free-text units (`u<ord>`) fall back to the methodology stage.
 */
export function phaseName(runId: string, unit: WorkUnit): string {
  const key = unitKey(runId, unit.id, unit.ord);
  return /^u\d+$/.test(key) ? unit.stage : key;
}

const TONE_COLOR: Record<NarrationTone, string> = {
  info: 'var(--ink-muted)',
  work: 'var(--status-run)',
  gate: 'var(--status-gate)',
  fail: 'var(--status-fail)',
  human: 'var(--accent)',
};

const TONE_GLYPH: Record<NarrationTone, string> = {
  info: '·',
  work: '●',
  gate: '◆',
  fail: '✗',
  human: '➤',
};

interface Props {
  view: SessionView;
  /** ord-sorted units (the caller's memo). */
  orderedUnits: WorkUnit[];
  executingUnitOrd: number | null;
  phaseOf: (ord: number | null | undefined) => string;
  /** `feed` = the narrated stream; `units` = unit groups only (the Units tab). */
  lens: 'feed' | 'units';
  /** Click-to-target inject (crew#74) — live runs only. */
  onTargetInject?: ((cli: string) => void) | undefined;
  /** Open/close the observer terminal for an agent (⌨). */
  onToggleTerminal?: ((cli: string, terminalId: string) => void) | undefined;
  /** The agent whose terminal is open (aria-pressed on its ⌨). */
  agentTerminalCli?: string | null;
  onOpenFile?: ((path: string) => void) | undefined;
  /** The scrolling container ref — the now-bar's "Latest ↓" scrolls it. */
  scrollRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
}

export function NarratorFeed({
  view,
  orderedUnits,
  executingUnitOrd,
  phaseOf,
  lens,
  onTargetInject,
  onToggleTerminal,
  agentTerminalCli = null,
  onOpenFile,
  scrollRef,
}: Props): React.ReactElement {
  const { session } = view;
  const events = useRunEventStore((s) => s.byRun[session.id]) ?? EMPTY_EVENTS;
  const terminalIds = useRuntimeStore((s) => s.terminalIds);

  // Raw view (§4): the same trail, undecorated — for operators who want the wire.
  const [raw, setRaw] = useState(false);

  const feedEvents = lens === 'feed' ? events : EMPTY_EVENTS;
  const ctx: NarratorContext = useMemo(() => ({ phaseOf }), [phaseOf]);
  const items: FeedItem[] = useMemo(
    () => buildFeed(feedEvents, orderedUnits, executingUnitOrd, ctx),
    [feedEvents, orderedUnits, executingUnitOrd, ctx],
  );

  // The inline gate MOMENT (§2): when the run is paused on a human and the trail
  // never spoke an awaitingHuman line (empty/pruned log), say it at the tail —
  // the feed records history even when the log cannot.
  const gateSpoken = useMemo(
    () => feedEvents.some((e) => e.type === 'awaitingHuman'),
    [feedEvents],
  );
  const syntheticGateLine =
    lens === 'feed' && session.status === 'awaiting_human' && !gateSpoken;

  // Transcript auto-load for done units (crew#272) — the output IS the message
  // body; loaded with no click, collapsible behind its toggle.
  const [transcripts, setTranscripts] = useState<
    Record<number, { text: string | null; loading: boolean; visible: boolean }>
  >({});
  const autoLoadedOrds = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const unit of orderedUnits) {
      if (unit.status === 'done' && !autoLoadedOrds.current.has(unit.ord)) {
        autoLoadedOrds.current.add(unit.ord);
        setTranscripts((prev) => ({ ...prev, [unit.ord]: { text: null, loading: true, visible: true } }));
        void api
          .getUnitOutput(session.id, unitKey(session.id, unit.id, unit.ord))
          .then(({ output, outputUnavailable }) => {
            // "(no transcript captured)" is FALSE for a denied unit — say what
            // the daemon says (FINDING-006).
            setTranscripts((prev) => ({
              ...prev,
              [unit.ord]: {
                text: output ?? outputUnavailable ?? '(no transcript captured)',
                loading: false,
                visible: true,
              },
            }));
          })
          .catch(() => {
            setTranscripts((prev) => ({
              ...prev,
              [unit.ord]: { text: '(transcript unavailable)', loading: false, visible: true },
            }));
          });
      }
    }
  }, [orderedUnits, session.id]);

  function toggleTranscript(ord: number): void {
    setTranscripts((prev) => {
      const entry = prev[ord];
      if (!entry) return prev;
      return { ...prev, [ord]: { ...entry, visible: !entry.visible } };
    });
  }

  // Pinned to the tail as items land (the live-follow posture). `transcripts`
  // is a dep too: a done unit's output loads AFTER the first pin and grows the
  // block above the tail — without the re-pin the latest narration slid below
  // the fold (caught on the 1440x700 evidence pass).
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items.length, transcripts]);

  const byOrd = useMemo(() => new Map(orderedUnits.map((u) => [u.ord, u])), [orderedUnits]);

  /** One unit's group block — meta row + content card (testids preserved verbatim). */
  function unitBlock(ord: number): React.ReactElement | null {
    const unit = byOrd.get(ord);
    if (unit === undefined) return null;
    const tc = transcripts[unit.ord];
    const stageBadge = STAGE_BADGE[unit.stage] ?? { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' };
    return (
      <div key={`unit-${unit.id}`} data-message-id={unit.id} className="flex flex-col gap-2">
        <div className="self-start w-full max-w-[85%] flex flex-col gap-2">
          {/* Meta row: avatar + attribution + stage (clickable to target inject). */}
          <div className="flex items-center gap-2 flex-wrap">
            {unit.assigned_cli ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onTargetInject === undefined ? undefined : () => onTargetInject(unit.assigned_cli!)}
                  title={`Target ${unit.assigned_cli}`}
                  aria-label={`Send message to ${unit.assigned_cli} only`}
                  className="flex items-center gap-2 rounded-lg p-0 pr-1 transition-opacity hover:opacity-80"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  <CliAvatar cli={unit.assigned_cli} />
                  <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                    {unit.assigned_cli}
                    <span style={{ color: 'var(--ink-dim)' }}> · unit {unit.ord}</span>
                  </span>
                </button>
                {onToggleTerminal !== undefined && terminalIds[`${session.id}:${unit.assigned_cli}`] && (
                  <button
                    type="button"
                    aria-pressed={agentTerminalCli === unit.assigned_cli}
                    aria-label={agentTerminalCli === unit.assigned_cli ? `Close ${unit.assigned_cli} terminal` : `Open ${unit.assigned_cli} terminal`}
                    title={agentTerminalCli === unit.assigned_cli ? `Close ${unit.assigned_cli} terminal` : `Open ${unit.assigned_cli} terminal`}
                    onClick={() => {
                      const cli = unit.assigned_cli!;
                      const tid = terminalIds[`${session.id}:${cli}`];
                      if (tid) onToggleTerminal(cli, tid);
                    }}
                    className="text-xs rounded px-1 py-0.5 transition-opacity hover:opacity-80"
                    style={{ background: 'var(--surface-raised)', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    ⌨
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full shrink-0" style={{ background: 'var(--surface-raised)' }} />
                <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                  agent
                  <span style={{ color: 'var(--ink-dim)' }}> · unit {unit.ord}</span>
                </span>
              </div>
            )}
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide font-mono"
              style={{ background: stageBadge.bg, color: stageBadge.color }}
            >
              {unit.stage}
            </span>
            {unit.has_validator_pin && (
              <span role="img" aria-label="Governance floor armed" style={{ color: 'var(--status-gate)', fontSize: '12px' }}>🔒</span>
            )}
            <span className="text-xs font-mono truncate max-w-xs" style={{ color: 'var(--ink-dim)' }} title={unit.description}>
              {unit.description}
            </span>
          </div>

          {/* Content card: live output for the cursor, transcript for done, reason for rejected. */}
          <div
            className="rounded-2xl px-5 py-4"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            {unit.status !== 'done' && unit.status !== 'rejected' && (
              <LiveNarration runId={session.id} ord={unit.ord} phase={phaseName(session.id, unit)} />
            )}
            {unit.status === 'done' && (
              <div data-testid={`unit-output-${unit.ord}`}>
                <div className="flex items-center gap-2 text-sm font-mono">
                  <span style={{ color: 'var(--status-done)' }}>✓</span>
                  <span className="font-medium" style={{ color: 'var(--status-done)' }}>{phaseName(session.id, unit)}</span>
                  <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>{UNIT_STATUS_TEXT[unit.status]}</span>
                  <button
                    type="button"
                    data-testid={`unit-output-toggle-${unit.ord}`}
                    onClick={() => toggleTranscript(unit.ord)}
                    className="ml-auto text-xs font-medium font-mono hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    {tc?.visible ? '▾ Hide output' : '▸ Show output'}
                  </button>
                </div>
                {tc?.visible && (
                  <div className="mt-2.5 max-h-[28rem] overflow-y-auto">
                    {tc.loading
                      ? <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>Loading output…</span>
                      : <Markdown className="whitespace-pre-wrap" {...(onOpenFile !== undefined ? { onOpenFile } : {})}>{tc.text ?? ''}</Markdown>
                    }
                  </div>
                )}
              </div>
            )}
            {unit.status === 'rejected' && (
              <div className="text-sm font-medium font-mono" style={{ color: 'var(--status-fail)' }}>
                Rejected{unit.denial_reason ? `: ${unit.denial_reason}` : ''}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const narrationLine = (key: string, text: string, tone: NarrationTone): React.ReactElement => (
    <div key={key} data-testid="narration-line" data-tone={tone} className="flex items-baseline gap-2 px-1">
      <span aria-hidden="true" className="shrink-0 text-[10px] font-mono" style={{ color: TONE_COLOR[tone] }}>
        {TONE_GLYPH[tone]}
      </span>
      <span className="text-[12.5px] font-mono leading-relaxed min-w-0" style={{ color: tone === 'info' ? 'var(--ink-muted)' : 'var(--ink-body)' }}>
        {text}
      </span>
    </div>
  );

  return (
    <div
      ref={scrollRef}
      data-testid="thread"
      className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 max-w-3xl w-full mx-auto"
    >
      {/* Feed header: what this stream is + the raw-wire toggle (§4). */}
      {lens === 'feed' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--ink-dim)' }}>
            run narration
          </span>
          <div className="flex-1" />
          <div
            role="group"
            aria-label="Feed view"
            className="inline-flex items-center gap-0.5"
            style={{ border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md, 6px)', padding: '1px' }}
          >
            {([['narrated', false], ['raw', true]] as const).map(([label, isRaw]) => (
              <button
                key={label}
                type="button"
                data-testid={`feed-view-${label}`}
                aria-pressed={raw === isRaw}
                onClick={() => setRaw(isRaw)}
                className="text-[10px] font-mono rounded px-1.5 py-0.5"
                style={{
                  background: raw === isRaw ? 'var(--surface-raised)' : 'transparent',
                  color: raw === isRaw ? 'var(--ink-high)' : 'var(--ink-dim)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The user's intent opens the story. */}
      <div className="flex justify-end">
        <div
          className="max-w-[72%] rounded-2xl text-base px-5 py-3.5 leading-relaxed"
          style={{ background: 'transparent', color: 'var(--ink-high)', border: '1px solid var(--surface-raised)' }}
        >
          {session.problem}
        </div>
      </div>

      {raw && lens === 'feed'
        ? // Raw wire view: every recorded frame, undecorated, same order.
          sortFeedEvents(feedEvents).map((e, i) => (
            <div
              key={typeof e.seq === 'number' ? `s${e.seq}` : `r${i}`}
              data-testid="raw-event"
              className="flex items-baseline gap-2 px-1 font-mono text-[11px]"
            >
              <span className="shrink-0" style={{ color: 'var(--ink-dim)' }}>
                {typeof e.seq === 'number' ? String(e.seq).padStart(5, ' ') : '     '}
              </span>
              <span className="shrink-0 font-semibold" style={{ color: 'var(--ink-body)' }}>{e.type}</span>
              {typeof e.ord === 'number' && <span className="shrink-0" style={{ color: 'var(--ink-dim)' }}>u{e.ord}</span>}
              <span className="truncate" style={{ color: 'var(--ink-muted)' }}>
                {narrate(e, ctx)?.text ?? ''}
              </span>
            </div>
          ))
        : items.map((item) => {
            if (item.kind === 'line') return narrationLine(item.key, item.line.text, item.line.tone);
            if (item.kind === 'artifact') {
              return (
                <ArtifactCard key={item.key} artifact={item.artifact} onOpenFile={onOpenFile} />
              );
            }
            return unitBlock(item.ord);
          })}

      {syntheticGateLine && !raw &&
        narrationLine('synthetic-gate', 'Gate: waiting on you — decide below', 'gate')}

      <div ref={bottomRef} />
    </div>
  );
}
