import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getDiagnostics } from '../api/diagnostics.js';
import { apiRevision, apiWire, readErrorKind } from '../api/errors.js';
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
  supportFiles,
  baselineDrift,
  unpublishedSupport,
  type DiagnosticsSkills,
  type SkillAnalyzeResult,
  type SkillGuardResult,
  type SkillMutationResult,
  type SkillRefreshResult,
  type SkillRow,
  type SkillsCatalog,
} from '../api/skills.js';
import { PageFrame, SectionTitle } from './ui/PageFrame.js';
import { OverflowMenu } from './ui/OverflowMenu.js';
import { StatLine } from './ui/StatLine.js';
import { StateBanner, EmptyState, Skeleton } from './ui/StateBanner.js';
import { TechDetails } from './ui/TechDetails.js';
import { relTime } from '../board/relTime.js';
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
  | { kind: 'unavailable'; message: string; errorKind: ReturnType<typeof readErrorKind> }
  | { kind: 'failed'; message: string; errorKind: ReturnType<typeof readErrorKind> };

type PageVerb = 'refresh' | 'analyze' | 'publish';

const PAGE_VERB_LABEL: Record<PageVerb, string> = {
  refresh: 'Refresh baseline',
  analyze: 'Analyze',
  publish: 'Publish',
};

