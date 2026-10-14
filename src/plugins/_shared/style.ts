/** Artifact theme controls shared by the framework-free editors. No host chrome or network access. */
export interface ThemeTokens {
  name: string;
  colors: { background: string; surface: string; primary: string; secondary: string; accent: string; text_primary: string; text_secondary: string; text_muted: string; border: string };
  fonts: { heading: string; body: string; mono: string };
}
export interface StyleContext {
  tokens(): ThemeTokens | null;
  apply(tokens: ThemeTokens): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** Verbatim colors/fonts from wicked-interactive's built-in theme JSON. */
export const THEMES: readonly (ThemeTokens & { display_name: string })[] = [
  { name: 'corporate-light', display_name: 'Corporate Light', colors: { background: '#FFFFFF', surface: '#F8FAFC', primary: '#1E3A5F', secondary: '#2563EB', accent: '#0891B2', text_primary: '#1E293B', text_secondary: '#64748B', text_muted: '#94A3B8', border: '#E2E8F0' }, fonts: { heading: 'Calibri', body: 'Calibri', mono: 'Consolas' } },
  { name: 'midnight-purple', display_name: 'Midnight Purple', colors: { background: '#0A0A0F', surface: '#13091D', primary: '#A100FF', secondary: '#6B2FA0', accent: '#F59E0B', text_primary: '#FFFFFF', text_secondary: '#A0A0B0', text_muted: '#6B6B80', border: '#2A2A3D' }, fonts: { heading: 'Calibri', body: 'Calibri', mono: 'Consolas' } },
  { name: 'warm-dark', display_name: 'Warm Dark', colors: { background: '#1A1A2E', surface: '#16213E', primary: '#FF6B6B', secondary: '#C44569', accent: '#FFD93D', text_primary: '#F8F8F2', text_secondary: '#B0B0C0', text_muted: '#6B6B80', border: '#2D2D44' }, fonts: { heading: 'Calibri', body: 'Calibri', mono: 'Consolas' } },
];
export const FONTS = ['Inter', 'Roboto', 'Source Sans 3', 'IBM Plex Sans', 'Calibri', 'Georgia', 'system-ui'] as const;
const COLORS = [['background', 'Background'], ['surface', 'Surface'], ['primary', 'Primary'], ['accent', 'Accent'], ['text_primary', 'Text']] as const;
export const copyTokens = (t: ThemeTokens): ThemeTokens => ({ name: t.name, colors: { ...t.colors }, fonts: { ...t.fonts } });

export function mountStyle(root: HTMLElement, ctx: StyleContext): { refresh(): void } {
  root.replaceChildren();
  root.classList.add('plugin-style');
  const css = document.createElement('style');
  css.textContent = `.plugin-style{padding:16px;box-sizing:border-box;color:var(--ink-high);background:var(--surface-base);font:13px var(--font-sans,system-ui)}
.plugin-style h2{font-size:16px;margin:0 0 12px}.plugin-style .theme-cards{display:grid;gap:8px;margin-bottom:18px}
.plugin-style button,.plugin-style input,.plugin-style select{font:inherit;color:var(--ink-high);background:var(--surface-card);border:1px solid var(--border);border-radius:4px}
.plugin-style button{padding:8px;text-align:left;cursor:pointer}.plugin-style button:focus-visible,.plugin-style input:focus-visible,.plugin-style select:focus-visible{outline:2px solid var(--accent)}
.plugin-style .swatches{display:flex;height:16px;margin-bottom:6px;border:1px solid var(--border)}.plugin-style .swatches span{flex:1}
.plugin-style label{display:flex;align-items:center;gap:8px;margin:10px 0}.plugin-style label>span:first-child{flex:1}.plugin-style input[type=color]{width:36px;height:30px;padding:2px}.plugin-style input[type=text]{width:80px;padding:5px}.plugin-style select{max-width:170px;padding:5px}
.plugin-style p{line-height:1.5;color:var(--ink-body)}.plugin-style [role=status]{min-height:1.5em}.plugin-style :disabled{opacity:.6;cursor:default}`;
  root.append(css);
  const title = document.createElement('h2'); title.textContent = 'Style'; root.append(title);
  const cards = document.createElement('div'); cards.className = 'theme-cards'; root.append(cards);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  let busy = false;
  const controls: (HTMLButtonElement | HTMLInputElement | HTMLSelectElement)[] = [];
  const current = (): ThemeTokens => copyTokens(ctx.tokens() ?? THEMES[0]!);
  const colors: { key: keyof ThemeTokens['colors']; picker: HTMLInputElement; hex: HTMLInputElement }[] = [];
  const fonts: { key: 'heading' | 'body'; select: HTMLSelectElement }[] = [];
  const refresh = (): void => {
    const t = current();
    for (const { key, picker, hex } of colors) {
      hex.value = t.colors[key];
      picker.value = /^#[0-9a-f]{6}$/i.test(t.colors[key]) ? t.colors[key] : '#000000';
    }
    for (const { key, select } of fonts) select.value = FONTS.includes(t.fonts[key] as typeof FONTS[number]) ? t.fonts[key] : 'system-ui';
    for (const b of Array.from(cards.querySelectorAll('button'))) b.setAttribute('aria-pressed', String(b.dataset['theme'] === t.name));
  };
  const apply = async (tokens: ThemeTokens): Promise<void> => {
    if (busy) return;
    busy = true; controls.forEach((c) => { c.disabled = true; }); status.textContent = 'Applying theme…';
    try {
      const result = await ctx.apply(tokens);
      status.textContent = result.ok ? 'Theme applied.' : `Theme was not applied: ${result.reason}`;
    } catch (e) { status.textContent = `Theme was not applied: ${e instanceof Error ? e.message : 'unavailable'}`; }
    finally { busy = false; controls.forEach((c) => { c.disabled = false; }); refresh(); }
  };
  for (const theme of THEMES) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset['theme'] = theme.name;
    const swatches = document.createElement('span'); swatches.className = 'swatches'; swatches.setAttribute('aria-hidden', 'true');
    for (const key of ['background', 'surface', 'primary', 'secondary', 'accent'] as const) {
      const swatch = document.createElement('span'); swatch.style.backgroundColor = theme.colors[key]; swatches.append(swatch);
    }
    const name = document.createElement('span'); name.textContent = theme.display_name; b.append(swatches, name);
    b.addEventListener('click', () => { void apply(copyTokens(theme)); }); cards.append(b); controls.push(b);
  }
  for (const [key, text] of COLORS) {
    const label = document.createElement('label'); const name = document.createElement('span'); name.textContent = text;
    const picker = document.createElement('input'); picker.type = 'color'; picker.setAttribute('aria-label', text);
    const hex = document.createElement('input'); hex.type = 'text'; hex.maxLength = 7; hex.setAttribute('aria-label', `${text} hex`);
    const change = (value: string): void => {
      if (!/^#[0-9a-f]{6}$/i.test(value)) { status.textContent = 'Enter a six-digit hex colour, such as #2563EB.'; refresh(); return; }
      const t = current(); t.name = 'custom'; t.colors[key] = value; void apply(t);
    };
    picker.addEventListener('change', () => change(picker.value)); hex.addEventListener('change', () => change(hex.value));
    label.append(name, picker, hex); root.append(label); controls.push(picker, hex); colors.push({ key, picker, hex });
  }
  for (const key of ['heading', 'body'] as const) {
    const label = document.createElement('label'); const name = document.createElement('span'); name.textContent = key === 'heading' ? 'Heading font' : 'Body font';
    const select = document.createElement('select'); select.setAttribute('aria-label', name.textContent);
    for (const font of FONTS) { const option = document.createElement('option'); option.value = font; option.textContent = font; select.append(option); }
    select.addEventListener('change', () => { const t = current(); t.name = 'custom'; t.fonts[key] = select.value; void apply(t); });
    label.append(name, select); root.append(label); controls.push(select); fonts.push({ key, select });
  }
  const match = document.createElement('p'); match.textContent = "Match a website or a PDF: the host's Match button under this tab";
  root.append(match, status); refresh();
  return { refresh };
}

/**
 * The theme a document wears, read from its own `--wi-*` declarations (interactive's theme variables), so the Style
 * panel starts from the artifact's real theme, not a preset (codex h4-r1). Null when the document declares none.
 */
export function tokensFromHtml(content: string): ThemeTokens | null {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const css = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
  const values = new Map<string, string>();
  for (const m of css.matchAll(/(--wi-[a-z-]+)\s*:\s*([^;}{]+)/gi)) values.set(m[1]!.toLowerCase(), m[2]!.trim());
  if (values.size === 0) return null;
  const t = copyTokens(THEMES[0]!);
  const colors = { background: '--wi-bg', surface: '--wi-surface', primary: '--wi-primary', secondary: '--wi-secondary', accent: '--wi-accent', text_primary: '--wi-text', text_secondary: '--wi-text-secondary', text_muted: '--wi-muted', border: '--wi-border' } as const;
  for (const key of Object.keys(colors) as (keyof typeof colors)[]) {
    const value = values.get(colors[key]);
    if (value !== undefined && /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([0-9.,%\s]+\))$/i.test(value)) t.colors[key] = value;
  }
  for (const key of ['heading', 'body', 'mono'] as const) {
    const value = values.get(`--wi-font-${key}`);
    if (value !== undefined) t.fonts[key] = value.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
  }
  // A named preset when the readback has its tokens exactly.
  const match = THEMES.find((theme) => JSON.stringify(theme.colors) === JSON.stringify(t.colors) && JSON.stringify(theme.fonts) === JSON.stringify(t.fonts));
  t.name = match?.name ?? 'custom';
  return t;
}
