#!/usr/bin/env python3
"""Print the CHANGELOG.md section body for a given version.

Usage: changelog-section.py <version>   (accepts "0.16.6" or "v0.16.6")

Emits the body of the matching `## [X.Y.Z] — …` section with the heading and the
trailing `[X.Y.Z]: https://…` link-reference lines stripped, so it can be piped
straight into `gh release create --notes-file`.

Exit codes are meaningful so a caller can tell "no section" from a real failure:
  0 — section found (body written to stdout)
  1 — no section for this version (nothing written; caller may fall back to a generic note)
  2 — a real error (bad usage, CHANGELOG.md missing/unreadable) — caller should FAIL, not fall back

Resolves CHANGELOG.md from the current directory first, then relative to this
script (repo-root/scripts/..), so it works both in CI (run from the repo root) and
locally from any directory. Stdlib-only and cross-platform.
"""

import os
import re
import sys


def _changelog_path() -> str:
    """CHANGELOG.md in the CWD if present, else next to the repo root above scripts/."""
    if os.path.exists("CHANGELOG.md"):
        return "CHANGELOG.md"
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "CHANGELOG.md"))


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: changelog-section.py <version>\n")
        return 2
    arg = sys.argv[1]
    ver = arg.lstrip("v")
    try:
        txt = open(_changelog_path(), encoding="utf-8").read()
    except OSError as e:
        sys.stderr.write(f"cannot read CHANGELOG.md: {e}\n")
        return 2
    heads = list(re.finditer(r"^## \[(\d+\.\d+\.\d+)\][^\n]*$", txt, re.M))
    for i, h in enumerate(heads):
        if h.group(1) == ver:
            start = h.end()
            end = heads[i + 1].start() if i + 1 < len(heads) else len(txt)
            body = txt[start:end].strip()
            body = re.sub(r"(?m)^\[[^\]]+\]:\s*https?://\S+$", "", body).strip()
            # An empty section still counts as found; echo the arg verbatim (keeping any
            # leading "v") so the note stays consistent with the tag/title the caller uses.
            sys.stdout.write(body if body else f"Release {arg}\n")
            return 0
    return 1  # no section → caller falls back to a generic note


if __name__ == "__main__":
    raise SystemExit(main())
