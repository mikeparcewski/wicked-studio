#!/usr/bin/env python3
"""studio-B: one bounded foreground wait for the host's 1-min load to drop under a threshold.
   sb-wait-load.py [threshold=80] [max_seconds=75]  -> exit 0 when under, 3 when the time box expired."""
import os, sys, time
thr = float(sys.argv[1]) if len(sys.argv) > 1 else 80.0
box = float(sys.argv[2]) if len(sys.argv) > 2 else 75.0
t0 = time.time()
while True:
    l1 = os.getloadavg()[0]
    print(f"{time.strftime('%H:%M:%S')} load1={l1:.1f} (gate {thr:.0f}) waited={time.time()-t0:.0f}s", flush=True)
    if l1 < thr:
        sys.exit(0)
    if time.time() - t0 >= box:
        sys.exit(3)
    time.sleep(15)
