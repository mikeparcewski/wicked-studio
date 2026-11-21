import { useEffect, useState } from 'react';
import { getDiagnostics } from '../api/diagnostics.js';
import { floorCacheWords } from '../board/nerveOverview.js';
import { HEALTH_RECHECKED } from '../store/systemSnapshot.js';

/** studio#1096: this optional disk detail is only carried by diagnostics. */
export function useFloorCache(): string | null {
  const [words, setWords] = useState<string | null>(null);
  useEffect(() => {
    let generation = 0;
    const read = (): void => {
      const mine = ++generation;
      void getDiagnostics().then((d) => {
        if (mine === generation) setWords(floorCacheWords(d));
      }).catch(() => { if (mine === generation) setWords(null); });
    };
    read();
    window.addEventListener(HEALTH_RECHECKED, read);
    return () => { generation++; window.removeEventListener(HEALTH_RECHECKED, read); };
  }, []);
  return words;
}
