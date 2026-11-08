// generate-testid-inventory.mjs — regenerate the committed data-testid contract (TH-13).
//
//   npm run manifest:testids
//
// Scans src/ declaration sites (scripts/testid-inventory.mjs — the same scanner the drift
// test runs) and rewrites `testid-inventory.json` at the repo root. The file is COMMITTED:
// tests/testidInventory.test.ts fails on any drift between it and src/, so a testid change
// fails CI until this script is re-run and the inventory diff is reviewed alongside the UI
// change. The build then emits the committed file into dist/testid-inventory.json so
// consumers verify against the dist actually served.
//
// Cross-platform: pure Node, no shell built-ins.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectTestidScan, withCounts } from './testid-inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scan = collectTestidScan(root);
const out = resolve(root, 'testid-inventory.json');
// The committed file carries no aggregates (they made every open branch conflict); the log computes them.
writeFileSync(out, `${JSON.stringify(scan.inventory, null, 2)}\n`, 'utf8');
const { counts } = withCounts(scan.inventory, scan);
console.log(
  `wrote ${out}: ${counts.static} static · ${counts.dynamic} dynamic · ` +
    `${counts.computed} computed testids across ${counts.files} files ` +
    `(${counts.occurrences} declaration sites, wicked-studio ${scan.inventory.studioVersion})`,
);
