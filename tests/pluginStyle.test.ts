import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyTokens, FONTS, mountStyle, THEMES, type ThemeTokens } from '../src/plugins/_shared/style.js';

let root: HTMLDivElement;
let tokens: ThemeTokens | null;
const key = vi.fn<(key: string) => void>();
const apply = vi.fn(async (next: ThemeTokens): Promise<{ ok: true } | { ok: false; reason: string }> => { tokens = next; return { ok: true }; });
beforeEach(() => {
  root = document.createElement('div'); document.body.replaceChildren(root);
  tokens = copyTokens(THEMES[0]!); apply.mockClear(); key.mockClear();
  mountStyle(root, { tokens: () => tokens, apply, key });
});
const change = (node: HTMLInputElement | HTMLSelectElement, value: string): void => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
const field = (label: string): HTMLInputElement => root.querySelector(`input[aria-label="${label}"]`)!;

describe('shared artifact Style panel', () => {
  it('forwards host chords from buttons, inputs and selects while preserving native keys', () => {
    for (const control of [root.querySelector('button')!, field('Accent hex'), root.querySelector('select')!]) {
      for (const [init, forwarded] of [
        [{ key: 'Escape' }, 'Escape'], [{ key: 'k', ctrlKey: true }, 'Mod+K'],
        [{ key: 'k', metaKey: true }, 'Mod+K'], [{ key: 's', code: 'KeyS', altKey: true }, 'Alt+S'],
      ] as const) {
        const e = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
        control.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true); expect(key).toHaveBeenLastCalledWith(forwarded);
      }
      for (const native of ['a', 'ArrowDown', 'Enter', ' ']) {
        const before = key.mock.calls.length;
        const e = new KeyboardEvent('keydown', { key: native, bubbles: true, cancelable: true });
        control.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false); expect(key).toHaveBeenCalledTimes(before);
      }
    }
  });
  it('forwards Tab only at the first and last enabled controls', () => {
    const controls = Array.from(root.querySelectorAll<HTMLElement>('button, input, select'));
    const press = (at: number, shiftKey: boolean): KeyboardEvent => {
      controls[at]!.focus();
      const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      controls[at]!.dispatchEvent(e); return e;
    };
    expect(press(0, true).defaultPrevented).toBe(true); expect(key).toHaveBeenLastCalledWith('Shift+Tab');
    expect(press(controls.length - 1, false).defaultPrevented).toBe(true); expect(key).toHaveBeenLastCalledWith('Tab');
    key.mockClear();
    expect(press(0, false).defaultPrevented).toBe(false); expect(press(1, true).defaultPrevented).toBe(false);
    expect(key).not.toHaveBeenCalled();
  });
  it('shows the three built-in themes with swatches and applies exact tokens in one call', async () => {
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-theme]'));
    expect(cards.map((b) => b.textContent)).toEqual(['Corporate Light', 'Midnight Purple', 'Warm Dark']);
    expect(cards.map((b) => b.querySelectorAll('.ps-swatches span').length)).toEqual([5, 5, 5]);
    for (const [i, card] of cards.entries()) {
      card.click();
      await vi.waitFor(() => expect(root.querySelector('[role=status]')?.textContent).toBe('Theme applied.'));
      expect(apply).toHaveBeenCalledTimes(i + 1);
      expect(apply.mock.calls[i]![0]).toEqual(copyTokens(THEMES[i]!));
      expect(apply.mock.calls[i]![0]).not.toHaveProperty('display_name');
    }
    expect(THEMES[1]!.colors.primary).toBe('#A100FF');
    expect(THEMES[2]!.fonts).toEqual({ heading: 'Calibri', body: 'Calibri', mono: 'Consolas' });
  });
  it('offers five colour rows and changes one colour while preserving all other tokens', async () => {
    expect(root.querySelectorAll('input[type=color]')).toHaveLength(5);
    change(field('Accent'), '#123456');
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0]![0]).toEqual({ ...copyTokens(THEMES[0]!), name: 'custom', colors: { ...THEMES[0]!.colors, accent: '#123456' } });
    expect(field('Accent hex').value).toBe('#123456');
    expect(THEMES[0]!.colors.accent).toBe('#0891B2');
  });
  it('applies hex text on change and rejects invalid hex without a write', async () => {
    change(field('Background hex'), '#abcdef');
    await vi.waitFor(() => expect(root.querySelector('[role=status]')?.textContent).toBe('Theme applied.'));
    expect(apply.mock.calls[0]![0].colors.background).toBe('#abcdef');
    change(field('Background hex'), 'bad');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[role=status]')?.textContent).toContain('six-digit hex');
  });
  it('has closed heading/body font lists and preserves colours and mono on a font edit', async () => {
    const selects = Array.from(root.querySelectorAll('select'));
    expect(selects).toHaveLength(2);
    for (const s of selects) expect(Array.from(s.options).map((o) => o.value)).toEqual(FONTS);
    change(selects[0]!, 'Georgia');
    await vi.waitFor(() => expect(root.querySelector('[role=status]')?.textContent).toBe('Theme applied.'));
    expect(apply.mock.calls[0]![0]).toEqual({ ...copyTokens(THEMES[0]!), name: 'custom', fonts: { ...THEMES[0]!.fonts, heading: 'Georgia' } });
  });
  it('displays failures as text, including markup-looking host messages', async () => {
    const fail = vi.fn(async () => ({ ok: false as const, reason: '<img src=x onerror=alert(1)>' }));
    mountStyle(root, { tokens: () => null, apply: fail });
    root.querySelector('button')!.click();
    await vi.waitFor(() => expect(root.querySelector('[role=status]')?.textContent).toContain('<img'));
    expect(root.querySelector('img')).toBeNull();
  });
  it('shows thrown errors and restores the controls', async () => {
    mountStyle(root, { tokens: () => tokens, apply: async () => { throw new Error('Host unavailable'); } });
    root.querySelector('button')!.click();
    await vi.waitFor(() => expect(root.querySelector('[role=status]')?.textContent).toContain('Host unavailable'));
    expect(root.querySelector('button')!.disabled).toBe(false);
  });
  it('keeps pending edits serialized and refreshes from the current theme', async () => {
    let finish!: (r: { ok: true }) => void;
    const delayed = vi.fn(() => new Promise<{ ok: true }>((r) => { finish = r; }));
    const panel = mountStyle(root, { tokens: () => tokens, apply: delayed });
    root.querySelector('button')!.click(); root.querySelectorAll('button')[1]!.click();
    expect(delayed).toHaveBeenCalledTimes(1);
    expect(Array.from(root.querySelectorAll('input')).every((i) => i.disabled)).toBe(true);
    tokens = copyTokens(THEMES[2]!); finish({ ok: true });
    await vi.waitFor(() => expect(field('Primary hex').value).toBe('#FF6B6B'));
    tokens.colors.primary = '#123456'; panel.refresh();
    expect(field('Primary hex').value).toBe('#123456');
  });
  it('points to the host Match button without drawing one and uses host chrome variables', () => {
    expect(root.textContent).toContain("Match a website or a PDF: the host's Match button under this tab");
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Match')).toBe(false);
    expect(root.querySelector('style')!.textContent).toContain('var(--ink-high)');
    expect(root.querySelector('style')!.textContent).toContain('var(--surface-base)');
  });
});
