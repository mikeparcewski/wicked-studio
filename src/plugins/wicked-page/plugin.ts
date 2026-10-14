import { startPageEditor } from '../_shared/pageEditor.js';
import surfaces from './surfaces.json';

export function start(): void {
  startPageEditor({ editor: 'wicked-page', surfaces, kind: 'page', coverage: false });
}

start();
