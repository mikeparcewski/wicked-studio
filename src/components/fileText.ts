/** Read a picked file as text. `File.text()` where the runtime has it (every shipping browser),
 *  the FileReader fallback where it does not (older DOM implementations — jsdom included).
 *  ONE reader for every upload flow — steering import/author, the Testing corpus — never a fork. */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error(`could not read ${file.name}`));
    r.readAsText(file);
  });
}
