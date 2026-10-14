import { useEffect, useRef, useState } from 'react';
import { getLearnedTheme, putLearnedTheme, type LearnKind } from '../../api/interactive.js';
import { learnReady, learnThemeFromThread, LEARN_KINDS, LEARN_LABEL } from '../../interactive/themeWire.js';
import { pollLearnedTheme } from '../../theming/learnPoll.js';
import { beginMatch, endMatch, themeWritesSettled } from '../../editors/themeLock.js';
import { Segmented } from '../ui/index.js';
import './editorPorts.css';

/**
 * "Match a website or a PDF" for an artifact's Style tab (DES-EDITOR-PLUGIN-CONTRACT-001 §9, slice H4). HOST chrome:
 * a plugin frame has no network and can't start a learn, so the host draws this under the plugin's Style tab
 * whenever the artifact's adapter reports `theme`.
 *
 * It rides interactive's existing theme wires only: `wicked.interactive.theme.requested` (the bus learn, which the
 * bridge's SSRF guard owns; nothing is fetched or uploaded from the browser), then the learned-theme readback, then
 * ONE re-themed version of the head (`PUT /api/theme/learned {apply:true}`), Undo from the host like any write.
 */
export function MatchTheme({ projectId, docId, onVersion, apply }: {
  projectId: string;
  docId: string;
  /** The host's own theme write (the artifact's adapter: it records the parent for Undo and moves the head).
   *  Absent = the learned-theme PUT directly. */
  apply?: (tokens: Record<string, unknown>) => Promise<{ version: number } | { error: string; message: string }>;
  /** A re-themed version landed (the host announces it to every instance as `artifact.changed`). */
  onVersion?: (version: number) => void;
}): React.ReactElement {
  const [kind, setKind] = useState<LearnKind>('url');
  const [value, setValue] = useState('');
  const [line, setLine] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const lock = useRef<symbol | null>(null);
  useEffect(() => () => { abort.current?.abort(); endMatch(projectId, docId, lock.current); }, [projectId, docId]);

  const match = async (): Promise<void> => {
    if (!learnReady(kind, value) || busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    const token = beginMatch(projectId, docId);
    lock.current = token;
    try {
      // A Style write already in flight lands before the baseline is read, so it can never pass for this learn.
      await themeWritesSettled(projectId, docId, ctl.signal);
      if (!ctl.signal.aborted) await run(ctl);
    } finally { endMatch(projectId, docId, token); }
  };

  const run = async (ctl: AbortController): Promise<void> => {
    setLine({ text: `Reading the ${LEARN_LABEL[kind].noun}…`, bad: false });
    // The theme already learned, if any: a later readback is this learn's answer only when it differs. A failed
    // read is not "none" (an older theme would then pass for this one's, codex h4-r1): stop and say so.
    let before: Awaited<ReturnType<typeof getLearnedTheme>>;
    try { before = await getLearnedTheme(projectId, docId); } catch (e: unknown) {
      if (ctl.signal.aborted) return;
      setLine({ text: `Could not read the current theme: ${e instanceof Error ? e.message : String(e)}`, bad: true });
      setBusy(false);
      return;
    }
    if (ctl.signal.aborted) return;
    const asked = await learnThemeFromThread({ projectId, docId, kind, value });
    if (ctl.signal.aborted) return;
    if (!asked.ok) { setLine({ text: asked.reason, bad: true }); setBusy(false); return; }
    const out = await pollLearnedTheme({
      signal: ctl.signal,
      // A learn that landed BEFORE this one is not this one's answer.
      fetchLearned: async () => {
        const t = await getLearnedTheme(projectId, docId);
        return t !== null && (before === null || t.learned_at !== before.learned_at) ? t : null;
      },
    });
    if (ctl.signal.aborted || out.kind === 'cancelled') return;
    if (out.kind !== 'learned') {
      setLine({ text: out.kind === 'bridge-error' ? out.reason : 'No theme came back in about a minute. The thread says why when it knows.', bad: true });
      setBusy(false);
      return;
    }
    try {
      if (ctl.signal.aborted) return;
      if (apply !== undefined) {
        const r = await apply(out.result.tokens);
        if (ctl.signal.aborted) return;
        if ('error' in r) { setLine({ text: r.message, bad: true }); setBusy(false); return; }
        onVersion?.(r.version);
        setLine({ text: `Matched: version ${r.version} wears it`, bad: false });
      } else {
        const r = await putLearnedTheme(projectId, docId, out.result.tokens, true);
        if (ctl.signal.aborted) return;
        if (r.version !== null) onVersion?.(r.version);
        setLine({ text: r.version !== null ? `Matched: version ${r.version} wears it` : 'Matched: this version already looks like that', bad: false });
      }
    } catch (e: unknown) {
      if (ctl.signal.aborted) return;
      setLine({ text: e instanceof Error ? e.message : String(e), bad: true });
    }
    setBusy(false);
  };

  return (
    <form
      data-testid="match-theme"
      className="wk-match-theme"
      onSubmit={(e) => { e.preventDefault(); void match(); }}
      aria-label="Match a website or a PDF"
    >
      <p className="wk-match-theme__title">Match a website or a PDF</p>
      <Segmented
        label="Match from"
        value={kind}
        options={LEARN_KINDS.map((k) => ({ value: k, label: k === 'url' ? 'Website' : k === 'pdf' ? 'PDF' : 'Image', testId: `match-theme-${k}` }))}
        onChange={setKind}
      />
      <input
        data-testid="match-theme-input"
        className="wk-match-theme__input"
        aria-label={`The ${LEARN_LABEL[kind].noun}`}
        placeholder={LEARN_LABEL[kind].placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
      />
      <button data-testid="match-theme-go" type="submit" className="wk-btn" disabled={busy || !learnReady(kind, value)}>
        {busy ? 'Matching…' : 'Match'}
      </button>
      {line !== null && <p data-testid="match-theme-line" role="status" className={line.bad ? 'wk-match-theme__line wk-match-theme__line--bad' : 'wk-match-theme__line'}>{line.text}</p>}
    </form>
  );
}
