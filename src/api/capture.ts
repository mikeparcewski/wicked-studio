/**
 * The capture wire (Studio OS behaviour 8, crew api-types 0.48.0): `POST /projects/:id/capture`.
 * Notes, text files and photos go to the daemon; it files a small run to the project whose output
 * is proposals in the ONE review queue (`./proposals.ts`).
 *
 * ── INTEGRATION POINT ──────────────────────────────────────────────────────────────────────────
 * Hand-mirrored from crew's `CaptureBody` / `CaptureResponse` because studio's installed
 * `wicked-crew-api-types` predates 0.48.0 — delete these declarations and re-export from the
 * contract package when studio bumps to it (the `./proposals.ts` precedent).
 */

import { apiFetch } from './client.js';
import { readFileText } from '../components/fileText.js';

export interface CaptureTextFile {
  name: string;
  text: string;
}

export interface CaptureImageFile {
  name: string;
  mediaType: string;
  dataBase64: string;
}

export type CaptureFile = CaptureTextFile | CaptureImageFile;

export interface CaptureBody {
  notes?: string;
  files?: CaptureFile[];
}

export interface CaptureResponse {
  runId: string;
}

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
