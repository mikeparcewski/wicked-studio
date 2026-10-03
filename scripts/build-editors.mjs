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
    title: 'Page editor',
    protocol: [1],
    kinds: ['page'],
    sizes: ['inline', 'pane', 'full'],
    permissions: [
      { id: 'artifact.read', why: 'to show the page and read its words' },
      { id: 'artifact.write', why: 'to land what you type on an element as one version, with Undo' },
      { id: 'selection.chip', why: 'to make the element you click the subject of your next message' },
      { id: 'network.media', why: 'to show the page’s web images and fonts' },
    ],
  },
];

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
    const manifest = { id: e.id, title: e.title, version: v, protocol: e.protocol, kinds: e.kinds, entry: 'index.html', sizes: e.sizes, permissions: e.permissions };
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
