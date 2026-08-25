import { describe, expect, it } from 'vitest';
import {
  DELIVERY_COLOR,
  DELIVERY_LABEL,
  canDeliver,
  deliverUnit,
  deliveryOf,
  deliverySummary,
  isPrUrl,
  prUrlFrom,
  resolveDelivery,
  type DeliveryState,
} from '../src/components/delivery.js';
import { HEADLINE } from '../src/components/RunDelivery.js';
import { isSystemWorkflowIn } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_WORKFLOWS, materialised } from './fixtures/workflows.js';
import {
  EMPTY_PUSH_OUTPUT,
  NO_URL_REASON,
  NOTHING_REASON,
  REAL_DELIVER_OUTPUT,
  REAL_PR_URL,
} from './fixtures/deliverOutput.js';
import type { SessionView, UnitStatus, WorkUnit } from '../src/api/types.js';

/**
 * The delivery derivation (wicked-studio#122, slice DA) — the one pure fact
 * every surface reads. Table-driven, because the whole value of the module is
 * that the project page, the build list and the right panel CANNOT disagree.
 */

/** A run whose deliver phase is the COMPOSED one (`<runId>:deliver`). */
function composed(status: UnitStatus, denial: string | null = null): SessionView {
  return makeView({ id: 'run-1', workflow_id: 'wf-run-1' }, [
    makeUnit({ id: 'run-1:build', ord: 0, status: 'done' }),
    makeUnit({ id: 'run-1:deliver', ord: 1, status, denial_reason: denial }),
  ]);
}

/**
 * A run whose deliver phase came from an OVERLAY that named it something else —
 * run 5c5e08b7's shape (a `feature-pr` overlay carrying its own deliver phase,
 * so nothing about its ids or its `workflow_id` says "deliver").
 */
function overlay(status: UnitStatus, denial: string | null = null): SessionView {
  return makeView({ id: 'run-1', workflow_id: 'feature-pr' }, [
    makeUnit({ id: 'run-1:build', ord: 0, status: 'done' }),
    makeUnit({
      id: 'run-1:open-the-pr', ord: 1, status, denial_reason: denial,
      tool_cmd: ['bash', '-lc', 'set -euo pipefail\ngit push …\ngh pr create --head "$B" --fill'],
    }),
  ]);
}

describe('prUrlFrom — crew\'s own grep, mirrored (deliver.ts:162)', () => {
  const cases: { name: string; text: string; want: string | null }[] = [
    {
      name: 'the real 5c5e08b7 transcript: the NUMBERED PR, never the pull/new form',
      text: REAL_DELIVER_OUTPUT,
      want: REAL_PR_URL,
    },
    {
      name: 'a create-PR form ALONE resolves to nothing (the digits are the whole gate)',
      text: 'remote:      https://github.com/o/r/pull/new/wicked/665a9aeb-285d-407b\n',
      want: null,
    },
    {
      name: 'the REAL 665a9aeb transcript — an approved phase that opened no PR',
      text: EMPTY_PUSH_OUTPUT,
      want: null,
    },
    {
      name: 'the LAST numbered match wins, same as crew\'s `tail -1`',
      text: 'https://github.com/o/r/pull/7\nsuperseded by\nhttps://github.com/o/r/pull/121',
      want: 'https://github.com/o/r/pull/121',
    },
    {
      name: 'a fragment does not bleed into the href',
      text: 'https://github.com/o/r/pull/121#issuecomment-99',
      want: 'https://github.com/o/r/pull/121',
    },
    {
      name: 'trailing prose punctuation is not part of the url',
      text: 'opened https://github.com/o/r/pull/121.',
      want: 'https://github.com/o/r/pull/121',
    },
    { name: 'an empty transcript', text: '', want: null },
    { name: 'a transcript with no url at all', text: 'Everything up-to-date\n', want: null },
  ];

  for (const { name, text, want } of cases) {
    it(name, () => {
      expect(prUrlFrom(text)).toBe(want);
    });
  }

  it('EC55: whatever it returns satisfies the href shape the surface promises', () => {
    const url = prUrlFrom(REAL_DELIVER_OUTPUT);
    expect(url).not.toBeNull();
    expect(url).toMatch(/^https:\/\/\S+\/pull\/\d+$/);
    expect(url).not.toContain('/pull/new/');
  });
});

