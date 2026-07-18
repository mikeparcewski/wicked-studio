import type { CodeGraphNode } from '../api/types.js';

interface Props {
  nodes: CodeGraphNode[];
  selectedId?: string | null;
  onSelect?: (node: CodeGraphNode) => void;
}

const KIND_COLORS: Record<string, string> = {
  function:   '#10b981',
  method:     '#10b981',
  class:      '#f97316',
  struct:     '#f97316',
  interface:  '#3b82f6',
  type_alias: '#3b82f6',
  enum:       '#8b5cf6',
};
const LANG_COLORS: Record<string, string> = {
  typescript: '#10b981',
  javascript: '#10b981',
  rust:       '#f97316',
  python:     '#3b82f6',
  go:         '#06b6d4',
};
function nodeColor(n: CodeGraphNode): string {
  return KIND_COLORS[n.kind?.toLowerCase()] ?? LANG_COLORS[n.lang?.toLowerCase()] ?? '#9ca3af';
}

export function HotspotsView({ nodes, selectedId, onSelect }: Props): React.ReactElement {
  const top40 = [...nodes].sort((a, b) => b.inDeg - a.inDeg).slice(0, 40);
  const maxInDeg = top40[0]?.inDeg ?? 1;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b bg-gray-50 shrink-0">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">
          Hotspots by caller count — click to inspect
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {top40.map((n, i) => {
          const barPct = maxInDeg > 0 ? (n.inDeg / maxInDeg) * 100 : 0;
          const color = nodeColor(n);
          const isSelected = n.id === selectedId;
          const displayName = n.name || n.id.split('/').pop() || n.id;
          const filePart = n.file ? n.file.split('/').slice(-2).join('/') : '';

          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect?.(n)}
              className={`w-full text-left px-4 py-2.5 border-b border-gray-100 relative transition-colors ${
                isSelected ? 'bg-emerald-50' : 'hover:bg-gray-50'
              }`}
            >
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${barPct}%`, backgroundColor: color, opacity: isSelected ? 0.18 : 0.1 }}
              />

              <div className="relative flex items-center gap-2">
                <span className="text-[10px] text-gray-400 tabular-nums w-5 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-mono text-[11px] text-gray-800 truncate font-medium" title={n.name || n.id}>
                    {displayName}
                  </span>
                  {filePart && (
                    <span className="text-[9px] text-gray-400 truncate">
                      {n.kind && <span className="text-gray-500 mr-1">{n.kind}</span>}
                      {filePart}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-gray-600 tabular-nums ml-2">
                  {n.inDeg}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
