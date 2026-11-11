#!/usr/bin/env bash
# Install a Playwright browser without apt when the runner already has what it needs.
#
# usage: .github/scripts/pw-install.sh <node|python> <chromium|firefox|webkit> [--only-shell]
#
# `playwright install --with-deps` always runs apt-get, and when the runner's apt mirrors are unreachable
# (archive.ubuntu.com DNS failures, 2026-11-11) every job that needs a browser goes red although the browser would
# have run. This installs the browser alone and LAUNCHES it. Only when it cannot launch are the system packages
# installed (three tries), and then it must launch, or the step fails. A browser that cannot start never
# passes this step, and the tests after it still drive the real browser.
set -euo pipefail
kind=$1 browser=$2
shift 2
if [ "$kind" = node ]; then
  pw=(npx playwright)
  probe() {
    node -e '
      const name = process.argv[1];
      (async () => {
        let m; try { m = await import("playwright"); } catch { m = await import("@playwright/test"); }
        const b = await m[name].launch(); await b.close();
      })().catch((e) => { console.error(String(e && e.message || e).split("\n")[0]); process.exit(1); });
    ' "$browser"
  }
else
  pw=(python -m playwright)
  probe() {
    python -c $'import sys\nfrom playwright.sync_api import sync_playwright\nwith sync_playwright() as p:\n    getattr(p, sys.argv[1]).launch().close()' "$browser"
  }
fi
"${pw[@]}" install "$@" "$browser"
if probe; then
  echo "playwright: $browser launches without extra system packages"
  exit 0
fi
echo "::notice title=playwright::$browser needs system packages on this runner; installing them (apt)"
for i in 1 2 3; do
  "${pw[@]}" install-deps "$browser" && break
  [ "$i" = 3 ] && { echo "::error title=playwright::install-deps $browser failed 3 times"; exit 1; }
  echo "install-deps failed (try $i of 3); retrying in 30 s"; sleep 30
done
probe || { echo "::error title=playwright::$browser still does not launch after install-deps"; exit 1; }
