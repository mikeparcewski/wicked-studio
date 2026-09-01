// Slice X2's unit spine (DES-UX-001 §7.3 + §7.10): the error-translation layer,
// quoted-name extraction, compact paths, contributor de-dup.
import { describe, expect, it } from 'vitest';
import { ApiError, apiStatus, apiWire, isRouteAbsent, translateWireError } from '../src/api/errors.js';
import { parseCreateAsk } from '../src/interactive/createAsk.js';
import { compactPath } from '../src/components/WhatWhere.js';
import { dedupeContributors } from '../src/components/RepoDetailPage.js';

describe('the EC33 translation layer', () => {
  it('carries the daemon sentence whole, without the API NNN: framing', () => {
    const e = new ApiError(409, 'not awaiting a human gate');
    expect(e.message).toBe('the daemon refused this — not awaiting a human gate');
    expect(e.message).not.toContain('API 4');
    expect(e.status).toBe(409);
    expect(e.wire).toBe('not awaiting a human gate');
  });

  it('a body-less refusal still gets an honest sentence naming the code in words', () => {
    expect(translateWireError(500, '  ')).toBe(
      'the daemon refused this — it answered HTTP 500 with no detail');
  });

  it('matchers read the typed fields, and non-wire errors answer null', () => {
    const e = new ApiError(404, 'Not Found');
    expect(apiStatus(e)).toBe(404);
    expect(apiWire(e)).toBe('Not Found');
    expect(isRouteAbsent(e)).toBe(true);
    // Crew's SPA-serving notFoundHandler (every bundled daemon) spells it lowercase.
    expect(isRouteAbsent(new ApiError(404, 'not found'))).toBe(true);
    expect(isRouteAbsent(new ApiError(404, 'unknown run: r-9'))).toBe(false);
    expect(apiStatus(new Error('API 409: legacy'))).toBeNull();
    expect(apiWire('boom')).toBeNull();
  });
});

describe('parseCreateAsk (§7.3 quoted-name extraction)', () => {
  it('the brief AC verbatim: a deck named "uxr-x" → name uxr-x, remainder = brief', () => {
    const p = parseCreateAsk('a deck named "uxr-x" summarizing the Q3 results');
    expect(p).toEqual({ name: 'uxr-x', brief: 'a deck summarizing the Q3 results' });
  });

  it('curly quotes parse; the naming cue is removed with the span', () => {
    const p = parseCreateAsk('a one-pager called “uxr-quarterly-brief” for the leads');
    expect(p).toEqual({ name: 'uxr-quarterly-brief', brief: 'a one-pager for the leads' });
  });

  it('no quotes → null (the first-six-words fallback stays in charge)', () => {
    expect(parseCreateAsk('summarize the Q3 results as a deck')).toBeNull();
  });

  it('a name-only ask keeps the full ask as the brief — a name is not a brief', () => {
    const p = parseCreateAsk('"uxr-x"');
    expect(p).toEqual({ name: 'uxr-x', brief: '"uxr-x"' });
  });

  it('an empty quoted span is no name', () => {
    expect(parseCreateAsk('a deck named "" about nothing')).toBeNull();
  });

  it('apostrophe contractions never false-parse as a quoted name', () => {
    expect(parseCreateAsk("summarize last week's numbers, don't include drafts")).toBeNull();
    expect(parseCreateAsk('summarize last week’s numbers, don’t include drafts')).toBeNull();
  });

  it('"renamed" is not the naming cue — the quoted span still parses alone', () => {
    const p = parseCreateAsk('a doc renamed "x-1" please');
    expect(p).toEqual({ name: 'x-1', brief: 'a doc renamed please' });
  });
});

describe('compactPath (§7.10 — the 5-line wrap retires)', () => {
  it('long absolute paths compact to their tail', () => {
    expect(compactPath('/private/var/folders/ab/T/wicked/worktrees/r-auth')).toBe(
      '…/worktrees/r-auth');
  });
  it('short paths stay whole', () => {
    expect(compactPath('/w2/upload')).toBe('/w2/upload');
  });
});

describe('dedupeContributors (§7.10 — one person, one row)', () => {
  it('merges by email (case-insensitive), sums commits, busier spelling wins', () => {
    const rows = dedupeContributors([
      { name: 'Mika P', email: 'mika@example.com', commits: 3 },
      { name: 'mika', email: 'MIKA@example.com', commits: 9 },
      { name: 'Someone Else', email: 'else@example.com', commits: 4 },
    ]);
    expect(rows).toEqual([
      { name: 'mika', email: 'mika@example.com', commits: 12 },
      { name: 'Someone Else', email: 'else@example.com', commits: 4 },
    ]);
  });

  it('merges by display name when the emails differ (work + noreply)', () => {
    const rows = dedupeContributors([
      { name: 'Mika P', email: 'mika@work.com', commits: 5 },
      { name: 'Mika P', email: '123+mika@users.noreply.github.com', commits: 2 },
    ]);
    expect(rows).toEqual([{ name: 'Mika P', email: 'mika@work.com', commits: 7 }]);
  });
});
