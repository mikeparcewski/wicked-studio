import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDiagnostics } from '../api/diagnostics.js';
import { apiWire } from '../api/errors.js';
import {
  analyzeSkills,
  currentBaseline,
  getSkillsCatalog,
  isSkillsConflict,
  isSkillsUnavailable,
  isSkillsUnsupported,
  publishSkills,
  readSkillDeepLink,
  refreshSkillsBaseline,
  setSkillEnabled,
  skillCounts,
  skillRows,
  skillsPath,
  SKILLS_ENGINE_STATE_COPY,
  SKILLS_UNSUPPORTED_COPY,
  supportFiles,
  type DiagnosticsSkills,
  type SkillAnalyzeResult,
  type SkillGuardResult,
  type SkillMutationResult,
  type SkillRow,
  type SkillsCatalog,
} from '../api/skills.js';
import { KpiBand, KpiGroup, StatTile } from './dashboardKit.js';
import { SkillDrawer } from './SkillDrawer.js';
import { SkillFilesMapModal } from './SkillFilesMapModal.js';
import { SkillFindings } from './SkillFindings.js';
import { SkillsGrid, SKILLS_FACETS_DEFAULT, type SkillsFacets } from './SkillsGrid.js';
import type { SkillsWriter } from './skillsWriter.js';

/**
 * The Skills surface (`/skills`, the skills keystone) — a FILE MANAGER over the daemon's one
 * effective garden-shaped plugin root, the skills every governed worker runs (api-types 0.27.0,
 * crew#480):
 *
 *  - the KPI band (total · enabled · overridden · core · portable) over the manifest, each tile a
 *    door into the matching catalog filter — the Portable tile's context splits the rest by KIND of
 *    reason (`N not portable · M need Claude harness`, api-types 0.34.0 / F-079);
 *  - the CATALOG (SkillsGrid): one row per skill with kind / provenance / flags and the enabled
 *    switch — the one inline write, through the daemon's guards;
 *  - the DRAWER (SkillDrawer) a row opens: skill files + support files under tabs, the textarea
 *    editor (Save → PUT → findings), the baseline side, reset / replace. `?skill=<name>` is the
 *    drawer's address — selecting a row is a real navigation (deep-linkable, back-button-correct);
 *  - the page verbs: Add (a pasted files map), Refresh baseline (the three-way upgrade), Analyze
 *    (the publish validation as a pure dry run) and PUBLISH — validate the whole tree and write the
 *    immutable snapshot generation workers spawn with. Nothing here is live until published;
 *  - the ENGINE line (`GET /diagnostics` → `skills`, read-only): whether the engine is actually
 *    being handed a verified snapshot (`published`), or why not (`fallback` / `blocked` /
 *    `config-error` / `disabled`) — the one answer to "why do launches refuse the skills snapshot".
 *
 * CAS: the page holds the catalog `revision` (a number, bumped by every mutation); every write
 * goes through {@link SkillsWriter} (`expectedRevision` out, the answered `revision` adopted). A
 * **409** — exclusively a stale `expectedRevision` — freezes the page behind the reload prompt;
 * nothing else is written until the catalog is re-read (the Add/Replace modal re-reads through the
 * writer itself and keeps its files map for the retry). Every write also freezes the others while
 * it is in flight (they all share the one revision — overlapping writes could only 409), and a
 * catalog re-read that FAILS marks the page stale: the rows stay readable, every write waits until
 * a re-read succeeds. Each successful re-read bumps `catalogEpoch`, which the drawer reconciles its
 * open file against — a Refresh never advances the write revision past content the editor read
 * earlier.
 *
 * Every 2xx mutation answer is an envelope `{verdict, findings, revision}`: `blocked` = the daemon
 * refused and wrote nothing (a normal answer, rendered as the findings — never an exception);
 * `warnings` = it proceeded (a publish WROTE its snapshot) and the findings are worth reading.
 *
 * The honest non-catalog states: a daemon WITHOUT the `/skills` routes (bare 404) renders the
 * named unsupported state; a daemon whose route answers **503** — an unseeded root (no installed
 * plugin), a `current` that fails verification, no skills seam — renders the daemon's sentence as
 * the named UNAVAILABLE state. Never a crash and never an empty catalog pretending. Every write
 * goes through crew's API (the guarded operator path); nothing here touches the root directly.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'unsupported' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'failed'; message: string };

type PageVerb = 'refresh' | 'analyze' | 'publish';

const PAGE_VERB_LABEL: Record<PageVerb, string> = {
  refresh: 'Refresh baseline',
  analyze: 'Analyze',
  publish: 'Publish',
};

/** The engine line's color by `diagnostics.skills.state`. */
const ENGINE_STATE_COLOR: Record<DiagnosticsSkills['state'], string> = {
  published: 'var(--status-done)',
  fallback: 'var(--status-gate)',
  blocked: 'var(--status-fail)',
  'config-error': 'var(--status-fail)',
  disabled: 'var(--ink-dim)',
};

