// wicked-core#431 / api-types 0.33.0 on the run HEADER's context rows (WhatWhere): the one-line
// "based on origin/<ref> @ <commit>, N behind, lifted" note, present exactly when the run's log
// carries `runBaseResolved` — a resumed run and a pre-0.33.0 daemon show no base row at all.

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mergeRunModel } from '../src/hooks/useRunModel.js';
import { WhatWhere } from '../src/components/WhatWhere.js';
import { useRunEventStore } from '../src/store/events.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';
import { G4_EVENTS, GATE_RUN } from './fixtures/gateEvidence.js';
import { BASE_AFTER, BASE_BEFORE, RUN_BASE_FETCH_FAILED, RUN_BASE_LIFTED, RUN_BASE_NO_REMOTE } from './fixtures/wire433.js';

function mount(events: CoreEvent[]): void {
  useRunEventStore.setState({ byRun: { [GATE_RUN]: events } });
  const view = makeView({ id: GATE_RUN, status: 'executing', problem: 'fix the reported issue', clis: ['claude'], repo_ref: 'studio-api' }, [
    makeUnit({ id: `${GATE_RUN}:triage`, session_id: GATE_RUN, ord: 1, stage: 'recon', status: 'done' }),
  ]);
  render(<WhatWhere model={mergeRunModel(view, events)} />);
}

beforeEach(() => useRunEventStore.setState({ byRun: {} }));

describe('WhatWhere — the base row', () => {
  it('lifted: "origin/main @ <commit> · N behind · lifted to the tip"', () => {
    mount([RUN_BASE_LIFTED, ...G4_EVENTS]);
    const row = screen.getByTestId('run-base');
    expect(row).toHaveTextContent('base');
    expect(row).toHaveTextContent(`origin/main @ ${BASE_AFTER.slice(0, 7)} · 5 behind · lifted to the tip`);
    expect(row.querySelector('[title]')).toBeNull(); // no note ⇒ no hover text
  });

  it('no remote default branch: the local HEAD is named, the engine\'s note is the hover text', () => {
    mount([RUN_BASE_NO_REMOTE]);
    const row = screen.getByTestId('run-base');
    expect(row).toHaveTextContent(`local HEAD @ ${BASE_BEFORE.slice(0, 7)} · no remote default branch resolved`);
    expect(row.querySelector('[title]')).toHaveAttribute('title', 'no remote default branch resolved (origin/HEAD is unset)');
  });

  it('a failed fetch is disclosed on the row', () => {
    mount([RUN_BASE_FETCH_FAILED]);
    expect(screen.getByTestId('run-base')).toHaveTextContent('fetch failed — cached refs');
  });

  it('no runBaseResolved in the log (a resumed run, an older daemon) ⇒ no base row; the other rows stand', () => {
    mount(G4_EVENTS);
    expect(screen.queryByTestId('run-base')).toBeNull();
    expect(screen.getByTestId('what-where')).toHaveTextContent('repo');
    expect(screen.getByTestId('what-where')).toHaveTextContent('studio-api');
  });
});
