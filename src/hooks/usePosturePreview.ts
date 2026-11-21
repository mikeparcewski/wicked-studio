import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import {
  isLaunchPreviewPosture,
  postureKey,
  type LaunchPostureFields,
  type LaunchPreviewBody,
  type LaunchPreviewPosture,
} from '../board/launchPosture.js';

const DEBOUNCE_MS = 300;

export type PostureAnswer =
  | { status: 'loading' }
  | { status: 'ready'; posture: LaunchPreviewPosture }
  /** The preview failed (network, 5xx, a malformed answer): power-capable forms offer Retry; Send runs phased. */
  | { status: 'failed' }
  /** A daemon without `POST /runs/preview` (404): nothing is claimed; Send runs phased. */
  | { status: 'none' };

export interface PosturePreview {
  /** The key of the fields on screen. */
  key: string;
  /** crew's answer for the fields on screen: what the form renders, and what Send captures. */
  answer: PostureAnswer;
  /** Ask again for the fields on screen (the Retry of a failed preview). */
  retry: () => void;
}

/**
 * (studio#1150) crew's posture for the form's body (`POST /runs/preview`), debounced and keyed by
 * {@link postureKey}. `enabled` stays false until health settles, then every daemon is asked.
 * `power` is included only when the person turned power off through the power-mode switch.
 *
 * The request carries no `humanConfirm`: the form reads only `power`, `deliver` and `autoDeliver`,
 * none of which crew decides from it. A phased run keeps the `humanConfirm` Send carries (crew's
 * own matrix, `launch-posture.test.ts`); a power run keeps none.
 *
 * A request whose fields left the screen before it answered is dropped, never stored: a later
 * answer for the same fields is the only one that can stand.
 *
 * A failed preview (codex merge check r3) is its own state, never `none`: power-capable forms show it with Retry. It is
 * kept only while its fields are on screen, so the next change of the form asks again, and so does coming back.
 */
export function usePosturePreview(
  fields: LaunchPostureFields,
  powerChoice: boolean | undefined,
  enabled: boolean,
): PosturePreview {
  const key = postureKey(fields, powerChoice);
  const answers = useRef(new Map<string, PostureAnswer>());
  const [, bump] = useState(0);
  const [retries, setRetries] = useState(0);
  const body: LaunchPreviewBody = {
    ...fields,
    ...(powerChoice !== undefined ? { power: powerChoice } : {}),
  };
  const bodyJson = JSON.stringify(body);
  useEffect(() => {
    if (!enabled) return;
    const map = answers.current;
    const have = map.get(key);
    if (have !== undefined && have.status === 'ready') return;
    map.set(key, { status: 'loading' });
    let live = true;
    const t = setTimeout(() => {
      api.previewLaunchPosture(JSON.parse(bodyJson) as LaunchPreviewBody).then(
        (r) => {
          if (!live) return;
          const posture: unknown = typeof r === 'object' && r !== null ? (r as { posture?: unknown }).posture : undefined;
          map.set(key, isLaunchPreviewPosture(posture)
            ? { status: 'ready', posture }
            : { status: 'failed' });
          bump((n) => n + 1);
        },
        (err: unknown) => {
          if (!live) return;
          map.set(key, err instanceof ApiError && err.status === 404 ? { status: 'none' } : { status: 'failed' });
          bump((n) => n + 1);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
      const left = map.get(key)?.status;
      if (left === 'loading' || left === 'failed') map.delete(key);
    };
    // `key` is the fields' identity; the body is rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, retries]);
  const answer: PostureAnswer = !enabled ? { status: 'none' } : answers.current.get(key) ?? { status: 'loading' };
  const retry = (): void => {
    if (answers.current.get(key)?.status !== 'failed') return;
    answers.current.delete(key);
    setRetries((n) => n + 1);
  };
  return { key, answer, retry };
}
