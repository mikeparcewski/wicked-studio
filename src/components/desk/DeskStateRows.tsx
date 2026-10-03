import { frozenBannerText } from '../../api/deliveryFreeze.js';
import { useStandingOrders } from '../../hooks/useStandingOrders.js';
import { useDeliveryFreezeStore } from '../../store/deliveryFreeze.js';
import { DeliveryFreezeSwitch } from '../DeliveryFreezeSwitch.js';

/** Whether the Desk has a standing state to say: deliveries frozen, or you marked away. */
export function useDeskStates(): { frozen: boolean; away: boolean } {
  const frozen = useDeliveryFreezeStore((s) => s.status === 'ready' && s.state?.frozen === true);
  const so = useStandingOrders();
  const away = so.state !== null && so.state !== 'unavailable' && so.state.away;
  return { frozen, away };
}

/**
 * THE DESK'S STANDING STATES (COVERAGE.md finding 2, wave 5): two switches that change what studio
 * does while you are not looking, said on the Desk only while they are ON — calm by default
 * (DESIGN-interaction rule 10). Off, both live under "Everything else" in the rail.
 *
 *  - Deliveries frozen (Wave C idea 15): who froze them, since when and why, and Unfreeze with its
 *    consequence (the same switch, inline).
 *  - You are marked away (behaviour 10): what your standing orders will do while you are gone, and
 *    "I'm back".
 */
export function DeskStateRows({ frozen, away }: { frozen: boolean; away: boolean }): React.ReactElement | null {
  const state = useDeliveryFreezeStore((s) => s.state);
  const so = useStandingOrders();
  if (!frozen && !away) return null;
  const orders = so.state !== null && so.state !== 'unavailable' ? so.state.orders.length : 0;
  return (
    <>
      {frozen && state !== null && (
        <div data-testid="desk-state" data-state="frozen" className="wk-desk-need">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
          <span className="wk-desk-need-body">
            <span className="wk-desk-need-title">Deliveries are frozen</span>
            <span data-testid="desk-state-line" className="wk-desk-need-line">{frozenBannerText(state)}. Nothing is pushed until someone unfreezes them.</span>
          </span>
          <DeliveryFreezeSwitch placement="inline" banner={false} />
        </div>
      )}
      {away && (
        <div data-testid="desk-state" data-state="away" className="wk-desk-need">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--waiting" />
          <span className="wk-desk-need-body">
            <span className="wk-desk-need-title">You are marked away</span>
            <span data-testid="desk-state-line" className="wk-desk-need-line">
              {orders === 0 ? 'No standing orders: every question waits for you.' : (so.preview ?? `${orders} standing orders answer what they cover; the rest waits for you.`)}
            </span>
          </span>
          <button type="button" data-testid="desk-state-back" onClick={() => void so.setAway(false)} className="wk-need-act">I’m back</button>
        </div>
      )}
    </>
  );
}
