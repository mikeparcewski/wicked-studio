/** The crew job's dock (rig b6f7968b, operator 2026-10-30): 29 change-only failures grouped by file, file paths never
 *  cut at the front ("S/delivery-assurance.test.ts"). */
import { describe, expect, it } from 'vitest';
import { failureName, groupByFile, testFile, testWords } from '../src/board/failingChecks.js';

describe('failing test names and files', () => {
  it('a whole vitest file that failed is its path, said as the path', () => {
    const id = 'FAIL tests/delivery-assurance.test.ts [ tests/delivery-assurance.test.ts ]';
    expect(failureName(id)).toBe('tests/delivery-assurance.test.ts');
    expect(testWords(failureName(id))).toBe('tests/delivery-assurance.test.ts');
    expect(testFile(id)).toBe('tests/delivery-assurance.test.ts');
  });
  it('the file of a vitest case, a pytest case and a Rust test', () => {
    expect(testFile('FAIL tests/bridge-reaper.test.ts > interactive bridge trees > shutdown reaps a tree')).toBe('tests/bridge-reaper.test.ts');
    expect(testFile('tests/a.py::test_runs')).toBe('tests/a.py');
    expect(testFile('test deliver_lift::tests::an_override_is_stood_on')).toBe('deliver_lift::tests');
    expect(testWords('tests/a.py::test_walkthrough_runs_in_a_jail')).toBe('Walkthrough runs in a jail');
  });
  it('groups by file, biggest first', () => {
    const g = groupByFile([
      'FAIL tests/a.test.ts > x > one', 'FAIL tests/b.test.ts > y > two', 'FAIL tests/a.test.ts > x > three',
      'FAIL tests/c.test.ts [ tests/c.test.ts ]',
    ]);
    expect(g.map((x) => `${x.file}:${x.tests.length}`)).toEqual(['tests/a.test.ts:2', 'tests/b.test.ts:1', 'tests/c.test.ts:1']);
  });
});

describe('the dock\'s grouped list', () => {
  it('29 failures: the first five under their files, then "and 24 more", which opens the rest', async () => {
    const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
    const { FailingGroups } = await import('../src/components/session/GateRow.js');
    const ids = Array.from({ length: 29 }, (_, i) => `FAIL tests/f${i % 4}.test.ts > suite > case ${i}`);
    render(<FailingGroups ids={ids} />);
    const tests = (): number => document.querySelectorAll('[data-testid="session-gate-failing-group"] li').length;
    expect(tests()).toBe(5);
    expect(screen.getAllByTestId('session-gate-failing-group')[0]!.dataset['file']).toBe('tests/f0.test.ts');
    expect(screen.getByTestId('session-gate-failing-more').textContent).toBe('and 24 more');
    fireEvent.click(screen.getByTestId('session-gate-failing-more'));
    expect(tests()).toBe(29);
    cleanup();
  });
});