export function SkillsPage({ navigate, search = '' }: {
  navigate: (path: string) => void;
  /** The URL search string — `?skill=<name>` addresses one skill's drawer. */
  search?: string;
}): React.ReactElement {
  // #560: the daemon's sentences (a finding, the 503 body, a recovery error) embed home paths
  // mid-sentence — the same `~/…` rule as the path fields, over free text.
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
  // studio#515: where the page header ends — the drawer is pinned below it (a fixed aside over the
  // header hid Refresh baseline / Analyze / Publish and the catalog re-read while a skill was open).
  // Re-measured on resize, on any scroll (the header lives in the page's scroller) and when the
  // header itself changes height (the snapshot / engine lines come and go).
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [drawerTop, setDrawerTop] = useState(0);
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = headerRef.current;
      if (el === null) return;
      const next = Math.max(0, Math.round(el.getBoundingClientRect().bottom), Math.round(el.closest('.wk-page-head')?.getBoundingClientRect().bottom ?? 0));
      setDrawerTop((cur) => (cur === next ? cur : next));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const ro = typeof ResizeObserver === 'undefined' || headerRef.current === null ? null : new ResizeObserver(measure);
    if (ro !== null && headerRef.current !== null) ro.observe(headerRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      ro?.disconnect();
    };
  }, []);
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
        setState({ kind: 'unavailable', message: apiWire(e) ?? message, errorKind: readErrorKind(e) });
        void loadEngine();
      } else {
        setState({ kind: 'failed', message, errorKind: readErrorKind(e) });
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
  /** (studio#388) The two things that make the PUBLISHED snapshot not what a worker needs: the
   *  baseline is behind the installed plugin, and support files (`scripts/**` — where the MCP shim
   *  lives) whose content no publish carries. Neither was visible: the per-skill `unpublished`
   *  badge cannot see a file no skill owns, and nothing compared the root with the install. */
  const drift = useMemo(() => (catalog === null ? null : baselineDrift(catalog)), [catalog]);
  const unpublishedSupportFiles = useMemo(
    () => (catalog === null ? [] : unpublishedSupport(catalog.manifest)),
    [catalog],
  );

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
          // `unchanged: true` (api-types 0.38.0, crew#547): nothing was re-published — `snapshot` IS the
          // current generation, so the copy says so instead of announcing a "new" generation.
          applied = r.unchanged === true
            ? `Unchanged — generation ${r.snapshot.gen} is still current (${r.snapshot.skills} skills, ${r.snapshot.contentHash.slice(0, 12)}); nothing was re-published.`
            : `Published — snapshot generation ${r.snapshot.gen} is current (${r.snapshot.skills} skills, ${r.snapshot.contentHash.slice(0, 12)}); workers spawn with it from now on.`;
          // The engine line is re-read here explicitly (F-RC1-017 / crew#547 item 3, DES-L6 PR-L6-4a):
          // the catalog re-read below refreshes it too on success, but a failed re-read after an applied
          // publish used to leave the line on the previous generation until a page reload.
          void loadEngine();
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

  // ── Recovery from the 503 state (acceptance findings F-A45-001 / F-A45-002) ─────────────────
  //
  // `GET /skills` answers 503 when `current` fails verification (F-083: a snapshot published under
  // older portability rules — "re-publish or remove the link"), when the root is unseeded, or when
  // the manifest is corrupt. The page used to offer only Refresh (a second 503). The remedy the
  // finding itself names — re-publish — is a mutation, and every mutation is CAS-guarded by the
  // catalog's `revision`, which the 503 withholds. `POST /skills/analyze` is the dry run that reads
  // the MANIFEST (not `current`) and answers `{verdict, findings, revision}` — so it is how the
  // revision is learned here; when analyze 503s too, the manifest itself is unreadable and the UI
  // says so instead of pretending a button could fix it.
  //
  // F-A45-002: after a successful Refresh baseline the catalog is STAGED, not published — GET
  // /skills keeps answering 503 until Publish. The result is rendered INLINE ("garden 12.33.0
  // staged — publish to activate"); the page does not reload into the same 503.
  const [recovery, setRecovery] = useState<{
    busy: 'refresh' | 'publish' | null;
    /** The refresh that staged a baseline this session, when one did (F-A45-002). */
    staged: SkillRefreshResult | null;
    /** The last recovery envelope worth reading (blocked publish findings, refresh warnings). */
    result: { verb: string; result: SkillGuardResult } | null;
    error: string | null;
  }>({ busy: null, staged: null, result: null, error: null });

  /** The catalog's revision, learned through the dry run when the 503 withholds it. */
  const learnRevision = useCallback(async (): Promise<number> => {
    if (revisionRef.current !== null) return revisionRef.current;
    try {
      const a = await analyzeSkills();
      revisionRef.current = a.revision;
      return a.revision;
    } catch (e) {
      if (isSkillsUnavailable(e)) {
        throw new Error(
          `the catalog's revision could not be learned — POST /skills/analyze answered 503 too (${apiWire(e) ?? 'no detail'}), so the manifest itself is unreadable; recovery needs the daemon host (reseed the skills root), not this page`,
        );
      }
      throw e;
    }
  }, []);

  const recover = async (verb: 'refresh' | 'publish'): Promise<void> => {
    setRecovery((r) => ({ ...r, busy: verb, error: null, result: null }));
    try {
      const rev = await learnRevision();
      if (verb === 'refresh') {
        const r = await refreshSkillsBaseline(rev);
        revisionRef.current = r.revision;
        setRecovery((cur) => ({
          ...cur,
          staged: r.verdict === 'blocked' ? cur.staged : r,
          result: { verb: 'Refresh baseline', result: r },
        }));
        // The finding may have changed (a re-seeded baseline) — re-read the engine line, NOT the
        // catalog: GET /skills is still the same 503 until a publish lands (F-A45-002).
        void loadEngine();
        return;
      }
      const r = await publishSkills(rev);
      revisionRef.current = r.revision;
      setRecovery((cur) => ({ ...cur, result: { verb: 'Publish', result: r } }));
      if (r.snapshot !== null) {
        // A written snapshot is what `current` now points at — the catalog should answer 200.
        const next = await load();
        if (next !== null) {
          setNote(`Published — snapshot generation ${r.snapshot.gen} is current (${r.snapshot.skills} skills, ${r.snapshot.contentHash.slice(0, 12)}); workers spawn with it from now on.`);
          setPageResult(r.findings.length > 0 ? { verb: 'Publish', result: r } : null);
          setRecovery({ busy: null, staged: null, result: null, error: null });
        } else {
          void loadEngine();
        }
      }
    } catch (e) {
      if (isSkillsConflict(e)) {
        // The catalog moved under this page — the 409 says so AND carries the live revision
        // (crew's `{error, revision}`; independent review of #263, F-8): adopt it, so the next click
        // needs no second analyze. A 409 without one (an older daemon) re-learns it next click.
        revisionRef.current = apiRevision(e);
        setRecovery((cur) => ({
          ...cur,
          error: `the catalog changed under this page (${apiWire(e) ?? 'a stale revision'}) — ${revisionRef.current !== null ? `revision ${revisionRef.current} adopted from the refusal` : 'the revision will be re-read'}; try again`,
        }));
        return;
      }
      setRecovery((cur) => ({ ...cur, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setRecovery((cur) => ({ ...cur, busy: null }));
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

  const disabledReason = frozen ? 'Wait for the current change, or reload the catalog to continue.' : null;
  const verbButton = (verb: PageVerb, testId: string, title: string, primary: boolean): React.ReactElement => (
    <button type="button" data-testid={testId} disabled={frozen} title={title}
      onClick={() => void pageVerb(verb)} className={`wk-btn wk-btn--${primary ? 'primary' : 'secondary'}`}>
      {verbBusy === verb ? `${PAGE_VERB_LABEL[verb]}…` : PAGE_VERB_LABEL[verb]}
    </button>
  );
  const error = recovery.error ?? pageError ?? stale ?? (state.kind === 'failed' || state.kind === 'unavailable' ? state.message : null);
  const statsKnown = state.kind === 'loaded' && stale === null && pageError === null;

  return (
    <div className="wk-pg-skills-scroll">
      <PageFrame data-testid="skills-page" title="Skills" intro="Edit, turn off, or publish the skills your helpers can use."
        actions={<div ref={headerRef} data-testid="skills-header" className="flex flex-wrap items-center gap-2">
          {state.kind === 'loaded' && <>
            <button type="button" data-testid="skills-add-open" disabled={frozen} onClick={() => setAddOpen(true)} className="wk-btn wk-btn--secondary">Add skill…</button>
            {verbButton('analyze', 'skills-analyze', 'Check your changes before publishing', false)}
            {verbButton('publish', 'skills-publish', 'Publish the skills your helpers can use', true)}
          </>}
          <button type="button" data-testid="skills-reload" onClick={() => void load()} className="wk-btn wk-btn--secondary">Refresh</button>
          {state.kind === 'loaded' && <div data-testid="skills-refresh" data-disabled={frozen}><OverflowMenu label="More actions for skills" items={[{id:'refresh-baseline',label:'Refresh baseline',disabled:disabledReason,onSelect:() => void pageVerb('refresh')}]} /></div>}
          {disabledReason !== null && <p className="wk-field-note">{disabledReason}</p>}
        </div>}>
        {error !== null && <StateBanner data-testid={recovery.error !== null ? 'skills-recovery-error' : pageError !== null ? 'skills-page-error' : stale !== null ? 'skills-stale' : state.kind === 'unavailable' ? 'skills-unavailable' : 'skills-error'}
          kind={stale !== null ? 'stale' : state.kind === 'failed' || state.kind === 'unavailable' ? state.errorKind : readErrorKind(error)} what="skills" error={error} onRetry={() => { setPageError(null); void load(); }} />}
        {catalog !== null && <div className="wk-pg-skills-status">
          <p title={published?.at}>{unpublished > 0 || unpublishedSupportFiles.length > 0 ? 'Changes ready to publish' : current === null ? 'Ready to publish' : drift?.state === 'behind' ? 'Update available' : drift?.state === 'unknown' ? 'Update status unavailable' : 'Up to date'}{published !== null && ` · published ${relTime(Date.parse(published.at))}`}</p>
          {/* One disclosure for every internal fact (UI-CONTRACT §4.3); the hidden spans keep the
              machine-readable state hooks tests and journeys read. */}
          <TechDetails data-testid="skills-root" text={[
            `root ${catalog.root}`,
            ...(baseline !== null ? [`baseline ${baseline.plugin_version} · ${baseline.source.kind} · ${baseline.hash.slice(0,12)}${baseline.git_sha !== null ? ` · ${baseline.git_sha.slice(0,10)}` : ''} · venv ${baseline.venv} · captured ${baseline.captured_at} · source ${baseline.source.path}`] : []),
            current === null ? 'never published — no snapshot' : `snapshot generation ${current.gen} is current${published !== null ? ` · published ${published.at} · ${published.contentHash.slice(0,12)}` : ''}${unpublished > 0 ? ` · ${unpublished} unpublished ${unpublished === 1 ? 'skill' : 'skills'}` : ''} · ${current.path}`,
            ...(engine !== null ? [`engine ${SKILLS_ENGINE_STATE_COPY[engine.state]}${engine.current !== null ? ` · gen ${engine.current.gen}` : ''} · input ${engine.engineInput ?? 'unset'}`, ...engine.findings.map((f) => `${f.kind} · ${f.severity} · ${f.message}`)] : []),
          ]} />
          {baseline !== null && <span hidden data-testid="skills-source" data-venv={baseline.venv} />}
          <span hidden data-testid="skills-snapshot" data-generation={current?.gen ?? 'none'} data-unpublished={unpublished} />
          {engine !== null && <span hidden data-testid="skills-engine" data-state={engine.state}>
            {engine.findings.map((f, i) => <span key={i} data-testid="skills-engine-finding" data-kind={f.kind} data-severity={f.severity} />)}
          </span>}
        </div>}
        {state.kind === 'loading' ? <Skeleton data-testid="skills-loading" /> : state.kind === 'unsupported' ? (
          <EmptyState data-testid="skills-unsupported" title="Skills are unavailable in this version" body="Update Studio’s service to manage skills here." />
        ) : state.kind === 'unavailable' ? (
          <section data-testid="skills-recovery" className="wk-card">
            <SectionTitle>Restore skills</SectionTitle>
            <p>Refresh the installed skills, then publish to make them available again.</p>
            {engine === null ? <p data-testid="skills-recovery-no-diagnostics">Service details are unavailable. You can still try restoring skills.</p> : <>
              <div data-testid="skills-recovery-state" data-state={engine.state}><TechDetails text={`engine: ${engine.state} — ${SKILLS_ENGINE_STATE_COPY[engine.state]} · input ${engine.engineInput ?? 'unset'}`} /></div>
              {engine.findings.map((f,i) => <div key={i} data-testid="skills-recovery-finding" data-kind={f.kind} data-severity={f.severity}><TechDetails text={`${f.kind} · ${f.severity} · ${f.message}`} /></div>)}
            </>}
            {recovery.staged !== null && <div data-testid="skills-recovery-staged"><p>Skills refreshed — publish to activate.</p><TechDetails text={`garden ${recovery.staged.plugin_version} staged · ${recovery.staged.baseline.slice(0,12)} · ${recovery.staged.conflicts.length} conflicts`} /></div>}
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="skills-recover-refresh" disabled={recovery.busy !== null} onClick={() => void recover('refresh')} className="wk-btn wk-btn--secondary">{recovery.busy === 'refresh' ? 'Refreshing…' : 'Refresh baseline'}</button>
              <button type="button" data-testid="skills-recover-publish" disabled={recovery.busy !== null} onClick={() => void recover('publish')} className="wk-btn wk-btn--primary">{recovery.busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
            </div>
            {recovery.busy !== null && <p data-testid="skills-recovery-busy" className="wk-field-note">Restoring skills…</p>}
            {recovery.result !== null && <SkillFindings verb={recovery.result.verb} result={recovery.result.result} testId="skills-recovery-findings" />}
          </section>
        ) : state.kind === 'loaded' ? <>
          {(drift?.state === 'behind' || unpublishedSupportFiles.length > 0) && <section data-testid="skills-behind" data-drift={drift?.state ?? 'unknown'} data-unpublished-support={unpublishedSupportFiles.length} className="wk-card">
            <SectionTitle>Updates for your helpers</SectionTitle>
            <p>{drift?.state === 'behind' ? 'Refresh the installed skills, then publish to share the update with your helpers.' : 'Publish to share the updated support files with your helpers.'}</p>
            {drift?.state === 'behind' && <TechDetails data-testid="skills-behind-detail" text={`installed ${drift.installed.source.plugin_version} · ${drift.installed.source.kind} · ${drift.installed.source.path} · ${drift.installed.baseline ?? ''} · baseline ${baseline?.plugin_version ?? 'unknown'}`} />}
            {unpublishedSupportFiles.length > 0 && <TechDetails data-testid="skills-behind-support" text={`${unpublishedSupportFiles.length} unpublished support files: ${unpublishedSupportFiles.map(f => f.path).join(', ')}`} />}
            <div className="flex flex-wrap gap-2">{verbButton('refresh','skills-behind-refresh','Refresh the installed skills',drift?.state === 'behind')}{verbButton('publish','skills-behind-publish','Share updates with your helpers',drift?.state !== 'behind')}</div>
            {disabledReason !== null && <p className="wk-field-note">{disabledReason}</p>}
          </section>}
          {drift?.state === 'unknown' && drift.reason !== null && <div data-testid="skills-drift-unknown"><p>The installed skills could not be compared.</p><TechDetails text={drift.reason} /></div>}
          {/* The wrapper marks "counts settled" even when every count is 0 (StatLine then renders nothing). */}
          {statsKnown && <div data-testid="skills-kpis"><StatLine items={[
            { label: counts.total === 1 ? 'skill' : 'skills', value: counts.total },
            { label: 'enabled', value: counts.enabled },
            { label: 'edited', value: counts.overridden },
            { label: 'required', value: counts.core },
            { label: 'portable', value: counts.portable },
          ]} /></div>}
          {stale !== null && <button data-testid="skills-stale-retry" type="button" className="wk-btn wk-btn--secondary" onClick={() => void load()}>Reload catalog</button>}
          {note !== null && <div data-testid="skills-note"><p>Changes saved — publish to share them with your helpers.</p><TechDetails text={note} /></div>}
          {pageResult !== null && <SkillFindings verb={pageResult.verb} result={pageResult.result} testId="skills-page-findings" />}
          {linkedMissing && <p data-testid="skills-deep-link-missing">No skill named {linked} in this catalog — showing every skill.</p>}
          <SkillsGrid rows={rows} facets={facets} onFacets={setFacets} selectedName={selected?.name ?? null} busyName={busyName} frozen={frozen} countsKnown={statsKnown} onSelect={selectSkill} onToggle={onRowToggle} />
        </> : null}
      </PageFrame>

      {selected !== null && (
        <SkillDrawer
          key={selected.name}
          top={drawerTop}
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

      {conflict !== null && <div data-testid="skills-conflict" role="alertdialog" aria-label="The skills catalog changed" className="wk-card wk-pg-skills-conflict">
        <p>The skills catalog changed. Reload to continue; your unsaved edits are kept.</p>
        <TechDetails text={conflict} />
        <button data-testid="skills-conflict-reload" type="button" onClick={() => void reloadAfterConflict()} className="wk-btn wk-btn--primary">Reload catalog</button>
      </div>}
    </div>
  );
}
