import { benchRetry, commandDisplay, otherReady, qeAvailable, workAdmissionOf, type AgentIssue, type AgentRow } from './agentsModel.js';
import { relTime } from './relTime.js';

/**
 * THE AGENTS MODAL'S WORDS (DES-seats-page §4.1): one entry per issue code, studio-owned. The only
 * interpolations are the allowlist of §4.3 — agent and binary names, version strings, counts and
 * relative times. Crew's own sentences go to `tech` (Technical details) and nowhere else. Copy
 * buttons copy only `login_invocation`, `logout_invocation` or `<binary> --version` (§4.4).
 */

export interface CopyCommand {
  /** What the clipboard gets (crew's line verbatim). */
  line: string;
  /** What the page shows (`$HOME` for the home directory). */
  display: string;
  /** The accessible name's noun ("sign-in", "sign-out", "version check"). */
  label: string;
}

export interface FixStep {
  lead: string;
  text: string;
  commands: CopyCommand[];
  note: string | null;
  /** This step carries the "I've signed in: check again" block. */
  check?: boolean;
  /** Steps that belong to this choice (rendered a, b under it). */
  sub?: FixStep[];
  /** Show `sub` behind a disclosure with this label (an optional procedure, codex r10 HIER). */
  subLabel?: string;
  /** Internals for this one step, behind its own disclosure (env vars stay out of the default layer). */
  tech?: { summary: string; text: string };
}

export interface IssueCopy {
  title: string;
  what: string;
  why: string;
  fix: FixStep[];
  tech: string | null;
  /** The disclosure's label when it carries a how-to, not diagnostics (default "Technical details"). */
  techSummary?: string;
}

function cmd(line: string | null, label: string): CopyCommand[] {
  return line === null ? [] : [{ line, display: commandDisplay(line), label }];
}

function step(lead: string, text = '', commands: CopyCommand[] = [], note: string | null = null): FixStep {
  return { lead, text, commands, note };
}

