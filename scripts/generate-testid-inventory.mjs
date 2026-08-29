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

import { collectTestidInventory } from './testid-inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = collectTestidInventory(root);
const out = resolve(root, 'testid-inventory.json');
writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
console.log(
  `wrote ${out}: ${inventory.counts.static} static · ${inventory.counts.dynamic} dynamic · ` +
    `${inventory.counts.computed} computed testids across ${inventory.counts.files} files ` +
    `(${inventory.counts.occurrences} declaration sites, wicked-studio ${inventory.studioVersion})`,
);