describe('deliveryOf — five mutually exclusive states, zero fetches', () => {
  const cases: {
    name: string;
    view: SessionView;
    state: DeliveryState;
    unitId: string | null;
    reason: string | null;
  }[] = [
    {
      name: 'no deliver phase at all',
      view: makeView({ id: 'run-1' }, [makeUnit({ id: 'run-1:build', status: 'done' })]),
      state: 'none', unitId: null, reason: null,
    },
    {
      name: 'a run with no units at all',
      view: makeView({ id: 'run-1' }, []),
      state: 'none', unitId: null, reason: null,
    },
    {
      name: 'the composed deliver unit is done → delivered',
      view: composed('done'), state: 'delivered', unitId: 'run-1:deliver', reason: null,
    },
    {
      name: 'rejected with crew#318\'s refusal → nothing-to-deliver',
      view: composed('rejected', NOTHING_REASON),
      state: 'nothing-to-deliver', unitId: 'run-1:deliver', reason: NOTHING_REASON,
    },
    {
      name: 'rejected for any OTHER reason → failed',
      view: composed('rejected', NO_URL_REASON),
      state: 'failed', unitId: 'run-1:deliver', reason: NO_URL_REASON,
    },
    {
      name: 'rejected with NO recorded reason → failed, and nothing is synthesized',
      view: composed('rejected', null), state: 'failed', unitId: 'run-1:deliver', reason: null,
    },
    {
      name: 'pending → in-flight',
      view: composed('pending'), state: 'in-flight', unitId: 'run-1:deliver', reason: null,
    },
    {
      name: 'distributed → in-flight',
      view: composed('distributed'), state: 'in-flight', unitId: 'run-1:deliver', reason: null,
    },
    {
      name: 'EC61: an OVERLAY-named deliver unit resolves via tool_cmd, by its FULL id',
      view: overlay('done'), state: 'delivered', unitId: 'run-1:open-the-pr', reason: null,
    },
    {
      name: 'EC61: an overlay-named unit that was rejected still reads its denial_reason',
      view: overlay('rejected', NOTHING_REASON),
      state: 'nothing-to-deliver', unitId: 'run-1:open-the-pr', reason: NOTHING_REASON,
    },
  ];

  for (const { name, view, state, unitId, reason } of cases) {
    it(name, () => {
      const d = deliveryOf(view);
      expect(d.state).toBe(state);
      expect(d.unitId).toBe(unitId);
      // The reason is the wire's bytes, asserted by EQUALITY — never a phrase match.
      expect(d.reason).toStrictEqual(reason);
      // Nothing here has a server-carried url yet (crew#321 is unshipped).
      expect(d.url).toBeNull();
    });
  }

  it('EC61: the derivation is INDIFFERENT to session.workflow_id', () => {
    const ids = ['chat', 'feature', 'feature-pr', 'wf-run-1', '', 'deliver'];
    const results = ids.map((workflow_id) =>
      deliveryOf(makeView({ id: 'run-1', workflow_id }, [
        makeUnit({ id: 'run-1:deliver', ord: 0, status: 'done' }),
      ])),
    );
    for (const r of results) expect(r).toStrictEqual(results[0]);
    expect(results[0]?.state).toBe('delivered');
  });

  it('the id suffix beats the tool_cmd probe when a run somehow carries both', () => {
    const view = makeView({ id: 'run-1' }, [
      makeUnit({ id: 'run-1:open-the-pr', ord: 0, status: 'rejected', tool_cmd: ['gh pr create'] }),
      makeUnit({ id: 'run-1:deliver', ord: 1, status: 'done' }),
    ]);
    expect(deliverUnit(view)?.id).toBe('run-1:deliver');
    expect(deliveryOf(view).state).toBe('delivered');
  });

  it('a tool unit that is NOT a deliver phase does not masquerade as one', () => {
    const view = makeView({ id: 'run-1' }, [
      makeUnit({ id: 'run-1:test', ord: 0, status: 'done', tool_cmd: ['bash', '-lc', 'npm test'] }),
    ]);
    expect(deliverUnit(view)).toBeNull();
    expect(deliveryOf(view).state).toBe('none');
  });

  it('a unit that only MENTIONS `gh pr create` is not the deliver phase', () => {
    // The fallback used a bare `.includes()`, so any Tool phase carrying the
    // string anywhere in its joined command inherited the whole delivery claim.
    const mentions = [
      ['bash', '-lc', "grep -rn 'gh pr create' docs/"],
      ['bash', '-lc', 'echo "run gh pr create yourself when the review lands"'],
      ['bash', '-lc', "sed -i 's/gh pr create/gh pr view/' scripts/deliver.sh"],
      ['rg', '--fixed-strings', 'gh pr create'],
    ];
    for (const tool_cmd of mentions) {
      const view = makeView({ id: 'run-1' }, [
        makeUnit({ id: 'run-1:tool', ord: 0, status: 'done', tool_cmd }),
      ]);
      expect(deliverUnit(view), tool_cmd.join(' ')).toBeNull();
      expect(deliveryOf(view).state).toBe('none');
    }
  });

  it('…but a real INVOCATION still resolves, in every shape the live daemon runs', () => {
    // Both strings are the live daemon's own deliver commands, joined.
    const invocations = [
      ['gh', 'pr', 'create', '--head', 'B', '--fill'],
      ['bash', '-lc', 'git push -u origin "$B"; gh pr create --head "$B" --fill 2>&1 | tail -1'],
      ['bash', '-lc', 'set -euo pipefail\ngit push …\ngh pr create --head "$B" --fill'],
      ['bash', '-lc', 'git push && gh pr create --fill'],
      ['bash', '-lc', 'URL=$(gh pr create --fill)'],
    ];
    for (const tool_cmd of invocations) {
      const view = makeView({ id: 'run-1' }, [
        makeUnit({ id: 'run-1:tool', ord: 0, status: 'done', tool_cmd }),
      ]);
      expect(deliverUnit(view)?.id, tool_cmd.join(' ')).toBe('run-1:tool');
    }
  });

  it('an EMPTY denial_reason normalizes to null — `?? "…"` may not paint a blank line', () => {
    // The same absent-and-empty class of bug already fixed in `store/delivery.ts`.
    const d = deliveryOf(composed('rejected', ''));
    expect(d.state).toBe('failed');
    expect(d.reason).toBeNull();
  });

  it('reads the server-carried url when the daemon carries one (crew#321)', () => {
    const view = composed('done');
    const session = { ...view.session, delivery: { kind: 'pull_request', url: 'https://x/pull/9' } };
    expect(deliveryOf({ ...view, session: session as typeof view.session }).url)
      .toBe('https://x/pull/9');
  });
});

