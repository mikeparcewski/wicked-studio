/**
 * The wicked-apps runtime as the standalone site's page runs it (DES-APPS-001 §7.1, §8.2). The site's host is in the
 * same page and calls `boot` with its end of an in-process MessageChannel and the hello it would have sent; the
 * runtime then never reads `window` messages and never posts to a parent. crew's publish packs this entry's bundle
 * (`<dist>/apps-standalone/runtime.js`) and the runtime's one stylesheet (`runtime.css`) into the site's page.
 */

import { startRuntime } from './runtime/runtime.js';
import surfaces from './surfaces.json';

export function boot(port: MessagePort, hello: Record<string, unknown>): void {
  startRuntime({ editor: 'wicked-apps', surfaces, connect: { port, hello } });
}
