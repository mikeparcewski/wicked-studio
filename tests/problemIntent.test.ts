import { describe, it, expect } from 'vitest';
import { intentOf } from '../src/board/problemIntent.js';

describe('intentOf (studio#1148)', () => {
  it('cuts at the first daemon block, whichever block comes first', () => {
    expect(intentOf('do it\n\n<!-- wicked-crew:learnings -->\nx\n<!-- /wicked-crew:learnings -->')).toBe('do it');
    expect(intentOf('do it  \n<!-- wicked-crew:rules -->\nR\n<!-- /wicked-crew:rules -->\n<!-- wicked-crew:linked-issues -->')).toBe('do it');
  });
  it('leaves an undecorated problem byte for byte', () => {
    expect(intentOf('  plain words \n')).toBe('  plain words \n');
  });
});
