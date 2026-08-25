/**
 * The deliver transcript of run 5c5e08b7 — copied VERBATIM off the live daemon
 * (`GET /runs/5c5e08b7…/units/5c5e08b7…:deliver/output`, 725 bytes), so the
 * `pull/new/` negative is tested in its natural habitat rather than a synthetic
 * one: the create-PR form git prints on every push appears FIRST, is longer, and
 * looks exactly like the answer. Studio must return PR 121 and only PR 121.
 */
export const REAL_DELIVER_OUTPUT = [
  'Current branch wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21 is up to date.',
  'remote: ',
  "remote: Create a pull request for 'wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21' on GitHub by visiting:        ",
  'remote:      https://github.com/mikeparcewski/wicked-studio/pull/new/wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21        ',
  'remote: ',
  'To https://github.com/mikeparcewski/wicked-studio.git',
  ' * [new branch]      wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21 -> wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21',
  "branch 'wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21' set up to track 'origin/wicked/5c5e08b7-9e06-43cc-9b15-300bfc599e21'.",
  'https://github.com/mikeparcewski/wicked-studio/pull/121',
  'https://github.com/mikeparcewski/wicked-studio/pull/121',
].join('\n');

/** The PR the transcript above actually opened. */
export const REAL_PR_URL = 'https://github.com/mikeparcewski/wicked-studio/pull/121';

/**
 * The deliver transcript of run **665a9aeb** — copied VERBATIM off the live
 * daemon (`GET /runs/665a9aeb…/units/665a9aeb…:deliver/output`, 677 bytes,
 * `outputUnavailable` absent), and the whole reason this slice was re-cut.
 *
 * The unit's status is `done` and its `denial_reason` is `null`, so the list
 * wire says the deliver phase was APPROVED — and the transcript below contains
 * ZERO `/pull/\d+` matches and exactly one `/pull/new/` form. Crew pushed a
 * branch with no commits ahead of `origin/main` and opened no PR. Only a
 * post-crew#318 daemon fails the phase in this situation; 17 of the live
 * corpus's deliver units are `done` and some of them look exactly like this.
 *
 * Every surface must be provable against this shape: `done` buys the phase-only
 * wording, never the PR claim.
 */
export const EMPTY_PUSH_OUTPUT = [
  "branch 'wicked/665a9aeb-285d-407b-b869-813b67e50973' set up to track 'origin/wicked/665a9aeb-285d-407b-b869-813b67e50973'.",
  'could not compute title or body defaults: could not find any commits between origin/main and wicked/665a9aeb-285d-407b-b869-813b67e50973',
  '',
  'remote: ',
  "remote: Create a pull request for 'wicked/665a9aeb-285d-407b-b869-813b67e50973' on GitHub by visiting:        ",
  'remote:      https://github.com/mikeparcewski/wicked-studio/pull/new/wicked/665a9aeb-285d-407b-b869-813b67e50973        ',
  'remote: ',
  'To https://github.com/mikeparcewski/wicked-studio.git',
  ' * [new branch]      wicked/665a9aeb-285d-407b-b869-813b67e50973 -> wicked/665a9aeb-285d-407b-b869-813b67e50973',
  '',
].join('\n');

/** crew#318's refusal, verbatim from `packages/crew/src/core/deliver.ts:142`. */
export const NOTHING_REASON =
  'deliver: nothing to deliver — the run produced no committed change '
  + '(wicked/665a9aeb is not ahead of origin/main); nothing was pushed';

/** crew's other loud deliver failure (`deliver.ts:163`). */
export const NO_URL_REASON =
  'deliver: gh pr create exited 0 but produced no PR URL for wicked/abc '
  + '— refusing to report a delivery nothing can be pointed at';
