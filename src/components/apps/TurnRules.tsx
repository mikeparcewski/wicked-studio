import { rulePath } from '../../api/decisions.js';
import type { AppTurnRule } from '../../editors/apps/appTurns.js';

/**
 * (studio#1295) The steering rules a refused turn broke, each a link to it in Steering with the judge's cite, so the
 * person can find the rule (to rescope or retire it). Nothing when crew recorded no broken rule.
 */
export function TurnRules({ rules, navigate }: { rules: readonly AppTurnRule[] | undefined; navigate: (p: string) => void }): React.ReactElement | null {
  if (rules === undefined || rules.length === 0) return null;
  return (
    <div className="wk-appchat-rules" data-testid="app-turn-rules">
      <p className="wk-appchat-meta">{rules.length === 1 ? 'The steering rule it broke:' : 'The steering rules it broke:'}</p>
      <ul className="wk-appchat-lines">
        {rules.map((r) => {
          const href = rulePath(r.id);
          return (
            <li key={r.id} data-testid="app-turn-rule">
              <a href={href} data-testid="app-turn-rule-link" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); navigate(href); }}>{r.id}</a>
              {r.reason !== '' && <span data-testid="app-turn-rule-why"> · {r.reason}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
