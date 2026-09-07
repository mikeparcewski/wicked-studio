#!/usr/bin/env python3
"""Print the CHANGELOG.md section body for a given version.

Usage: changelog-section.py <version>   (accepts "0.4.14" or "v0.4.14")

Emits the body of the matching `## [X.Y.Z] — …` section with the heading and the
trailing `[X.Y.Z]: https://…` link-reference lines stripped, so it can be piped
straight into `gh release create --notes-file`. Exits 1 (no output) when the
version has no section, letting the release workflow fall back to a generic note.

Stdlib-only and cross-platform: the release workflow runs it on the runner, but it
is equally runnable locally to preview a version's release notes before a tag push.
"""

import re
import sys


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: changelog-section.py <version>\n")
        return 2
    ver = sys.argv[1].lstrip("v")
    try:
        txt = open("CHANGELOG.md", encoding="utf-8").read()
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
            sys.stdout.write(body if body else f"Release {ver}\n")
            return 0
    return 1  # no section → caller falls back to a generic note


if __name__ == "__main__":
    raise SystemExit(main())
