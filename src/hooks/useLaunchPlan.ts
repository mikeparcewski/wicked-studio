import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, LaunchPlan, PlanPreviewBody } from '../api/teamPlan.js';
import {
  humanConfirmFor,
  launchPreviewView,
  parseTouch,
  planFromSelection,
  scopeOffset,
  type ConfirmChoice,
  type LaunchPreviewView,
  type PickedPhase,
  type PostureMode,
} from '../board/planModel.js';
import {
  loadCatalog,
  loadPresets,
  presetFor,
  previewKey,
  requestPreview,
  usePlanCatalog,
  type LoadState,
  type PreviewState,
} from '../store/planCatalog.js';

/** The phase selection (the picker's state) and the plan it composes. */
export interface PhaseSelection {
  catalog: LoadState;
  entries: CatalogEntry[];
  picked: PickedPhase[];
  add: (catalog: string) => void;
  remove: (index: number) => void;
  clear: () => void;
  touchText: string;
  setTouchText: (t: string) => void;
  /** A composed plan is in hand: the launch sends `plan`, not `workflow`. */
  composing: boolean;
  plan: LaunchPlan | null;
}

/** What the launch would carry, besides a composed plan. */
export interface LaunchPreviewInput {
  plan: LaunchPlan | null;
  /** The named workflow / preset (ignored while a composed plan is in hand). */
  workflow: string;
  projectId: string | null;
  repoRef: string | null;
  deliver: 'pr' | 'none' | null;
  mode: PostureMode;
  confirm: ConfirmChoice;
  beforeOrd: number;
}

export interface LaunchPreviewModel {
  /** What gets previewed: the composed plan, or the named preset's steps. `null` = nothing to preview. */
  previewBody: PlanPreviewBody | null;
  previewOf: 'plan' | 'preset' | null;
  preview: PreviewState | null;
  view: LaunchPreviewView | null;
  /** The launch's `humanConfirm`, shifted past the PA's scope step. Awaits the preview when needed. */
  resolveHumanConfirm: () => Promise<string | undefined>;
}

const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The phase picker's behaviour (DES-TEAMING-002 T9): the selection over `GET /catalog` (loaded
 * when the picker opens) and the launch plan it composes.
 */
export function usePhaseSelection(pickerOpen: boolean): PhaseSelection {
  const catalog = usePlanCatalog((s) => s.catalog);
  const entries = usePlanCatalog((s) => s.entries);
  const [picked, setPicked] = useState<PickedPhase[]>([]);
  const [touchText, setTouchText] = useState('');
  useEffect(() => {
    if (pickerOpen) loadCatalog();
  }, [pickerOpen]);
  const composing = picked.length > 0;
  const plan = useMemo(
    () => (composing ? planFromSelection(picked, parseTouch(touchText)) : null),
    [composing, picked, touchText],
  );
  return {
    catalog,
    entries,
    picked,
    add: useCallback((c: string) => setPicked((cur) => [...cur, { catalog: c }]), []),
    remove: useCallback((i: number) => setPicked((cur) => cur.filter((_, j) => j !== i)), []),
    clear: useCallback(() => setPicked([]), []),
    touchText,
    setTouchText,
    composing,
    plan,
  };
}

/**
 * The launch preview's behaviour (DES-TEAMING-002 T9): `POST /plans/preview` for the composed
 * plan or the named preset, debounced, and the `before:N` shift a scoped launch needs.
 */
export function useLaunchPreview(input: LaunchPreviewInput): LaunchPreviewModel {
  const presets = usePlanCatalog((s) => s.presets);
  const previews = usePlanCatalog((s) => s.previews);
  useEffect(() => {
    loadPresets(input.projectId);
  }, [input.projectId]);

  const { plan } = input;
  const preset = plan !== null ? null : presetFor(presets, input.projectId, input.workflow.trim());

  // The preview's gate mode: any before:N is manual mode, so the unshifted token previews the same.
  const previewConfirm = humanConfirmFor(input.mode, input.confirm, input.beforeOrd, 0);
  const previewBody = useMemo((): PlanPreviewBody | null => {
    const p: LaunchPlan | null = plan ?? (preset !== null ? { steps: preset.steps } : null);
    if (p === null) return null;
    return {
      plan: p,
      ...(input.projectId !== null ? { projectId: input.projectId } : {}),
      ...(previewConfirm !== undefined ? { humanConfirm: previewConfirm } : {}),
      ...(input.repoRef !== null ? { repoRef: input.repoRef } : {}),
      ...(input.deliver !== null ? { deliver: input.deliver } : {}),
    };
  }, [plan, preset, input.projectId, previewConfirm, input.repoRef, input.deliver]);
  const key = previewBody === null ? null : previewKey(previewBody);

  useEffect(() => {
    if (previewBody === null) return;
    const t = setTimeout(() => void requestPreview(previewBody), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `key` is the body's identity; the body object itself is rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const preview = key === null ? null : (previews[key] ?? { status: 'loading' as const });
  const view = preview !== null && preview.status === 'ready' ? launchPreviewView(preview.preview) : null;

  const resolveHumanConfirm = useCallback(async (): Promise<string | undefined> => {
    const unshifted = humanConfirmFor(input.mode, input.confirm, input.beforeOrd, 0);
    if (unshifted === undefined || !unshifted.startsWith('before:') || previewBody === null) return unshifted;
    const st = await requestPreview(previewBody);
    const offset = st.status === 'ready' ? scopeOffset(st.preview) : 0;
    return humanConfirmFor(input.mode, input.confirm, input.beforeOrd, offset);
  }, [input.mode, input.confirm, input.beforeOrd, previewBody]);

  return {
    previewBody,
    previewOf: plan !== null ? 'plan' : preset !== null ? 'preset' : null,
    preview,
    view,
    resolveHumanConfirm,
  };
}