describe('resolveDelivery — the PR claim needs a URL IN HAND (D1/D2)', () => {
  /** The REAL 665a9aeb shape: `done`, `denial_reason: null`, no url anywhere. */
  const realShape = composed('done');

  it('the 665a9aeb shape claims the PHASE, never the artifact — with no read', () => {
    const r = resolveDelivery(deliveryOf(realShape));
    expect(r.state).toBe('delivered'); // the phase WAS approved…
    expect(r.claim).toBe('delivered'); // …and that alone claims nothing
    expect(r.href).toBeNull();
    expect(DELIVERY_LABEL[r.claim]).toBe('deliver ran');
    expect(DELIVERY_LABEL[r.claim]).not.toContain('PR');
  });

  it('the 665a9aeb shape STILL claims the phase after its transcript is read', () => {
    // `prUrlFrom` over the real 677-byte transcript is the read's whole result.
    const readUrl = prUrlFrom(EMPTY_PUSH_OUTPUT);
    expect(readUrl).toBeNull();

    const r = resolveDelivery(deliveryOf(realShape), readUrl);
    expect(r.claim).toBe('delivered');
    expect(r.href).toBeNull();
    expect(DELIVERY_COLOR[r.claim]).not.toBe('var(--accent)');
    // …and it is not painted as a failure either: an approved phase that
    // produced no PR is missing evidence, not a run that failed.
    expect(DELIVERY_COLOR[r.claim]).not.toBe('var(--status-fail)');
  });

  it('a url from the ONE transcript read earns `pr-open`, the accent and the href', () => {
    const r = resolveDelivery(deliveryOf(composed('done')), prUrlFrom(REAL_DELIVER_OUTPUT));
    expect(r.claim).toBe('pr-open');
    expect(r.href).toBe(REAL_PR_URL);
    expect(DELIVERY_LABEL[r.claim]).toBe('PR open');
    expect(DELIVERY_COLOR[r.claim]).toBe('var(--accent)');
  });

  it('a WIRE-carried url earns it with no read at all (crew#321)', () => {
    const view = composed('done');
    const session = { ...view.session, delivery: { kind: 'pull_request', url: 'https://x/pull/9' } };
    const r = resolveDelivery(deliveryOf({ ...view, session: session as typeof view.session }));
    expect(r.claim).toBe('pr-open');
    expect(r.href).toBe('https://x/pull/9');
  });

  it('an EMPTY url is an ABSENT url — at the derivation AND at the claim', () => {
    // Third member of the same absent-vs-empty class as `denial_reason` and
    // `outputUnavailable`. Un-normalized, `'' ?? readUrl` keeps the empty
    // string, `href === null` is false, and the surface paints "PR open" in
    // `--accent` over an `href=""` that points back at studio. Both layers are
    // pinned: the wire read, and `resolveDelivery`'s own re-check (it is
    // exported and takes a hand-built `Delivery`).
    const view = composed('done');
    const session = { ...view.session, delivery: { kind: 'pull_request', url: '' } };
    expect(deliveryOf({ ...view, session: session as typeof view.session }).url).toBeNull();

    const hand = { state: 'delivered' as const, unitId: 'r:deliver', reason: null, url: '' };
    expect(resolveDelivery(hand).claim).toBe('delivered');
    expect(resolveDelivery(hand).href).toBeNull();
    expect(resolveDelivery({ ...hand, url: null }, '').claim).toBe('delivered');
    expect(resolveDelivery({ ...hand, url: null }, '').href).toBeNull();
  });

  it('a read url can never upgrade a state that was not approved', () => {
    const states: DeliveryState[] = ['none', 'in-flight', 'nothing-to-deliver', 'failed'];
    const views = [
      makeView({ id: 'run-1' }, [] as WorkUnit[]),
      composed('pending'),
      composed('rejected', NOTHING_REASON),
      composed('rejected', NO_URL_REASON),
    ];
    for (const [i, v] of views.entries()) {
      const r = resolveDelivery(deliveryOf(v), REAL_PR_URL);
      expect(r.claim).toBe(states[i]);
      expect(r.href).toBeNull();
    }
  });
});

