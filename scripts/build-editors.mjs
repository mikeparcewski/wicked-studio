// build-editors.mjs — the first-party editor plugins, as crew's registry reads them (EP-P2;
// DES-EDITOR-PLUGINS-001 §5.2, §8.6; crew `packages/crew/src/editors/registry.ts`).
//
//   node scripts/build-editors.mjs [outDir=dist]
//
// For each plugin under src/plugins/<id>/ (a `plugin.ts` entry and a `template.html`), bundles the
// entry with Vite's library build (IIFE, every import inlined — no module loads, nothing fetched),
// inlines the script into the template, and writes ONE self-contained `<outDir>/editors/<id>/index.html`
// beside its `editor.json` manifest. Crew discovers `<studio dist>/editors/<id>/editor.json` at boot,
// pins the entry's sha256 and serves it through the hashed bundle route with the §8.2 policy; the
// manifest's `version` is studio's own, so a studio release re-pins the hash and its grants.
//
// `vite.config.ts` runs this at the end of every `vite build` (so dist-sameorigin gets it too); the
// unit test (tests/editorBundles.test.ts) builds into a temp dir and checks the file is one file.
//
// Cross-platform: pure Node, no shell built-ins.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The first-party editors studio ships. Ids are `wicked-*` (crew refuses anything else from a studio bundle). */
export const EDITORS = [
  {
    id: 'wicked-page',
    // The operator's name for it (2026-10-12): the editor of an interactive document, plainly.
    title: 'Document',
    protocol: [1, 2],
    kinds: ['page'],
    sizes: ['inline', 'pane', 'full'],
    permissions: [
      { id: 'artifact.read', why: 'to show the page and read its words' },
      { id: 'artifact.write', why: 'to land what you type on an element as one version, with Undo' },
      { id: 'selection.chip', why: 'to make the element you click the subject of your next message' },
      { id: 'network.media', why: 'to show the page’s web images and fonts' },
      { id: 'artifact.theme', why: 'to change the page’s theme, colours and fonts from its Style tab, as one version with Undo' },
      { id: 'ui.fullscreen', why: 'to show the page full screen' },
    ],
  },
  {
    // DES-PRESENTATION-EDITOR-001 P-D1 (operator decision D1: its own plugin, not a layout of the page editor).
    id: 'wicked-deck',
    title: 'Slides',
    protocol: [1, 2],
    kinds: ['deck'],
    sizes: ['inline', 'pane', 'full'],
    permissions: [
      { id: 'artifact.read', why: 'to show the slides and read their words and speaker notes' },
      { id: 'artifact.write', why: 'to add, duplicate, move or delete a slide, change its words or its notes, each as one version with Undo' },
      { id: 'selection.chip', why: 'to make the slide or the line you click the subject of your next message' },
      { id: 'ui.fullscreen', why: 'to present the deck full screen' },
      { id: 'artifact.export', why: 'to offer the deck as PowerPoint or PDF from its card (the host makes the file)' },
      { id: 'artifact.theme', why: 'to change the deck’s theme, colours and fonts from its Style tab, as one version with Undo' },
    ],
  },
];

/** A protocol-2 plugin's surfaces declaration, `src/plugins/<id>/surfaces.json`. */
export function surfacesOf(id) {
  return JSON.parse(readFileSync(join(root, 'src', 'plugins', id, 'surfaces.json'), 'utf8'));
}

/** Nothing in the entry may load from outside it (crew's `externalReferences` check; the CSP would block it anyway). */
export function externalReferences(html) {
  const out = [];
  for (const m of html.matchAll(/<(script|link|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/giu)) {
    const tag = m[1].toLowerCase();
    const url = m[2].trim();
    if (tag === 'link' && !/\brel\s*=\s*["']?stylesheet/iu.test(m[0])) continue;
    if (/^(?:https?:)?\/\//iu.test(url) || (/^[a-z][a-z0-9+.-]*:/iu.test(url) && !/^(?:data|blob|about):/iu.test(url))) out.push(`${tag} ${url}`);
  }
  return out;
}

/** Bundle one plugin's entry to a single IIFE script (Vite's library build, in memory). */
async function bundleScript(entry) {
  const { build } = await import('vite');
  const out = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      target: 'es2020',
      lib: { entry, formats: ['iife'], name: 'wickedEditor', fileName: () => 'plugin.js' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
  const code = chunks.filter((c) => c.type === 'chunk').map((c) => c.code).join('\n');
  if (code === '' || chunks.some((c) => c.type === 'asset' && /\.css$/.test(c.fileName))) throw new Error(`build-editors: ${entry} did not bundle to one script`);
  // The script is inlined: a close-script sequence inside it would end the tag early.
  return code.replace(/<\/script/giu, '<\\/script');
}

/** Build every first-party editor into `<outDir>/editors/<id>/`. Returns what was written. */
export async function buildEditors(outDir, { version } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const v = version ?? pkg.version;
  const written = [];
  for (const e of EDITORS) {
    const dir = join(root, 'src', 'plugins', e.id);
    const script = await bundleScript(join(dir, 'plugin.ts'));
    const html = readFileSync(join(dir, 'template.html'), 'utf8').replace('__VERSION__', v).replace('__PLUGIN__', () => script);
    const outside = externalReferences(html);
    if (outside.length > 0) throw new Error(`build-editors: ${e.id} loads from outside itself: ${outside.join(', ')}`);
    const target = join(outDir, 'editors', e.id);
    mkdirSync(target, { recursive: true });
    // Protocol 2 (DES-EDITOR-PLUGIN-CONTRACT-001 §5.1): the surfaces live in the plugin's own `surfaces.json`, which
    // its `plugin.ts` imports for `plugin.ready` too, so the manifest and the bundle can't disagree.
    const surfaces = e.protocol.includes(2) ? surfacesOf(e.id) : undefined;
    const manifest = { id: e.id, title: e.title, version: v, protocol: e.protocol, kinds: e.kinds, entry: 'index.html', sizes: e.sizes, permissions: e.permissions, ...(surfaces !== undefined ? { surfaces } : {}) };
    writeFileSync(join(target, 'index.html'), html, 'utf8');
    writeFileSync(join(target, 'editor.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    written.push({ id: e.id, version: v, bytes: Buffer.byteLength(html, 'utf8'), sha256: createHash('sha256').update(html, 'utf8').digest('hex'), dir: target });
  }
  return written;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outDir = resolve(process.argv[2] ?? join(root, 'dist'));
  const written = await buildEditors(outDir);
  for (const w of written) console.log(`built ${w.id}@${w.version}: ${w.bytes} bytes, sha256 ${w.sha256.slice(0, 12)}… → ${w.dir}`);
}
