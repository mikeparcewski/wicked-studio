/**
 * DES-STUDIO-REBUILD-001 §5.6: every global letter chord is ⌥+letter, matched on `code`.
 * `chordKey('j')` builds the keydown init a real ⌥J sends (macOS reports a mangled `key`,
 * so the test sends one too: the registry must match on `code`, never on `key`). Named
 * keys (Escape, Enter, arrows) pass through bare.
 */
export function chordKey(key: string): KeyboardEventInit {
  if (/^[a-z]$/.test(key)) return { key: `⌥${key}`, code: `Key${key.toUpperCase()}`, altKey: true };
  return { key };
}