describe('DELIVERY_LABEL', () => {
  it('says nothing for a run with no deliver phase, and never says "shipped"/"merged"', () => {
    expect(DELIVERY_LABEL['none']).toBe('');
    const words = Object.values(DELIVERY_LABEL).join(' ').toLowerCase();
    expect(words).not.toContain('shipped');
    expect(words).not.toContain('merged');
  });

  it('exactly ONE claim may mention a PR, and it is the one that holds a url', () => {
    const mentions = Object.entries(DELIVERY_LABEL)
      .filter(([, w]) => /\bPR\b/i.test(w))
      .map(([k]) => k);
    expect(mentions).toStrictEqual(['pr-open']);
  });
});

describe('HEADLINE — the rail body says what the badge says', () => {
  // The badge WORD carried a structural guard and this sentence did not, so
  // `HEADLINE['delivered']` could be edited back to "PR open — merge stays
  // human." (the review's own example of the lie) with the suite still green.
  it('exactly ONE headline asserts an open PR, and it is the url-bearing claim', () => {
    const asserts = Object.entries(HEADLINE)
      .filter(([, s]) => /\bPR open\b/i.test(s))
      .map(([k]) => k);
    expect(asserts).toStrictEqual(['pr-open']);
  });

  it('NO headline asserts a PR exists or does not exist, except the url-bearing one', () => {
    // The guard above pinned the POSITIVE lie ("PR open") because that is the one round 3
    // found. It said nothing about the negative — and `in-flight` shipped "no PR exists yet",
    // which the wire cannot evidence either: the deliver script creates the PR partway through
    // the phase, so a still-running unit may already have one. Same rule, both directions.
    const EXISTENCE = /\b(no PR|PR exists|PR was (?:not )?(?:created|opened)|there is no PR|without a PR)\b/i;
    const offenders = Object.entries(HEADLINE)
      .filter(([k, sentence]) => k !== 'pr-open' && EXISTENCE.test(sentence))
      .map(([k]) => k);
    expect(offenders).toStrictEqual([]);
  });

  it('NO headline asserts a phase is EXECUTING — `pending` means unresolved, not running', () => {
    // The second own-goal (Copilot on #125): the fix for "no PR exists yet" replaced it with
    // "is still running", which this module elsewhere states is false — a cancelled run's
    // deliver unit stays `pending` forever, and 10 of the live corpus's 12 `distributed` units
    // sit in terminal sessions. We know a unit has not RESOLVED; we do not know it is RUNNING.
    const MOTION = /\b(still running|in progress|currently running|executing|underway|in flight)\b/i;
    const offenders = Object.entries(HEADLINE)
      .filter(([, sentence]) => MOTION.test(sentence))
      .map(([k]) => k);
    expect(offenders).toStrictEqual([]);
  });

  it('the phase-only headline names the PHASE and denies the artifact', () => {
    const line = HEADLINE['delivered'];
    expect(line).toContain('deliver phase');
    expect(line).toMatch(/not a PR/i);
    expect(line).not.toMatch(/\bPR open\b/i);
  });

  it('no headline says shipped or merged-without-a-human', () => {
    const words = Object.values(HEADLINE).join(' ').toLowerCase();
    expect(words).not.toContain('shipped');
    expect(words).not.toContain('merged');
  });
});

