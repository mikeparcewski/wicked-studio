// prepare-dist.mjs — the `prepare` lifecycle hook.
//
// Why it exists: wicked-crew consumes this package as a DIST ARTIFACT (its
// `build:with-studio` copies our `dist/` into the daemon's serving tree). When
// the dependency is resolved from git (the interim consumable while the npm
// name is being provisioned), npm clones the repo, installs devDependencies,
// and runs `prepare` before packing — this script is what makes that packed
// tarball actually contain `dist/`.
//
// Why it is guarded rather than `npm run build` directly: `prepare` ALSO runs
// on every plain local `npm install`. Rebuilding the whole SPA on each install
// would tax the dev loop for nothing, so we build only when `dist/index.html`
// is absent (the git-clone / fresh-checkout case). A developer who wants a
// fresh bundle runs `npm run build`; a publisher runs `npm run build` first
// (see README release notes). Cross-platform: pure Node, no shell built-ins.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = resolve(root, 'dist', 'index.html');

if (process.env.WICKED_STUDIO_SKIP_PREPARE === '1') {
  // CI sets this: it runs an explicit `npm run build` step right after install,
  // so the prepare-time build would only double the work.
  console.log('[prepare-dist] WICKED_STUDIO_SKIP_PREPARE=1 — skipping');
  process.exit(0);
}

if (existsSync(marker) && process.env.WICKED_STUDIO_FORCE_BUILD !== '1') {
  console.log('[prepare-dist] dist/ already present — skipping build (set WICKED_STUDIO_FORCE_BUILD=1 to force)');
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log('[prepare-dist] no dist/ found — building (tsc && vite build)…');
execFileSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
