import { startPageEditor } from '../_shared/pageEditor.js';
import surfaces from './surfaces.json';

startPageEditor({ editor: 'wicked-doc', surfaces, kind: 'document', coverage: true });