/** The authoritative lookup, as the app's workflow cache serves it. */
const KNOWN = (id: string): boolean | undefined => isSystemWorkflowIn(LIVE_WORKFLOWS, id);

describe('deliverySummary — the census over ALL DELIVERABLE runs', () => {
  it('counts every claim, in the brief\'s own order', () => {
    const views = [
      composed('done'), composed('done'), composed('done'),
      composed('rejected', NOTHING_REASON), composed('rejected', NOTHING_REASON),
      ...Array.from({ length: 11 }, () => makeView({ id: 'r', workflow_id: 'feature' }, [] as WorkUnit[])),
    ];
    // "3 delivered" was the lie: three approved phases, zero known PRs.
    // The lookup is what licenses the "no deliver phase" bucket at all: eleven
    // `feature` runs are countable because a def in hand says `feature` is an
    // ordinary workflow. The three delivering runs need no such licence — they
    // have a deliver unit, and their `wf-run-1` def is in no catalog.
    expect(deliverySummary(views, KNOWN)).toBe('3 ran deliver · 2 delivered nothing · 11 no deliver phase');
  });

  it('D3: the in-flight bucket matches its own label — no forward-looking wording', () => {
    const line = deliverySummary([composed('rejected', NO_URL_REASON), composed('pending')]);
    expect(line).toBe('1 failed to deliver · 1 deliver pending');
    // The label refuses "still"/"to deliver" because a cancelled run's unit
    // stays `pending` forever; the census may not smuggle them back in.
    expect(line).not.toContain('still');
    expect(DELIVERY_LABEL['in-flight']).toBe('pending');
  });

  it('D5: chats are not counted — the rail hides Delivery from them, so does the census', () => {
    const chats = Array.from({ length: 30 }, () =>
      makeView({ id: 'c', workflow_id: 'chat' }, [] as WorkUnit[]));
    const freeform = makeView({ id: 'f', workflow_id: '' }, [] as WorkUnit[]);
    const system = makeView({ id: 's', workflow_id: 'onboarding' }, [] as WorkUnit[]);

    // The exact reported symptom: "3 delivered · 30 no deliver phase".
    expect(deliverySummary([composed('done'), composed('done'), composed('done'), ...chats]))
      .toBe('3 ran deliver');
    expect(deliverySummary([...chats, freeform, system])).toBe('');
  });

  it('an empty project says nothing rather than "0 delivered"', () => {
    expect(deliverySummary([])).toBe('');
  });

  it('a wire-carried url is counted as an open PR, separately from the phase', () => {
    const view = composed('done');
    const withUrl = {
      ...view,
      session: { ...view.session, delivery: { kind: 'pull_request', url: 'https://x/pull/9' } } as typeof view.session,
    };
    expect(deliverySummary([withUrl, composed('done')])).toBe('1 PR open · 1 ran deliver');
  });
});

