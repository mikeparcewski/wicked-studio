import { describe, expect, it } from 'vitest';
import { nextAsk, nextOptions, PAGE_CHAT_KINDS, PAGE_CHAT_SPECS, pageChatRules, pageChatSessionKey, rememberAsk, rememberLines, textLines } from '../src/board/pageChat.js';
import { buildContextPack, focusPack, splitAskContext } from '../src/components/askContext.js';
import { pageContext } from '../src/board/pagePrompts.js';

describe('page chats (DES-LEARN §6.2)', () => {
  it('every page kind has a spec, its own session key, and only Understand runs the analyze workflow', () => {
    for (const k of PAGE_CHAT_KINDS) {
      expect(PAGE_CHAT_SPECS[k].title).not.toBe('');
      expect(pageChatSessionKey(k)).toBe(`wicked.pagechat.${k}.session`);
    }
    expect(PAGE_CHAT_KINDS.filter((k) => PAGE_CHAT_SPECS[k].workflow !== undefined)).toEqual(['understand']);
    expect(new Set(PAGE_CHAT_KINDS.map(pageChatSessionKey)).size).toBe(PAGE_CHAT_KINDS.length);
  });

  it('pageContext names the page-chat pages', () => {
    const at = (pathname: string): string => pageContext({ pathname, runs: [], projects: [], repos: [] }).kind;
    expect(at('/understand')).toBe('understand');
    expect(at('/report')).toBe('report');
    expect(at('/testing/evals')).toBe('evaluate');
    expect(at('/memory')).toBe('memory');
    expect(at('/learn')).toBe('learn');
    expect(at('/watch')).toBe('nerve');
  });

  it('"What next?" is a choose ask with one recommended option, never a button row', () => {
    for (const kind of PAGE_CHAT_KINDS) {
      const ask = nextAsk({ kind, focus: null }, 1);
      expect(ask.kind).toBe('choose');
      expect(ask.host).toBe('chat');
      expect(ask.prompt).toBe('What next?');
      expect(ask.options!.filter((o) => o.recommended === true)).toHaveLength(1);
      // Every option says what happens if chosen.
      for (const o of ask.options!) expect(o.consequence).toBeTruthy();
      expect(ask.options!.some((o) => o.id === 'none')).toBe(true);
    }
    expect(nextAsk({ kind: 'report', focus: null }, 2).id).not.toBe(nextAsk({ kind: 'report', focus: null }, 3).id);
  });

  it('each page offers its own moves', () => {
    const ids = (ctx: Parameters<typeof nextOptions>[0]): string[] => nextOptions(ctx).map((o) => o.id);
    expect(ids({ kind: 'nerve', focus: null })).toEqual(['follow-up', 'recheck', 'agents', 'none']);
    expect(ids({ kind: 'report', focus: null })).toContain('jobs');
    expect(ids({ kind: 'understand', focus: null, repo: 'acme/api' })).toContain('graph');
    expect(nextOptions({ kind: 'understand', focus: null, repo: 'acme/api' }).find((o) => o.id === 'new-job')?.sub).toBe('in acme/api');
    // Evaluate: Draft rules only when the analysed run has gaps, and then it leads.
    expect(ids({ kind: 'evaluate', focus: null, gaps: 0 })).not.toContain('draft-rules');
    const withGaps = nextOptions({ kind: 'evaluate', focus: null, gaps: 6 });
    expect(withGaps[0]).toMatchObject({ id: 'draft-rules', recommended: true });
    expect(withGaps[0]!.consequence).toContain('6 uncovered behaviours');
    // Memory: "Choose what to keep" only when the answer named memories.
    expect(ids({ kind: 'memory', focus: null, remember: [] })).toEqual(['follow-up', 'none']);
    expect(ids({ kind: 'memory', focus: null, remember: ['a', 'b'] })[0]).toBe('remember');
  });

  it('reads "Remember:" lines off an answer, de-duplicated and capped', () => {
    const answer = [
      'I would remember two things from that.',
      'Remember: Releases cut on Thursdays; nothing merges after 15:00 that day.',
      '- **Remember:** Hotfixes skip the train but still need a second reviewer.',
      'remember: Releases cut on Thursdays; nothing merges after 15:00 that day.',
      'Not a memory: remember this',
    ].join('\n');
    expect(rememberLines(answer)).toEqual([
      'Releases cut on Thursdays; nothing merges after 15:00 that day.',
      'Hotfixes skip the train but still need a second reviewer.',
    ]);
    expect(rememberLines(Array.from({ length: 20 }, (_, i) => `Remember: fact ${i}`).join('\n'))).toHaveLength(12);
  });

  it('Memory\'s keep step is a pick-several with every line picked, recorded as kept', () => {
    const ask = rememberAsk(['one', 'two'], 4);
    expect(ask).toMatchObject({ kind: 'pick', default: ['m0', 'm1'], multi: { min: 1, max: 2 }, record: 'You kept: {labels}' });
    expect(ask.options!.map((o) => o.token)).toEqual(['one', 'two']);
    expect(pageChatRules('memory')).toContain('Remember: ');
    expect(pageChatRules('report')).not.toContain('Remember');
  });

  it('page text becomes pack lines: folded, de-duplicated, cut with the cut said', () => {
    expect(textLines('  35 \n jobs   finished\n\n jobs   finished\n', 100)).toEqual(['35', 'jobs finished']);
    const cut = textLines('aaaa\nbbbb\ncccc', 8);
    expect(cut).toEqual(['aaaa', '(cut at 8 characters)']);
  });

  it('the pack carries the page and the item asked about; the typed words split back off', () => {
    const chips = [{ key: 'page', kind: 'page' as const, label: 'This page', on: true }];
    const pack = buildContextPack({
      pathname: '/report', runs: [], liveChatCount: 0, diagnostics: { kind: 'unsupported' }, chips, pageLabel: 'the Report',
      pageLines: ['Last 7 days', '35 jobs finished'], focus: { label: '68% passed first time · Last 7 days', lines: ['68%', 'of 177 checked steps'] }, now: 0,
    });
    expect(pack).toContain('what this page shows:\n  Last 7 days\n  35 jobs finished');
    expect(pack).toContain('the question is about: 68% passed first time · Last 7 days\n  68%\n  of 177 checked steps');
    // Page lines ride only with This page; the item rides whatever the chips say.
    const off = buildContextPack({ pathname: '/report', runs: [], liveChatCount: 0, diagnostics: { kind: 'unsupported' }, chips: [{ ...chips[0]!, on: false }], pageLines: ['secret page'], focus: { label: 'x', lines: ['y'] }, now: 0 });
    expect(off).not.toContain('secret page');
    expect(off).toContain('the question is about: x');
    const later = focusPack({ label: 'Throughput', lines: ['4 delivered'] }, 0);
    expect(splitAskContext(`Why so few?\n\n---\n${later}`)).toEqual({ typed: 'Why so few?', pack: later });
  });
});
