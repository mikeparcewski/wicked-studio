// Hand-written declarations for scripts/testid-inventory.mjs (imported by
// tests/testidInventory.test.ts; tsconfig only type-checks src/ + tests/).

export declare const INVENTORY_VERSION: number;
export declare const INVENTORY_DOC: string[];

export interface TestidEntry {
  files: string[];
  testId?: string;
  pattern?: string;
  expression?: string;
}

export interface TestidCounts {
  files: number;
  occurrences: number;
  static: number;
  dynamic: number;
  computed: number;
}

/** The committed shape: per-entry rows only, no aggregates (they are computed on read: {@link withCounts}). */
export interface TestidInventory {
  $doc: string[];
  version: number;
  studioVersion: string;
  static: Array<{ testId: string; files: string[] }>;
  dynamic: Array<{ pattern: string; files: string[] }>;
  computed: Array<{ expression: string; files: string[] }>;
}

export declare function scanFileText(text: string): {
  occurrences: number;
  entries: Array<{ kind: 'static' | 'dynamic' | 'computed'; value: string }>;
};

export declare function collectTestidInventory(rootDir: string): TestidInventory;

export declare function collectTestidScan(rootDir: string): { inventory: TestidInventory; occurrences: number; files: number };

/** The dist shape: the committed inventory with `counts` computed on read. */
export declare function withCounts(
  inventory: TestidInventory,
  scan: { occurrences: number; files: number },
): TestidInventory & { counts: TestidCounts };
