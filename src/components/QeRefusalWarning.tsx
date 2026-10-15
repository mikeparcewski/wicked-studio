import { TechDetails } from './ui/TechDetails.js';
import { announceNavigateAway, inAppEntryState } from '../hooks/useHistoryState.js';
import {
  qeDeliveryFix,
  qeRefusalWords,
  QE_OFF_OFFER,
  QE_REQUIRED_OFFER,
  QE_SETTING_LINK,
  QE_SETTING_PATH,
  type QeRefusalKind,
} from '../board/qeRefusal.js';
import { useQeSetting } from '../store/qeSetting.js';

type Go = (path: string) => void;

/** In-place navigation with no router in scope (AnswerInThread's way): push, then let every
 *  useRoute's popstate listener read the new address. */
export function goToPath(path: string): void {
  announceNavigateAway();
  history.pushState(inAppEntryState(), '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The link that lands on Settings' "Require QE acceptance before delivery" switch. A real `href`
 *  (open in a new tab works); a plain click navigates in place. The router's own navigate fires no
 *  event, so the click also says the address changed (`hashchange`): a Settings page that is already
 *  open then brings the switch into view too. */
export function QeSettingLink({ navigate, testId }: { navigate?: Go | undefined; testId: string }): React.ReactElement {
  return (
    <a
      href={QE_SETTING_PATH}
      data-testid={testId}
      className="wk-qe-warning-link"
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        (navigate ?? goToPath)(QE_SETTING_PATH);
        window.dispatchEvent(new Event('hashchange'));
      }}
    >
      {QE_SETTING_LINK}
    </a>
  );
}

function FixLine({ fix, link, navigate, testId }: { fix: string; link: boolean; navigate?: Go | undefined; testId: string }): React.ReactElement {
  return (
    <p data-testid={`${testId}-fix`} className="wk-qe-warning-fix">
      {fix}
      {link && <>{' '}<QeSettingLink navigate={navigate} testId={`${testId}-link`} /></>}
    </p>
  );
}

/**
 * The warning a refusal BECAUSE QE acceptance is required gets: what failed and why, in plain words,
 * then what to do — turn QE acceptance off (with the link straight to the switch) only when this
 * computer's service reports it `required`; otherwise what else to do. crew's own sentence stays
 * readable behind Technical details. `refusalKey` names the refusal (its run, its launch attempt): a
 * new one re-reads the setting even when the card stays mounted.
 */
export function QeRefusalWarning({ kind, refusalKey, detail, forced = false, navigate, testId }: {
  kind: QeRefusalKind;
  refusalKey: string;
  /** crew's sentence, verbatim (Technical details only). */
  detail?: string | null;
  /** The launch itself asked to require QE acceptance. */
  forced?: boolean;
  navigate?: Go | undefined;
  testId: string;
}): React.ReactElement {
  const { loaded, setting } = useQeSetting(refusalKey);
  const words = qeRefusalWords(kind, loaded ? setting : null, { forced });
  return (
    <div data-testid={testId} data-kind={kind} data-setting={loaded ? (setting ?? 'unknown') : ''} role="alert" className="wk-qe-warning">
      <p className="wk-qe-warning-title">{words.title}</p>
      <p className="wk-qe-warning-body">{words.body}</p>
      {loaded && <FixLine fix={words.fix} link={words.link} navigate={navigate} testId={testId} />}
      {detail !== undefined && detail !== null && detail.trim() !== '' && (
        <TechDetails data-testid={`${testId}-detail`} text={detail} />
      )}
    </div>
  );
}

/**
 * The fix line alone, for a hand-over crew WILL refuse (the deliver card already says QE acceptance
 * hasn't passed): turn it off for later jobs in Settings, or what else to do.
 */
export function QeDeliveryFixLine({ refusalKey, navigate, testId }: { refusalKey: string; navigate?: Go | undefined; testId: string }): React.ReactElement | null {
  const { loaded, setting } = useQeSetting(refusalKey);
  if (!loaded) return null;
  const { fix, link } = qeDeliveryFix(setting);
  return (
    <div data-testid={testId} data-setting={setting ?? 'unknown'} className="wk-qe-warning wk-qe-warning--inline">
      <FixLine fix={fix} link={link} navigate={navigate} testId={testId} />
    </div>
  );
}

/**
 * The short form, inline, where a refused delivery is only listed (the decision toast, the approvals
 * bar): required — it can be turned off for later jobs, with the link; already off — the job keeps the
 * requirement it started with; not reported — nothing (the run's own card says the rest).
 */
export function QeSettingOffer({ refusalKey, navigate, testId, refreshOnFocus = true }: {
  refusalKey: string; navigate?: Go | undefined; testId: string;
  /** `false` on the toast: it lives seconds, and a re-read must not take a focused link away. */
  refreshOnFocus?: boolean;
}): React.ReactElement | null {
  const { loaded, setting } = useQeSetting(refusalKey, { refreshOnFocus });
  if (!loaded || setting === null) return null;
  return (
    <span data-testid={testId} data-setting={setting} className="wk-qe-offer">
      {setting === 'required'
        ? <>{QE_REQUIRED_OFFER}{' '}<QeSettingLink navigate={navigate} testId={`${testId}-link`} /></>
        : QE_OFF_OFFER}
    </span>
  );
}
