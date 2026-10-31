import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../../api/client.js';
import { readErrorKind } from '../../api/errors.js';
import { STEERING_TYPE_LABELS, steeringTypeOf } from '../../api/steering.js';
import { rulePath } from '../../api/decisions.js';
import { DESK_VIEW_PATH } from '../../board/navModel.js';
import type { ConformanceRule } from '../../api/types.js';
import { rulesYouCareAbout, STARTER_RULES, starterRule, type StarterRule } from '../../board/learnHub.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useFirstRun } from '../../store/firstRun.js';
import { AuthorPanel } from '../SteeringAuthorPanel.js';
import { ImportDialog } from '../steer/SteerSurface.js';
import { Skeleton, StateBanner } from '../ui/index.js';

/**
 * Rules (DES-LEARN §3.2): the steering rules the person cares about. Starter tiles are real steering rules —
 * picking one adds it in force, unpicking retires it. Below, the rules the person added or adopted (by hand,
 * a starter, a chat or a Learn run), with Steering's own ways in: Add with chat (the steering-author run) and
 * Import. Adopting a rule counts as using Learn (§3.0).
 */
export function RulesTab({ navigate }: { navigate: Navigate }): React.ReactElement {
  const [rules, setRules] = useState<ConformanceRule[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const [chat, setChat] = useState(false);
  const [importing, setImporting] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const load = (): void => {
    setError(null);
    api.listConformanceRules().then((r) => setRules(r.rules), setError);
  };
  useEffect(load, []);

  const inForce = (s: StarterRule): boolean => rules?.some((r) => r.id === s.id && r.retired !== true) ?? false;
  const toggle = async (s: StarterRule): Promise<void> => {
    if (busy !== null || rules === null) return;
    setBusy(s.id);
    setNote(null);
    try {
      if (inForce(s)) {
        await api.retireConformanceRule(s.id);
        setNote({ tone: 'ok', text: `“${s.title}” is no longer in force.` });
      } else {
        await api.upsertConformanceRule(starterRule(s));
        setNote({ tone: 'ok', text: `“${s.title}” is in force now.` });
        void useFirstRun.getState().markLearnUsed();
      }
      load();
    } catch (e) {
      setNote({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (error !== null) return <StateBanner kind={readErrorKind(error)} what="your rules" error={error instanceof Error ? error.message : String(error)} onRetry={load} data-testid="learn-rules-error" />;
  if (rules === null) return <Skeleton rows={4} data-testid="learn-rules-loading" />;
  const mine = rulesYouCareAbout(rules);

  return (
    <div data-testid="learn-rules" ref={pageRef}>
      <p className="wk-learn-hero"><b>Pick the rules you care about.</b> Each starter is a real steering rule; picking it puts it in force for every helper. Then test them in Evaluate.</p>
      <div className="wk-learn-starters" role="group" aria-label="Starter rules">
        {STARTER_RULES.map((s) => {
          const on = inForce(s);
          return (
            <button key={s.id} type="button" className="wk-learn-tile" aria-pressed={on} data-testid="learn-starter" data-starter={s.id}
              disabled={busy !== null} onClick={() => void toggle(s)}>
              <span className="wk-learn-tick" aria-hidden><Check size={12} strokeWidth={3} /></span>
              <b>{s.title}</b>
              <span>{s.line}</span>
              <span className="wk-learn-pill">{STEERING_TYPE_LABELS[s.type]}</span>
            </button>
          );
        })}
      </div>
      {note !== null && <p className={`wk-learn-quiet${note.tone === 'fail' ? ' wk-learn-bad' : ''}`} role="status" data-testid="learn-rules-note">{note.text}</p>}
      <div className="wk-learn-res-head">
        <h2 className="wk-learn-h2">In force for you <span className="wk-learn-quiet" data-testid="learn-rules-count">· {mine.length}</span></h2>
        <div className="wk-learn-row">
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="learn-rules-chat" onClick={() => setChat((c) => !c)} aria-expanded={chat}>Add with chat</button>
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="learn-rules-import" onClick={() => setImporting(true)}>Import a doc…</button>
          <a href={DESK_VIEW_PATH.evaluate} className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="learn-rules-evaluate" onClick={(e) => { e.preventDefault(); navigate(DESK_VIEW_PATH.evaluate); }}>Test these in Evaluate</a>
        </div>
      </div>
      {chat && (
        <div className="wk-learn-chat" data-testid="learn-rules-author">
          <AuthorPanel type="development" onClose={() => setChat(false)} onAuthored={() => { load(); void useFirstRun.getState().markLearnUsed(); }} />
        </div>
      )}
      {mine.length === 0 ? (
        <p className="wk-learn-quiet" data-testid="learn-rules-empty">None yet. Pick a starter above, add one with chat, or learn them from your team’s docs in Style.</p>
      ) : (
        <ul className="wk-learn-rules" data-testid="learn-rules-list">
          {mine.map((r) => (
            <li key={r.id} className="wk-learn-rule" data-testid="learn-rule" data-rule-id={r.id}>
              <span className="wk-learn-dot" aria-hidden />
              <span>
                <span className="wk-learn-rule-t">{r.statement}</span>
                <span className="wk-learn-rule-s">{STEERING_TYPE_LABELS[steeringTypeOf(r)]} · {originWords(r)}</span>
              </span>
              <a className="wk-link wk-learn-small" href={rulePath(r.id)} onClick={(e) => { e.preventDefault(); navigate(rulePath(r.id)); }}>Open</a>
            </li>
          ))}
        </ul>
      )}
      {importing && <ImportDialog defaultType="development" background={pageRef} onClose={() => setImporting(false)} onImported={() => { load(); void useFirstRun.getState().markLearnUsed(); }} />}
    </div>
  );
}

function originWords(r: ConformanceRule): string {
  if (r.provenance.ref === 'learn:starter') return 'a starter you picked';
  if (r.provenance.source === 'chat') return 'drafted with chat, approved by you';
  return 'added by you';
}