describe('canDeliver — the ONE predicate every surface gates on (D5)', () => {
  /** A run on `workflow_id` with NO deliver phase — the arm that needs a licence. */
  const plainOn = (workflow_id: string | null): SessionView => {
    const view = makeView({ id: 'run-1' }, [makeUnit({ id: 'run-1:build', status: 'done' })]);
    return { ...view, session: { ...view.session, workflow_id } as typeof view.session };
  };

  describe('NO deliver phase: only a def in hand licenses the claim', () => {
    const cases: { workflow_id: string | null; want: boolean; why: string }[] = [
      { workflow_id: 'feature', want: true, why: 'in the catalog, no is_system flag' },
      { workflow_id: 'feature-pr', want: true, why: 'in the catalog, no is_system flag' },
      // THE CHANGE. 86 of the 129 live runs carry a materialised `wf-<runId>`
      // def that `GET /workflows` does not serve, so the lookup answers
      // `undefined` for them forever. Saying "this run has no deliver phase"
      // about a run studio cannot classify is asserting past the wire — and it
      // put a Delivery section on 30 interactive document threads.
      { workflow_id: materialised('665a9aeb-285d-407b-b869-813b67e50973'), want: false, why: 'materialised: in no catalog, ever' },
      { workflow_id: 'a-workflow-shipped-tomorrow', want: false, why: 'unknown id, nothing proves it' },
      { workflow_id: 'chat', want: false, why: 'is_system' },
      { workflow_id: 'onboarding', want: false, why: 'is_system' },
      { workflow_id: 'interactive-draft', want: false, why: 'is_system (the denylist never knew it)' },
      { workflow_id: 'survey-repo', want: false, why: 'is_system' },
      { workflow_id: 'memories', want: false, why: 'is_system' },
      { workflow_id: '', want: false, why: 'freeform — deliver without workflow is a 400' },
      { workflow_id: null, want: false, why: 'freeform' },
    ];

    for (const { workflow_id, want, why } of cases) {
      it(`${JSON.stringify(workflow_id)} → ${want ? 'deliverable' : 'withheld'} (${why})`, () => {
        expect(canDeliver(plainOn(workflow_id), KNOWN)).toBe(want);
      });
    }

    it('with NO lookup nothing is deliverable — the predicate withholds, never invents', () => {
      for (const { workflow_id } of cases) {
        expect(canDeliver(plainOn(workflow_id)), `${workflow_id} with a cold cache`).toBe(false);
      }
    });
  });

  describe('a deliver phase IN HAND licenses itself, whatever the workflow id', () => {
    // 5c5e08b7 opened a real PR and its `workflow_id` is `wf-5c5e08b7-…`.
    // Gating this arm on the catalog would hide a PR the operator has.
    const statuses: UnitStatus[] = ['done', 'rejected', 'pending', 'distributed'];
    for (const status of statuses) {
      it(`${status} on a materialised def is shown and counted, warm cache or cold`, () => {
        const view = composed(status, status === 'rejected' ? NOTHING_REASON : null);
        expect(view.session.workflow_id, 'the fixture is a materialised def').toBe('wf-run-1');
        expect(KNOWN('wf-run-1'), 'which the catalog does not carry').toBeUndefined();
        expect(canDeliver(view, KNOWN)).toBe(true);
        expect(canDeliver(view)).toBe(true);
      });
    }

    it('an OVERLAY-named deliver unit counts too — resolution is by unit, not by id', () => {
      expect(canDeliver(overlay('done'), KNOWN)).toBe(true);
      expect(canDeliver(overlay('done'))).toBe(true);
    });

    it('…and a deliver phase on a SYSTEM workflow is still evidence, not a guess', () => {
      const view = composed('done');
      const session = { ...view.session, workflow_id: 'interactive-draft' } as typeof view.session;
      expect(canDeliver({ ...view, session }, KNOWN)).toBe(true);
    });
  });
});

