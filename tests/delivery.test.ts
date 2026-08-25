import { describe, expect, it } from 'vitest';
import {
  DELIVERY_LABEL,
  deliverUnit,
  deliveryOf,
  deliverySummary,
  prUrlFrom,
  type DeliveryState,
} from '../src/components/delivery.js';
import { makeUnit, makeView } from './factories.js';
import {
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

  it('reads the server-carried url when the daemon carries one (crew#321)', () => {
    const view = composed('done');
    const session = { ...view.session, delivery: { kind: 'pull_request', url: 'https://x/pull/9' } };
    expect(deliveryOf({ ...view, session: session as typeof view.session }).url)
      .toBe('https://x/pull/9');
  });
});

describe('DELIVERY_LABEL', () => {
  it('says nothing for a run with no deliver phase, and never says "shipped"/"merged"', () => {
    expect(DELIVERY_LABEL['none']).toBe('');
    const words = Object.values(DELIVERY_LABEL).join(' ').toLowerCase();
    expect(words).not.toContain('shipped');
    expect(words).not.toContain('merged');
  });
});

describe('deliverySummary — the census over ALL runs', () => {
  it('counts every state, in the brief\'s own order', () => {
    const views = [
      composed('done'), composed('done'), composed('done'),
      composed('rejected', NOTHING_REASON), composed('rejected', NOTHING_REASON),
      ...Array.from({ length: 11 }, () => makeView({ id: 'r' }, [] as WorkUnit[])),
    ];
    expect(deliverySummary(views)).toBe('3 delivered · 2 delivered nothing · 11 no deliver phase');
  });

  it('names failures and in-flight deliveries too, and omits empty buckets', () => {
    expect(deliverySummary([composed('rejected', NO_URL_REASON), composed('pending')]))
      .toBe('1 failed to deliver · 1 still to deliver');
  });

  it('an empty project says nothing rather than "0 delivered"', () => {
    expect(deliverySummary([])).toBe('');
  });
});
