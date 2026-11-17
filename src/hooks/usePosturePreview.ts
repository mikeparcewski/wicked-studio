import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import {
  postureKey,
  type LaunchPostureFields,
  type LaunchPreviewBody,
  type LaunchPreviewPosture,
} from '../board/launchPosture.js';

const DEBOUNCE_MS = 300;

export type PostureAnswer =
  | { status: 'loading' }
  | { status: 'ready'; posture: LaunchPreviewPosture }
  /** Failed, or a daemon without `POST /runs/preview`: nothing is claimed. */
  | { status: 'none' };

export interface PosturePreview {
  /** The key of the fields on screen. */
  key: string;
  /** crew's answer for the fields on screen: what the form renders, and what Send captures. */
  answer: PostureAnswer;
}

/**
 * (studio#1150) crew's posture for the form's body (`POST /runs/preview`), debounced and keyed by
 * {@link postureKey}. `enabled` false (the daemon has no power mode, or is not known to) asks nothing.
 *
 * The request carries no `humanConfirm`: the form reads only `power`, `deliver` and `autoDeliver`,
 * none of which crew decides from it. A phased run keeps the `humanConfirm` Send carries (crew's
 * own matrix, `launch-posture.test.ts`); a power run keeps none.
 *
 * A request whose fields left the screen before it answered is dropped, never stored: a later
 * answer for the same fields is the only one that can stand.
 */
export function usePosturePreview(
  fields: LaunchPostureFields,
  powerChoice: boolean | undefined,
  enabled: boolean,
): PosturePreview {
  const key = postureKey(fields, powerChoice);
  const answers = useRef(new Map<string, PostureAnswer>());
  const [, bump] = useState(0);
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
          map.set(key, r.posture !== undefined && typeof r.posture.power === 'boolean'
            ? { status: 'ready', posture: r.posture }
            : { status: 'none' });
          bump((n) => n + 1);
        },
        () => {
          if (!live) return;
          map.set(key, { status: 'none' });
          bump((n) => n + 1);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
      if (map.get(key)?.status === 'loading') map.delete(key);
    };
    // `key` is the fields' identity; the body is rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  const answer: PostureAnswer = !enabled ? { status: 'none' } : answers.current.get(key) ?? { status: 'loading' };
  return { key, answer };
}