function names(rows: readonly AgentRow[]): string {
  const n = rows.map((r) => r.name);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** "3 jobs" / "1 job". */
function jobs(n: number): string {
  return `${n} ${n === 1 ? 'job' : 'jobs'}`;
}

export function issueCopy(issue: AgentIssue, row: AgentRow, rows: readonly AgentRow[], now: number): IssueCopy {
  const code = issue.code;
  const name = row.name;
  // The bench facts come from the issue itself (crew's params), so a folded reviewer's issue speaks for its own
  // seat; the row's own bench fills in what the params leave out (and its reason, for Technical details).
  const p = issue.params ?? {};
  // The bench of the seat that sent the issue (codex S4 r5): never another seat's history or retry time.
  const own = issue.bench ?? null;
  const pStr = (k: string): string | null => (typeof p[k] === 'string' ? (p[k] as string) : null);
  const runs = typeof p['runs'] === 'number' ? p['runs'] : (own?.runs ?? 0);
  const lastIso = pStr('last_at') ?? own?.last_at ?? null;
  const liftsIso = pStr('lifts_at') ?? own?.lifts_at ?? null;
  const lastAt = lastIso !== null && Number.isFinite(Date.parse(lastIso)) ? relTime(Date.parse(lastIso), now) : null;
  const retry = liftsIso !== null ? benchRetry({ lifts_at: liftsIso }) : null;
  const bench = own;
  // Crew's window, said as studio's retry; never as the provider's reset (api-types: lifts_at is NOT a reset).
  const retryLine = retry === null ? '' : ` Studio’s service leaves it out of new jobs for now: ${retry}, or sooner if one of its steps or a sign-in check succeeds.`;
  const notReset = retry === null ? '' : ' That time is studio’s own retry, not when your plan resets; your provider’s account page shows that.';
  const probed = typeof row.seat.probed_at === 'string' && Number.isFinite(Date.parse(row.seat.probed_at)) ? relTime(Date.parse(row.seat.probed_at), now) : null;
  const qe = qeAvailable(rows);
  switch (code) {
    case 'signed_out': {
      const others = otherReady(rows, row.key);
      const signIn = row.login !== null
        ? step('Sign in from your terminal.', `Run this, then follow ${name}’s own sign-in steps (it may open your browser).`, cmd(row.login, 'sign-in'),
          'Studio never sees your password or token: the sign-in happens between your terminal and the provider.')
        : step('Sign in with its own command.', `Studio’s service sent no sign-in command for ${name}. Sign in the way its maker documents, then check again.`);
      return {
        title: 'Signed out',
        what: `${name} was signed out when studio last checked${probed !== null ? ` (${probed})` : ''}.`,
        why: `Until it is signed in it takes no chats, reviews or jobs.${others.length === 0 ? '' : ` Meanwhile ${names(others)} ${others.length === 1 ? 'is' : 'are'} ready: pick ${others.length === 1 ? 'it' : 'one'} in the new-job form.`}`,
        fix: [{ ...signIn, check: true }],
        tech: row.tech.evidence,
      };
    }
    case 'auth_unknown':
      return {
        title: 'Sign-in couldn’t be read',
        what: `Studio’s service hasn’t got an answer yet about whether ${name} is signed in.`,
        why: 'Until it does, studio can’t say whether jobs and reviews will reach it.',
        fix: [step('Check sign-ins now', 'from the top of the page; the answer usually comes within a minute.'), ...(row.login !== null ? [step('If it stays unknown, sign in again:', '', cmd(row.login, 'sign-in'))] : [])],
        tech: row.tech.evidence,
      };
    case 'qe_blocked':
      return {
        title: 'No agent can run quality checks',
        what: `Quality checks need an agent that can start a fresh reviewer, with no memory of the work it is checking. No agent that is signed in can do that right now; ${name} can, once it is signed in.`,
        why: 'Until then, jobs that need a quality check (features, bug fixes, migrations) stop before delivery and wait for you.',
        fix: [
          step(`Sign ${name} in`, 'above. That fixes both problems.'),
          step('Or skip the check on a job', 'when you start it, with a reason. The job is labelled “quality check skipped”.'),
        ],
        tech: null,
      };
    case 'not_admitted':
      return {
        title: 'Not picked for work right now',
        what: `${name} looks signed in, but studio’s service won’t give it work at the moment.`,
        why: 'Jobs and reviews go to the other agents until this clears. The reason is in Technical details.',
        fix: [
          step('Check again in a minute.', 'Studio’s service re-checks each agent on its own.'),
          step('If it keeps happening, sign in again:', '', cmd(row.login, 'sign-in')),
        ],
        tech: row.tech.ineligible,
      };
    case 'codex_worktree':
      return {
        title: 'Skipped on jobs that work in a repository',
        what: `Studio’s service keeps ${name} off jobs that work in one repository. On a computer where its account needs a person to approve each command, every command it tries there comes back “approval request failed”, and a job running on its own has no one to approve.`,
        why: `Builds, fixes and tests in a repository go to the other agents; ${name} still chats and reviews decisions.`,
        fix: [
          step('Leave it as it is (recommended).', qe === false ? 'Quality checks stay unavailable until an agent that can run them is signed in.' : ''),
          { ...step('Or, if you run studio’s service on this computer, allow it in repositories.', 'It takes both of these steps; the account change alone doesn’t lift it.'),
            subLabel: 'Show the two steps',
            sub: [
              step(`Sign ${name} in with an account whose commands don’t need approval:`, '', [...cmd(row.logout, 'sign-out'), ...cmd(row.login, 'sign-in')]),
              { ...step(`Restart the service with ${name} allowed in repositories.`),
                tech: { summary: 'How to restart it that way', text: 'Start the service with WICKED_CODEX_WORKTREE_OK=1 set (the engine benches codex on runs bound to one repository, CODEX_WORKTREE_BENCH, unless the host opts out).' } },
            ] },
        ],
        tech: null,
      };
    case 'repo_refused': {
      const wa = workAdmissionOf(row.seat, 'scoped_bound');
      return {
        title: 'Not given jobs in a repository right now',
        what: `Studio’s service won’t give ${name} jobs that work in one repository at the moment.`,
        why: `Builds, fixes and tests in a repository go to the other agents; ${name} still chats.`,
        fix: [step('Check again in a minute.', 'Studio’s service re-checks each agent on its own; “Check sign-ins now” asks straight away.')],
        tech: wa?.reason_code ?? null,
      };
    }
    case 'no_host_boundary':
      return {
        title: 'Not checked on this computer',
        what: `${name} has no step-by-step check, and its writes are only limited by a sandbox tool around the repository. There is no sandbox tool on this computer, so nothing limits what it writes.`,
        why: 'A job or chat it takes part in can change files outside the work’s repository.',
        fix: [
          step('Pick an agent whose actions are checked', 'for now.'),
          step('Or run studio’s service on a computer with a sandbox tool', '(macOS has one built in; on Linux, install bubblewrap).'),
        ],
        tech: null,
      };
    case 'ungoverned':
      return {
        title: 'Nothing checks its actions',
        what: `${name} has no step-by-step check and no sandbox around its writes on this version, so its actions run unchecked.`,
        why: 'A job on it could change files that studio would normally stop it from touching.',
        fix: [step('Pick an agent whose actions are checked', 'for jobs and chats for now.')],
        tech: row.tech.disclosure,
      };
    case 'fence_scoped': {
      const checked = rows.filter((r) => r.key !== row.key && r.safe.word === 'Every action checked' && r.ready.tone !== 'fail');
      return {
        title: 'Chats without a repository can write anywhere',
        what: `${name} has no step-by-step check, so its writes are only limited when the work is in one repository (a job, or a chat tied to it). In a chat with no repository, nothing limits what it writes.`,
        why: 'Studio also leaves it out of chats that span several repositories, because no single repository limits it there.',
        fix: [
          step('Give it work in one repository.'),
          step('For chats with no repository,', checked.length > 0 ? `pick an agent whose actions are checked: ${names(checked)}.` : 'pick an agent whose actions are checked.'),
        ],
        tech: null,
      };
    }
    case 'version_unproven': {
      const v = row.version.word;
      const proven = /\(approved: (.+)\)/.exec(row.version.sub ?? '')?.[1] ?? null;
      if (v === 'Not found') {
        const pv = row.seat.version_pin?.pinned ?? null;
        const pb = pv === null ? null : /\d+(?:\.\d+)+/.exec(pv)?.[0] ?? pv;
        return {
          title: 'Safety checks are off: its version couldn’t be read',
          what: `${name} didn’t answer when studio asked for its version, so studio can’t tell whether it is the approved build${pb !== null ? ` (${pb})` : ''}. Its safety checks switch off and its actions run unchecked.`,
          why: 'Nothing checks what it does, so a job on it could change files that studio would normally stop it from touching.',
          fix: [
            step('Don’t pick it for jobs for now.'),
            step('Check that it runs:', 'if this prints a version, use “Check sign-ins now”; studio also re-reads versions every few minutes.', cmd(`${row.binary} --version`, 'version check')),
          ],
          tech: row.tech.disclosure,
        };
      }
      if (row.version.sub === 'its version check didn’t answer') {
        return {
          title: 'Safety checks are off: its version check didn’t answer',
          what: `${name} ${v} is the approved build, but it didn’t answer studio’s last check of its version, so its safety checks switch off and its actions run unchecked.`,
          why: 'Nothing checks what it does until the check answers again, so a job on it could change files that studio would normally stop it from touching.',
          fix: [
            step('Don’t pick it for jobs for now.'),
            step('Check that it runs:', 'if this prints a version, use “Check sign-ins now”; studio also re-reads versions every few minutes.', cmd(`${row.binary} --version`, 'version check')),
          ],
          tech: row.tech.disclosure,
        };
      }
      return {
        title: 'Safety checks are off on this version',
        what: `You have ${name} ${v}.${proven !== null ? ` Studio’s safety checks were proven on ${proven}, so on this version they switch off and its actions run unchecked.` : ' Studio’s safety checks switch off on an unapproved version, so its actions run unchecked.'}`,
        why: 'Nothing checks what it does, so a job on it could change files that studio would normally stop it from touching.',
        fix: [
          step('Don’t pick it for jobs for now.'),
          step('Then turn its checks back on, either way:', `wait for the next studio update (it approves newer versions), or install the approved build${proven !== null ? ` ${proven}` : ''} with the same tool you installed it with and check the version:`, cmd(`${row.binary} --version`, 'version check')),
        ],
        tech: row.tech.disclosure,
      };
    }
    case 'quota':
      return {
        title: 'Out of quota',
        what: `${name} answered “quota exhausted” in ${jobs(runs)}${lastAt !== null ? `, most recently ${lastAt}` : ''}.${retryLine}`,
        why: `Other agents take its part meanwhile, and reviews have one fewer voice.${notReset}`,
        fix: [
          step('Wait for your plan to reset.', 'Your provider’s account settings show the reset date.'),
          step('Or upgrade the plan', 'with your provider.'),
          step('Or leave it out of new work', 'until then: untick it when you start a job.'),
        ],
        tech: bench?.reason ?? null,
      };
    case 'usage_limit':
      return {
        title: 'Hit its usage limit',
        what: `${name} answered that it reached its usage limit in ${jobs(runs)}${lastAt !== null ? `, most recently ${lastAt}` : ''}.${retryLine}`,
        why: `Other agents take its part meanwhile.${notReset}`,
        fix: [
          step('Wait for the limit to reset.', 'Your provider’s account settings show when.'),
          step('Or raise the plan’s limit', 'with your provider.'),
        ],
        tech: bench?.reason ?? null,
      };
    case 'benched':
      return {
        title: 'Held back after failed steps',
        what: `${name} failed in ${jobs(runs)}${lastAt !== null ? `, most recently ${lastAt}` : ''}.${retryLine}`,
        why: 'Other agents take its part meanwhile; nothing is lost.',
        fix: [step('Nothing to do now.', 'If it keeps happening, check sign-ins, or leave it out of new work for a while.')],
        tech: bench?.reason ?? null,
      };
    case 'live_check_failed':
      return {
        title: 'Its sign-in didn’t answer a request',
        what: `${name}’s own check says it is signed in, but the one short request studio’s service sent to confirm it got no answer${probed !== null ? ` (${probed})` : ''}.`,
        why: 'Its first step may fail and move to another agent.',
        fix: [
          { ...step('Check again now.', 'An answer that comes back clears this.'), check: true },
          ...(row.login !== null ? [step('If it keeps failing, sign in again:', '', cmd(row.login, 'sign-in'))] : []),
        ],
        tech: row.tech.evidence,
      };
    case 'opt_in':
      return {
        title: 'Opt-in: known to stall',
        what: `${name} sometimes stops answering partway through a step, so new work leaves it out by default.`,
        why: 'Picking it can slow a job down while studio waits and moves its part to another agent.',
        fix: [row.issues.some((i) => i.code === 'version_unproven')
          ? step('Once its checks are back on,', 'pick it per job in the new-job form when you want it.')
          : step('Pick it per job', 'in the new-job form when you want it.')],
        tech: null,
      };
    case 'no_qe':
      return {
        title: 'Can’t run quality checks',
        what: `${name} can’t start a fresh, separate reviewer right now, which quality checks need.`,
        why: `It still builds, fixes and reviews decisions. ${qe === true ? 'Quality checks go to an agent that can run them.' : 'Right now no agent can run them.'}`,
        // The fix agrees with the why (agy #759 r2): with no agent able to run them, there is something to do.
        fix: [qe === true
          ? step('Nothing to do.', 'Studio’s service gives quality checks to an agent that can run them.')
          : step('Sign in an agent that can run them.', 'Until one is signed in, jobs that need a quality check wait for you before delivery.')],
        tech: null,
      };
    case 'unverified':
      return {
        title: 'Sign-in not confirmed',
        what: `${name}’s sign-in hasn’t been confirmed: it has no command that reports it, so studio goes by its saved sign-in. If a request fails because the sign-in has expired, studio marks it signed out.`,
        why: 'A job may start on it and move to another agent.',
        fix: [row.login !== null ? step('If studio marks it signed out, sign in again:', '', cmd(row.login, 'sign-in')) : step('If studio marks it signed out,', 'sign in again with its own command.')],
        tech: row.tech.evidence,
      };
    case 'fallbacks': {
      const a = row.acp;
      return {
        title: 'Often starts fresh for each step',
        what: `${name}’s live session often fails to start or ends early, so studio starts it fresh for those steps instead.`,
        why: 'Work still happens; each of those steps starts from scratch and is slower.',
        fix: [step('No action required.', `For faster live sessions, reinstall ${name} with the same tool you installed it with.`)],
        tech: a === null ? null : [`${a.fallbacks} fresh starts in ${a.sessions} live sessions`, ...Object.entries(a.kinds).map(([k, v]) => `${k}: ${v}`)].join('\n'),
      };
    }
    case 'unknown':
      // A code this studio has no words for: crew's own line, in Technical details only (§4.3).
      return {
        title: 'Something else studio’s service noticed',
        what: `Studio’s service flagged ${name} for something this version of studio has no words for yet.`,
        why: 'The details below are the service’s own words.',
        fix: [step('Update studio when you can;', 'newer versions explain this.')],
        tech: [issue.wire ?? null, issue.message ?? null].filter((x): x is string => x !== null).join(': ') || null,
      };
  }
}

export const SEVERITY_WORD = { problem: 'Problem', warning: 'Warning', note: 'Note' } as const;
