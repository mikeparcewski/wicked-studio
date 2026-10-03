#!/usr/bin/env python3
"""studio-B: one bounded foreground wait for a codex log to hold its verdict.
   sb-wait-codex.py <log> [max_seconds=75] -> exit 0 when 'tokens used' is in the log, 3 when the box expired."""
import os, sys, time
log, box = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 75.0
t0 = time.time()
while True:
    try:
        t = open(log, errors="replace").read()
    except OSError:
        t = ""
    done = "tokens used" in t
    print(f"{time.strftime('%H:%M:%S')} bytes={len(t)} done={done} waited={time.time()-t0:.0f}s", flush=True)
    if done:
        sys.exit(0)
    if time.time() - t0 >= box:
        sys.exit(3)
    time.sleep(15)
