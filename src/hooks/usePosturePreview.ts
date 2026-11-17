import { useCallback, useEffect, useRef, useState } from 'react';

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
  /** crew's answer for the fields on screen. */
  answer: PostureAnswer;
  /** crew's answer for an exact key (`null` when none is in): what Send reads. */
  postureFor: (key: string) => LaunchPreviewPosture | null;
}

/**
 * (studio#1150) crew's posture for the form's body (`POST /runs/preview`), debounced and keyed by
 * {@link postureKey}. `enabled` false (no power mode on this daemon) asks nothing.
 */
export function usePosturePreview(
  fields: LaunchPostureFields,
  humanConfirm: string | undefined,
  powerChoice: boolean | undefined,
  enabled: boolean,
): PosturePreview {
  const key = postureKey(fields, powerChoice);
  const answers = useRef(new Map<string, PostureAnswer>());
  const [, bump] = useState(0);
  const body: LaunchPreviewBody = {
    ...fields,
    ...(humanConfirm !== undefined ? { humanConfirm } : {}),
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
          map.set(key, r.posture !== undefined && typeof r.posture.power === 'boolean'
            ? { status: 'ready', posture: r.posture }
            : { status: 'none' });
          if (live) bump((n) => n + 1);
        },
        () => {
          map.set(key, { status: 'none' });
          if (live) bump((n) => n + 1);
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
  const postureFor = useCallback((k: string): LaunchPreviewPosture | null => {
    const a = answers.current.get(k);
    return a !== undefined && a.status === 'ready' ? a.posture : null;
  }, []);
  const answer: PostureAnswer = !enabled ? { status: 'none' } : answers.current.get(key) ?? { status: 'loading' };
  return { key, answer, postureFor };
}
