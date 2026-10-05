/**
 * The capture wire (Studio OS behaviour 8, crew api-types 0.48.0): `POST /projects/:id/capture`.
 * Notes, text files and photos go to the daemon; it files a small run to the project whose output
 * is proposals in the ONE review queue (`./proposals.ts`).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 * `CaptureFile` below is studio's own union over the two file shapes.
 */

import { apiFetch } from './client.js';
import { readFileText } from '../components/fileText.js';

import type { CaptureTextFile, CaptureImageFile, CaptureBody, CaptureResponse } from 'wicked-crew-api-types';
export type { CaptureTextFile, CaptureImageFile, CaptureBody, CaptureResponse };

export type CaptureFile = CaptureTextFile | CaptureImageFile;

/** The image types a vision-capable seat reads, by extension (the daemon refuses any other). */
export const CAPTURE_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The media type a picked file lands as, or null when it is not a capture image. */
export function captureImageType(file: { name: string; type: string }): string | null {
  if (Object.values(CAPTURE_IMAGE_TYPES).includes(file.type)) return file.type;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return CAPTURE_IMAGE_TYPES[ext] ?? null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error(`could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** A picked file as the capture wire carries it: a photo as base64, anything else as text. */
export async function toCaptureFile(file: File): Promise<CaptureFile> {
  const mediaType = captureImageType(file);
  if (mediaType !== null) return { name: file.name, mediaType, dataBase64: await readBase64(file) };
  return { name: file.name, text: await readFileText(file) };
}

/** `POST /projects/:id/capture` → the capture run's id. */
export function postCapture(projectId: string, body: CaptureBody): Promise<CaptureResponse> {
  return apiFetch<CaptureResponse>(`/projects/${encodeURIComponent(projectId)}/capture`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
