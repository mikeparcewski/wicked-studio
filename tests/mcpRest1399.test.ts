/** studio#1399: the REST ask the MCP server workflow's intent carries (wicked-garden#1566's scaffold `--rest`). */
import { describe, expect, it } from 'vitest';
import { offersRestApi, REST_API_INTENT_LINE, withRestApi } from '../src/board/mcpRest.js';

describe('withRestApi', () => {
  it('off: the words exactly as given', () => {
    expect(withRestApi('Wrap the weather API  ', false)).toBe('Wrap the weather API  ');
  });
  it('on: the fixed line after the words, once', () => {
    const once = withRestApi('Wrap the weather API\n', true);
    expect(once).toBe(`Wrap the weather API\n\n${REST_API_INTENT_LINE}`);
    expect(withRestApi(once, true)).toBe(once);
    expect(withRestApi('', true)).toBe(REST_API_INTENT_LINE);
  });
  it('on: a copy of the line already in the words (a pasted earlier intent) is taken out, and the line ends it once', () => {
    const pasted = `Wrap the weather API\n\n${REST_API_INTENT_LINE}\n\nAlso cache for 5 minutes. ${REST_API_INTENT_LINE}`;
    expect(withRestApi(pasted, true)).toBe(`Wrap the weather API\n\nAlso cache for 5 minutes.\n\n${REST_API_INTENT_LINE}`);
    // Off: the person's words are never touched, a pasted line included.
    expect(withRestApi(pasted, false)).toBe(pasted);
  });
  it('names the scaffold flag the garden skill keys on', () => {
    expect(REST_API_INTENT_LINE).toContain('REST API');
    expect(REST_API_INTENT_LINE).toContain('--rest');
  });
  it('only the mcp-server workflow offers it', () => {
    expect(offersRestApi('mcp-server')).toBe(true);
    expect(offersRestApi('bug')).toBe(false);
    expect(offersRestApi(null)).toBe(false);
  });
});