export function SkillsPage({ navigate, search = '' }: {
  navigate: (path: string) => void;
  /** The URL search string — `?skill=<name>` addresses one skill's drawer. */
  search?: string;
}): React.ReactElement {
  const [catalog, setCatalog] = useState<SkillsCatalog | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [facets, setFacets] = useState<SkillsFacets>(SKILLS_FACETS_DEFAULT);
  /** The skill with a write in flight from this page (a row toggle) — its switch waits. */
  const [busyName, setBusyName] = useState<string | null>(null);
  /** The page verb in flight — its button waits. */
  const [verbBusy, setVerbBusy] = useState<PageVerb | null>(null);
  /** The last page-level envelope worth reading (a toggle's warnings, a publish's findings). */
  const [pageResult, setPageResult] = useState<{ verb: string; result: SkillGuardResult } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /** A 409 — the catalog changed under this page. The daemon's sentence, for the prompt. */
  const [conflict, setConflict] = useState<string | null>(null);
  /** A catalog RE-READ failed after a successful load — the rows on screen may be behind the
   *  daemon, so every write waits until a re-read succeeds. The failure's sentence, for the banner. */
  const [stale, setStale] = useState<string | null>(null);
  /** Bumped on every SUCCESSFUL catalog read — the drawer re-reads its open file on each. */
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  /** Writes in flight through the CAS seam — while any is, every other write affordance waits. */
  const [inFlight, setInFlight] = useState(0);
  /** The revision every mutation is conditioned on — a ref so chained writes read the latest. */
  const revisionRef = useRef<number | null>(null);
  /** `GET /diagnostics` → `skills`: what the engine is being handed. `null` until read, or when
   *  this daemon's diagnostics predate the seam / could not be read (never blocks the page). */
  const [engine, setEngine] = useState<DiagnosticsSkills | null>(null);
  /** The open drawer has unsaved edits (it reports every flip). A row click on ANOTHER skill then
   *  parks its name in `pendingSelect` and the drawer asks first — its `key` swaps only after the
   *  operator discards, never under a draft (review round 2). */
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  /** The engine line is read-only telemetry beside the catalog: a failure (an older daemon, a
   *  transient error) leaves it blank — it never fails the page. */
  const loadEngine = useCallback(async (): Promise<void> => {
    try {
      const d = await getDiagnostics();
      setEngine(d.skills ?? null);
    } catch {
      setEngine(null);
    }
  }, []);

  const load = useCallback(async (): Promise<SkillsCatalog | null> => {
    try {
      const c = await getSkillsCatalog();
      revisionRef.current = c.revision;
      setCatalog(c);
      setStale(null);
      setState({ kind: 'loaded' });
      setCatalogEpoch((n) => n + 1);
      void loadEngine();
      return c;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (revisionRef.current !== null) {
        // A re-read after a successful load: keep the rows readable, mark them stale, freeze writes.
        setStale(isSkillsUnsupported(e) ? 'the daemon no longer serves the skills catalog' : message);
      } else if (isSkillsUnsupported(e)) {
        setState({ kind: 'unsupported' });
      } else if (isSkillsUnavailable(e)) {
        setState({ kind: 'unavailable', message: apiWire(e) ?? message });
        void loadEngine();
      } else {
        setState({ kind: 'failed', message });
      }
      return null;
    }
  }, [loadEngine]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The ONE CAS seam: expectedRevision out (the page's latest, or the revision the caller's
   *  content was read at), the answered revision adopted, a 409 → the prompt. */
  const run = useCallback<SkillsWriter['run']>(async (mutation, opts) => {
    const expected = opts?.expectedRevision ?? revisionRef.current;
    if (expected === null) throw new Error('the skills catalog has not loaded — nothing to write against');
    setInFlight((n) => n + 1);
    try {
      const result = await mutation(expected);
      revisionRef.current = result.revision;
      return result;
    } catch (e) {
      if (isSkillsConflict(e)) {
        setConflict(apiWire(e) ?? '');
        return null;
      }
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);
  /** After a 409: the prompt clears and the catalog is re-read. Also the writer's `reload` — the
   *  Add/Replace modal calls it with its files map intact and retries against the revision it adopts. */
  const reloadAfterConflict = useCallback(async (): Promise<void> => {
    setConflict(null);
    setPageResult(null);
    await load();
  }, [load]);
  const writer = useMemo<SkillsWriter>(
    () => ({ run, revision: () => revisionRef.current, reload: reloadAfterConflict }),
    [run, reloadAfterConflict],
  );

  const rows: SkillRow[] = useMemo(() => (catalog === null ? [] : skillRows(catalog.manifest)), [catalog]);
  const counts = skillCounts(rows);
  const unpublished = rows.filter((r) => r.unpublished).length;
  const support = useMemo(() => (catalog === null ? [] : supportFiles(catalog.manifest)), [catalog]);

  // The drawer's address: `?skill=<name>`. A name the manifest does not carry renders a note,
  // never a silent swap onto the bare catalog (the dead-address contract, review #4).
  const linked = readSkillDeepLink(search);
  const selected = linked === null ? null : rows.find((r) => r.name === linked) ?? null;
  const linkedMissing = linked !== null && catalog !== null && selected === null;
  const selectedName = selected?.name ?? null;

  // A parked selection belongs to the drawer it was asked from: when that drawer goes (a close, a
  // discard, a skill that left the catalog) the request goes with it — a later drawer never
  // inherits a stale "open X?" prompt.
  useEffect(() => {
    setPendingSelect(null);
  }, [selectedName]);

  /** A row click is a navigation to `?skill=<name>` — unless the open drawer is dirty and the click
   *  names another skill: then the drawer's discard confirmation asks first, and the navigation
   *  runs only when the operator answers `onLeave(true)`. */
  const selectSkill = (name: string): void => {
    if (selectedName !== null && name !== selectedName && drawerDirty) {
      setPendingSelect(name);
      return;
    }
    navigate(skillsPath(name));
  };

  const onLeave = (proceed: boolean): void => {
    const to = pendingSelect;
    setPendingSelect(null);
    if (proceed && to !== null) navigate(skillsPath(to));
  };

  /** The ONE guarded flip: the catalog reloaded on anything but `blocked`, the verdict handed back. */
  const toggle = useCallback(async (name: string, enabled: boolean): Promise<SkillMutationResult | null> => {
    setBusyName(name);
    try {
      const result = await run((rev) => setSkillEnabled(name, enabled, rev));
      if (result !== null && result.verdict !== 'blocked') await load();
      return result;
    } finally {
      setBusyName(null);
    }
  }, [run, load]);

  const onRowToggle = (row: SkillRow): void => {
    setPageError(null);
    setPageResult(null);
    void toggle(row.name, !row.enabled)
      .then((result) => {
        // A clear flip needs no banner — the row's switch IS the answer; warnings and refusals do.
        if (result !== null && (result.verdict !== 'clear' || result.findings.length > 0)) {
          setPageResult({ verb: `${row.enabled ? 'Disable' : 'Enable'} ${row.name}`, result });
        }
      })
      .catch((e: unknown) => setPageError(e instanceof Error ? e.message : String(e)));
  };

  /** The three page verbs share one shape: run, show the envelope, reload on an applied write.
   *  Each answers its own result type; the note reads the fields that type carries. */
  const pageVerb = async (verb: PageVerb): Promise<void> => {
    setVerbBusy(verb);
    setPageError(null);
    setPageResult(null);
    setNote(null);
    try {
      let result: SkillAnalyzeResult | null;
      let applied: string | null = null;
      if (verb === 'analyze') {
        result = await analyzeSkills();
      } else if (verb === 'publish') {
        const r = await run((rev) => publishSkills(rev));
        result = r;
        // `snapshot` is null exactly when the publish was blocked (nothing written, revision unchanged).
        if (r !== null && r.snapshot !== null) {
          applied = `Published — snapshot generation ${r.snapshot.gen} is current (${r.snapshot.skills} skills, ${r.snapshot.contentHash.slice(0, 12)}); workers spawn with it from now on.`;
        }
      } else {
        const r = await run((rev) => refreshSkillsBaseline(rev));
        result = r;
        if (r !== null && r.verdict !== 'blocked') {
          applied = `Baseline refreshed — ${r.plugin_version} (${r.baseline.slice(0, 12)}): ${r.taken.length} taken · ${r.kept.length} kept · ${r.added.length} added · ${r.removed.length} removed · ${r.conflicts.length} ${r.conflicts.length === 1 ? 'conflict' : 'conflicts'}. Your edits were kept; conflicts are flagged.`;
        }
      }
      if (result === null) return;
      setPageResult({ verb: PAGE_VERB_LABEL[verb], result });
      if (verb === 'analyze' || result.verdict === 'blocked') return;
      const next = await load();
      if (next === null) return;
      setNote(applied);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerbBusy(null);
    }
  };

  /** After an applied Add: the modal closes, the note stands, and the catalog is re-read — the new
   *  skill's drawer (`?skill=<name>`) opens only once that re-read SUCCEEDS. A failed re-read has
   *  already raised the stale banner (the rows stay, writes wait); navigating anyway would render
   *  "No skill named … in this catalog" over a skill the daemon DID write (review round 3). */
  const onAdded = (name: string, result: SkillMutationResult): void => {
    setAddOpen(false);
    setNote(`Added ${name} — publish to hand it to workers.`);
    setPageResult(result.findings.length > 0 ? { verb: `Add ${name}`, result } : null);
    void load().then((next) => {
      if (next !== null) navigate(skillsPath(name));
    });
  };

  const baseline = catalog === null ? null : currentBaseline(catalog.manifest);
  const current = catalog?.current ?? null;
  const published = catalog?.manifest.published ?? null;
  /** Every write affordance waits while: a 409 is up, the catalog is stale, a write is in flight,
   *  or a page verb is running — they all share the one revision. */
  const frozen = conflict !== null || stale !== null || inFlight > 0 || verbBusy !== null;

  const verbButton = (verb: PageVerb, testId: string, title: string, primary: boolean): React.ReactElement => (
    <button
      type="button"
      data-testid={testId}
      disabled={frozen || verbBusy !== null}
      title={title}
      onClick={() => void pageVerb(verb)}
      className="rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
      style={primary
        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
        : { color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
    >
      {verbBusy === verb ? `${PAGE_VERB_LABEL[verb]}…` : PAGE_VERB_LABEL[verb]}
    </button>
  );

  return (
    <div data-testid="skills-page" className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Skills</h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              The skills every governed worker runs — one effective plugin root the daemon publishes
              as immutable snapshots. Edit any file in place, enable or disable, reset to the baseline;
              the daemon guards every write, and nothing reaches a worker until you publish.
            </p>
            {catalog !== null && (
              <p data-testid="skills-root" className="mt-1 font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }} title="the resolved skills root on the daemon host (<state home>/skills — not configurable)">
                root {catalog.root}
              </p>
            )}
            {baseline !== null && (
              <p
                data-testid="skills-source"
                data-venv={baseline.venv}
                className="mt-0.5 font-mono text-[10px]"
                style={{ color: 'var(--ink-dim)' }}
                title={`captured from ${baseline.source.path}`}
              >
                baseline {baseline.plugin_version} · {baseline.source.kind} · {baseline.hash.slice(0, 12)}
                {baseline.git_sha !== null && ` · ${baseline.git_sha.slice(0, 10)}`}
                {` · venv ${baseline.venv}`}
                {` · captured ${baseline.captured_at}`}
              </p>
            )}
            {catalog !== null && (
              <p
                data-testid="skills-snapshot"
                data-generation={current?.gen ?? 'none'}
                data-unpublished={unpublished}
                className="mt-0.5 font-mono text-[10px]"
                style={{ color: unpublished > 0 ? 'var(--status-run)' : 'var(--ink-dim)' }}
                title={current === null ? undefined : current.path}
              >
                {current === null
                  ? 'never published — no snapshot to hand to workers yet'
                  : `snapshot generation ${current.gen} is current`}
                {published !== null && ` · published ${published.at} · ${published.contentHash.slice(0, 12)}`}
                {unpublished > 0 && ` · ${unpublished} unpublished ${unpublished === 1 ? 'skill' : 'skills'}`}
              </p>
            )}
            {engine !== null && (
              <p
                data-testid="skills-engine"
                data-state={engine.state}
                className="mt-0.5 font-mono text-[10px]"
                style={{ color: ENGINE_STATE_COLOR[engine.state] }}
                title={engine.engineInput === null ? 'WICKED_SKILLS_SNAPSHOT is unset' : `WICKED_SKILLS_SNAPSHOT=${engine.engineInput}`}
              >
                engine {SKILLS_ENGINE_STATE_COPY[engine.state]}
                {engine.current !== null && ` · gen ${engine.current.gen}`}
                {engine.findings.map((f, i) => (
                  <span key={`${f.kind}-${i}`} data-testid="skills-engine-finding" data-kind={f.kind} data-severity={f.severity} className="block">
                    {f.kind} · {f.severity} · {f.message}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {state.kind === 'loaded' && (
              <>
                <button
                  type="button"
                  data-testid="skills-add-open"
                  disabled={frozen}
                  onClick={() => setAddOpen(true)}
                  className="rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
                  style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
                >
                  Add skill…
                </button>
                {verbButton('refresh', 'skills-refresh', 'Capture the installed plugin as a new baseline and merge it three-way per file: untouched skills take the new version, your edits are kept and conflicts flagged — never clobbered', false)}
                {verbButton('analyze', 'skills-analyze', 'Dry-run the publish validation over the whole tree — the same findings, nothing written, the revision unchanged', false)}
                {verbButton('publish', 'skills-publish', 'Validate the whole tree and write the immutable snapshot generation workers spawn with (enabled skills only); a publish with only warnings still writes it', true)}
              </>
            )}
            <button
              type="button"
              data-testid="skills-reload"
              title="Re-read the catalog (the drawer re-reads its open file against it)"
              onClick={() => void load()}
              className="text-[10px] hover:underline"
              style={{ color: 'var(--ink-dim)' }}
            >
              Refresh
            </button>
          </div>
        </div>

        {state.kind === 'loading' ? (
          <p data-testid="skills-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading skills…</p>
        ) : state.kind === 'unsupported' ? (
          <div
            data-testid="skills-unsupported"
            className="flex flex-col gap-2 rounded p-4"
            style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>Skills are not served by this daemon.</p>
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{SKILLS_UNSUPPORTED_COPY}</p>
          </div>
        ) : state.kind === 'unavailable' ? (
          <div
            data-testid="skills-unavailable"
            role="alert"
            className="flex flex-col gap-2 rounded p-4"
            style={{ background: 'var(--surface-rail)', border: '1px solid var(--status-fail)' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--status-fail)' }}>The daemon has no skills catalog to serve.</p>
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              The `/skills` routes are here but answered 503 — the root is not seeded (no installed wicked-garden plugin was found),
              the published snapshot fails verification, or the daemon booted without the skills seam. Nothing is shown as an
              empty catalog. The daemon says:
            </p>
            <p className="font-mono text-[11px]" style={{ color: 'var(--ink-high)' }}>{state.message}</p>
          </div>
        ) : state.kind === 'failed' ? (
          <p data-testid="skills-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {state.message}
          </p>
        ) : (
          <>
            <KpiBand testId="skills-kpis">
              <KpiGroup label="Catalog" grow={2}>
                <StatTile
                  testId="skills-kpi-total"
                  label="Skills"
                  value={counts.total}
                  context={baseline === null ? undefined : `baseline ${baseline.plugin_version}`}
                  onOpen={() => setFacets({ ...facets, chip: 'all' })}
                />
                <StatTile
                  testId="skills-kpi-enabled"
                  label="Enabled"
                  value={counts.enabled}
                  context={`${counts.total - counts.enabled} disabled`}
                  onOpen={() => setFacets({ ...facets, chip: 'enabled' })}
                />
              </KpiGroup>
              <KpiGroup label="Provenance" grow={2}>
                <StatTile
                  testId="skills-kpi-overridden"
                  label="Overridden"
                  value={counts.overridden}
                  context="edited from the baseline"
                  valueColor={counts.overridden > 0 ? 'var(--status-gate)' : undefined}
                  onOpen={() => setFacets({ ...facets, chip: 'overridden' })}
                />
                <StatTile
                  testId="skills-kpi-core"
                  label="Core"
                  value={counts.core}
                  context="in the workflow reference closure"
                  onOpen={() => setFacets({ ...facets, chip: 'core' })}
                />
              </KpiGroup>
              <KpiGroup label="Reach">
                <StatTile
                  testId="skills-kpi-portable"
                  label="Portable"
                  value={counts.portable}
                  context={`${counts.notPortable} not portable · ${counts.needsClaude} need Claude harness`}
                  onOpen={() => setFacets({ ...facets, chip: 'portable' })}
                />
              </KpiGroup>
            </KpiBand>

            {stale !== null && (
              <div
                data-testid="skills-stale"
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--status-gate)', color: 'var(--ink-muted)' }}
              >
                <span className="font-semibold" style={{ color: 'var(--status-gate)' }}>The catalog could not be re-read.</span>
                <span>{stale} — what is shown may be behind the daemon; writes wait until a re-read succeeds.</span>
                <span className="flex-1" />
                <button
                  data-testid="skills-stale-retry"
                  type="button"
                  onClick={() => void load()}
                  className="rounded px-2 py-0.5 text-[10px] font-semibold"
                  style={{ color: 'var(--status-gate)', border: '1px solid var(--status-gate)' }}
                >
                  Retry
                </button>
              </div>
            )}
            {note !== null && (
              <p
                data-testid="skills-note"
                className="rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
              >
                {note}
              </p>
            )}
            {pageError !== null && (
              <p data-testid="skills-page-error" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
                {pageError}
              </p>
            )}
            {pageResult !== null && (
              <SkillFindings verb={pageResult.verb} result={pageResult.result} testId="skills-page-findings" />
            )}
            {linkedMissing && (
              <p
                data-testid="skills-deep-link-missing"
                className="rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
              >
                No skill named <span className="font-mono">{linked}</span> in this catalog — showing every skill.
              </p>
            )}

            <SkillsGrid
              rows={rows}
              facets={facets}
              onFacets={setFacets}
              selectedName={selected?.name ?? null}
              busyName={busyName}
              frozen={frozen}
              onSelect={selectSkill}
              onToggle={onRowToggle}
            />
          </>
        )}
      </div>

      {selected !== null && (
        <SkillDrawer
          key={selected.name}
          skill={selected}
          support={support}
          writer={writer}
          catalogEpoch={catalogEpoch}
          busy={frozen || busyName === selected.name}
          leaveTo={pendingSelect}
          onClose={() => navigate(skillsPath())}
          onLeave={onLeave}
          onDirtyChange={setDrawerDirty}
          onToggle={toggle}
          onChanged={() => void load()}
        />
      )}

      {addOpen && (
        <SkillFilesMapModal
          mode="add"
          name={null}
          writer={writer}
          onClose={() => setAddOpen(false)}
          onDone={onAdded}
        />
      )}

      {/* The revision-conflict prompt: above every layer (the drawer is z-40, modals z-50) so the
          operator sees it wherever the stale write came from. Reload is the only way forward —
          nothing else is written while it shows. Drafts in the drawer are kept. */}
      {conflict !== null && (
        <div
          data-testid="skills-conflict"
          role="alertdialog"
          aria-label="The skills catalog changed"
          className="fixed inset-x-0 top-3 z-[60] mx-auto flex w-[36rem] max-w-[92vw] flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-[11px] shadow-2xl"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--status-gate)', color: 'var(--ink-muted)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--status-gate)' }}>The skills catalog changed under this page.</span>
          <span>
            Nothing was written{conflict !== '' ? ` — ${conflict}` : ''}. Reload to pick up the current revision;
            unsaved edits in the drawer are kept as drafts.
          </span>
          <span className="flex-1" />
          <button
            data-testid="skills-conflict-reload"
            type="button"
            onClick={() => void reloadAfterConflict()}
            className="rounded px-3 py-1 text-[11px] font-semibold"
            style={{ background: 'var(--status-gate)', color: 'var(--surface-base)' }}
          >
            Reload catalog
          </button>
        </div>
      )}
    </div>
  );
}