describe('isPrUrl — one gate for BOTH url sources (Copilot on #125)', () => {
  const HOSTILE = [
    'javascript:alert(1)',                                 // would execute in an <a href>
    'data:text/html,<script>alert(1)</script>',
    'http://github.com/o/r/pull/1',                        // not https
    'https://e.test/o/r/pull/new/b?x=/pull/9',             // digits smuggled in the QUERY
    'https://github.com/o/r/pull/new/wicked/branch',       // the create-PR form
    'https://github.com/o/r/pull/',
    'https://github.com/o/r/pull/abc',
    'not a url at all',
    '',
    '   ',
  ];
  it.each(HOSTILE)('refuses %j', (bad) => {
    expect(isPrUrl(bad)).toBe(false);
  });

  it('accepts a real PR url, and a bare-host one', () => {
    expect(isPrUrl('https://github.com/mikeparcewski/wicked-studio/pull/121')).toBe(true);
    expect(isPrUrl('https://x/pull/9')).toBe(true);
  });

  it('validates SHAPE, not provenance — a foreign https host of the right shape passes', () => {
    // Stated so nobody mistakes this for a trust boundary: crew re-derives the url from the
    // run's own git remote and GitHub Enterprise is a real deployment, so an allowlist here
    // would be a second, weaker copy of a server-side decision.
    expect(isPrUrl('https://ghe.internal.example/o/r/pull/7')).toBe(true);
  });

  it('a WIRE-carried url gets the same gate as a transcript-derived one', () => {
    // The whole point: `session.delivery.url` is not more trustworthy for arriving on the wire.
    for (const bad of HOSTILE) {
      const view = makeView({ id: 'r-wire', workflow_id: 'feature' }, [
        makeUnit({ id: 'r-wire:deliver', status: 'done', tool_cmd: ['bash', '-lc', 'gh pr create'] }),
      ]);
      (view.session as unknown as { delivery: { kind: string; url: string } }).delivery = {
        kind: 'pull_request',
        url: bad,
      };
      const d = deliveryOf(view);
      expect(d.url).toBeNull();
      // …and with no url in hand the claim can never be the artifact.
      expect(resolveDelivery(d).claim).not.toBe('pr-open');
    }
  });
});
