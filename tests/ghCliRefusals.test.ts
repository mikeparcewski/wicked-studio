import { describe, expect, it } from 'vitest';
import { ApiError, isGhCliRefusal, translateWireError } from '../src/api/errors.js';

/** crew's GitHub CLI login refusals (four 409s, one 400) read through translateWireError: plain words first, crew's sentence kept. */
describe('the GitHub CLI login refusals', () => {
  it.each([
    [409, 'gh_account_mismatch', 'isn’t the one the GitHub CLI is signed in as'],
    [409, 'gh_not_installed', 'isn’t installed'],
    [409, 'gh_signed_out', 'is signed out'],
    [409, 'gh_token_unavailable', 'couldn’t supply a login'],
    [400, 'gh_cli_not_allowed', 'can’t use the GitHub CLI login'],
  ])('%i %s: the typed status and code stay, the message is the translation', (status, code, words) => {
    const e = new ApiError(status, 'crew’s own sentence', { error: 'crew’s own sentence', code });
    expect(e.status).toBe(status);
    expect((e.body as { code: string }).code).toBe(code);
    expect(isGhCliRefusal(code)).toBe(true);
    expect(e.message).toContain(words);
    expect(e.message).toContain('Nothing was saved.');
    expect(e.wire).toBe('crew’s own sentence');
  });

  it('an unknown code, or none, keeps the generic translation', () => {
    expect(new ApiError(409, 'busy', { code: 'something_else' }).message).toBe('the daemon refused this — busy');
    expect(translateWireError(409, 'busy')).toBe('the daemon refused this — busy');
    expect(isGhCliRefusal('__proto__')).toBe(false);
    expect(isGhCliRefusal(null)).toBe(false);
  });
});
