"""The address a journey asserts on, now that Steering, Evals, Agents and Repositories are Desk tabs.

`/rules/...`, `/steering/...`, `/testing/evals`, `/agents...` and `/repos...` redirect to
`/?tab=<tab>&at=<the old address>` (Desk v2, operator 2026-10-13), and the hosted page keeps
navigating by its own addresses. `ADDR` is a JS expression for the page's own address: the `at`
path when the Desk hosts it, else `location.pathname`.
"""

ADDR = ("(() => { const q = new URLSearchParams(location.search); const at = q.get('at');"
        " return (location.pathname === '/' || location.pathname.startsWith('/projects/')) && at ? at.split('?')[0] : location.pathname; })()")
