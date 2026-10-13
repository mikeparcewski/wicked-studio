import type { LaunchDraft } from '../store/launchWizard.js';

/**
 * The New job wizard's "Demo video" (studio#664, DES-PRESENTATION-EDITOR-001 D-S1): the form's rules,
 * kept to crew's demo body (`DemoLaunchSchema` in crew's recording routes) so what the review shows is
 * what is sent and a launch is never refused for a shape the form could have caught.
 */

/** "Demo video" (studio#664): a narrated recording of a running app, made by the `demo` preset. */
export const DEMO_VIDEO_LINE = 'Record a narrated video of a running app';
/** Who a demo is for: three common answers to start from; any words will do (crew takes free text). */
export const DEMO_AUDIENCES = ['Executives', 'Engineers', 'Customers'] as const;
/** crew's demo body bounds (`DemoLaunchSchema`): what the review shows is what is sent. */
export const DEMO_URL_MAX = 2048;
export const DEMO_AUDIENCE_MAX = 2000;
export const DEMO_SHOW_MAX = 4000;

/** Why a demo's app address cannot be sent, or null: crew takes an absolute http(s) URL only. */
export function demoUrlProblem(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return 'Give the address of the running app.';
  if (url.length > DEMO_URL_MAX) return `Shorten the address to ${DEMO_URL_MAX} characters.`;
  if (!/^https?:\/\//i.test(url)) return 'The address starts with http:// or https://.';
  try { new URL(url); } catch { return 'That address is not a web address.'; }
  return null;
}

/** What still stops a demo launch, or null (the form's rules, re-checked at review). */
export function demoBlocker(d: Pick<LaunchDraft, 'demoUrl' | 'demoAudience' | 'intent'>): string | null {
  return demoUrlProblem(d.demoUrl)
    ?? (d.demoAudience.trim() === '' ? 'Say who the video is for.'
      : d.demoAudience.trim().length > DEMO_AUDIENCE_MAX ? `Shorten who it is for to ${DEMO_AUDIENCE_MAX} characters.`
        : d.intent.trim() === '' ? 'Say what the video should show.'
          : d.intent.trim().length > DEMO_SHOW_MAX ? `Shorten what it shows to ${DEMO_SHOW_MAX} characters.` : null);
}

