import { useMemo, useState, useRef, useEffect } from 'react';
import type { CodeGraphNode, CodeGraphEdge } from '../api/types.js';

interface Props {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  width?: number;
  height?: number;
  externalSelectedId?: string;
  onNodeClick?: (node: CodeGraphNode) => void;
  onNodeSelect?: (node: CodeGraphNode | null) => void;
}

const KIND_COLORS: Record<string, string> = {
  function:    '#10b981',
  method:      '#10b981',
  constructor: '#10b981',
  class:       '#f97316',
  struct:      '#f97316',
  interface:   '#3b82f6',
  type_alias:  '#3b82f6',
  trait:       '#3b82f6',
  enum:        '#8b5cf6',
  macro:       '#a855f7',
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

function nodeRadius(inDeg: number): number {
  return Math.min(4 + Math.sqrt(inDeg) * 2, 20);
}

interface SimNode extends CodeGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function ForceGraph({
  nodes,
  edges,
  width = 800,
  height = 600,
  externalSelectedId,
  onNodeClick,
  onNodeSelect,
}: Props): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState({ ox: 0, oy: 0, s: 1 });
  // Keep a ref to current view so mouse-event handlers never close over stale state.
  const viewRef = useRef(view);
  viewRef.current = view;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [nodePosOverride, setNodePosOverride] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (externalSelectedId === undefined) return;
    setSelectedId(externalSelectedId);
    const pos = mergedPosRef.current[externalSelectedId];
    if (pos && width > 0 && height > 0) {
      setView({ ox: width / 2 - pos.x, oy: height / 2 - pos.y, s: 1 });
    }
  }, [externalSelectedId, width, height]);

  const draggingRef = useRef<{
    id: string;
    startSvgX: number;
    startSvgY: number;
    startNodeX: number;
    startNodeY: number;
  } | null>(null);

  const panningRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOx: number;
    startOy: number;
  } | null>(null);

  const { displayNodes, displayEdges, simPositions } = useMemo(() => {
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(cx, cy) * 0.6;

    const sorted = [...nodes].sort((a, b) => b.inDeg - a.inDeg).slice(0, 80);
    const nodeSet = new Set(sorted.map((n) => n.id));
    const filteredEdges = edges
      .filter((e) => nodeSet.has(e.src) && nodeSet.has(e.tgt))
      .slice(0, 200);

    if (sorted.length === 0) {
      return {
        displayNodes: [] as CodeGraphNode[],
        displayEdges: [] as CodeGraphEdge[],
        simPositions: {} as Record<string, { x: number; y: number }>,
      };
    }

    const sim: SimNode[] = sorted.map((n, i) => {
      const angle = (2 * Math.PI * i) / sorted.length;
      return { ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0 };
    });

    const idxMap = new Map(sim.map((n, i) => [n.id, i]));

    const REPULSION = 800;
    const SPRING_LEN = 120;
    const SPRING_K = 0.05;
    const GRAVITY = 0.01;
    const DAMPING = 0.85;

    // Float64Array avoids `number | undefined` from noUncheckedIndexedAccess.
    const fx = new Float64Array(sim.length);
    const fy = new Float64Array(sim.length);

    for (let tick = 0; tick < 300; tick++) {
      fx.fill(0);
      fy.fill(0);

      for (let i = 0; i < sim.length; i++) {
        const ni = sim[i]!;
        for (let j = i + 1; j < sim.length; j++) {
          const nj = sim[j]!;
          const dx = nj.x - ni.x;
          const dy = nj.y - ni.y;
          const dist2 = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(dist2);
          const force = REPULSION / dist2;
          const nx = dx / dist;
          const ny = dy / dist;
          fx[i] = (fx[i] ?? 0) - force * nx;
          fy[i] = (fy[i] ?? 0) - force * ny;
          fx[j] = (fx[j] ?? 0) + force * nx;
          fy[j] = (fy[j] ?? 0) + force * ny;
        }
      }

      for (const edge of filteredEdges) {
        const si = idxMap.get(edge.src);
        const ti = idxMap.get(edge.tgt);
        if (si === undefined || ti === undefined) continue;
        const ns = sim[si]!;
        const nt = sim[ti]!;
        const dx = nt.x - ns.x;
        const dy = nt.y - ns.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = SPRING_K * (dist - SPRING_LEN);
        const nx = dx / dist;
        const ny = dy / dist;
        fx[si] = (fx[si] ?? 0) + force * nx;
        fy[si] = (fy[si] ?? 0) + force * ny;
        fx[ti] = (fx[ti] ?? 0) - force * nx;
        fy[ti] = (fy[ti] ?? 0) - force * ny;
      }

      for (let i = 0; i < sim.length; i++) {
        const n = sim[i]!;
        n.vx = (n.vx + (fx[i] ?? 0) + (cx - n.x) * GRAVITY) * DAMPING;
        n.vy = (n.vy + (fy[i] ?? 0) + (cy - n.y) * GRAVITY) * DAMPING;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    const sp: Record<string, { x: number; y: number }> = {};
    for (const n of sim) sp[n.id] = { x: n.x, y: n.y };

    return { displayNodes: sorted, displayEdges: filteredEdges, simPositions: sp };
  }, [nodes, edges, width, height]);

  // Reset overrides when the underlying data changes.
  useEffect(() => {
    setNodePosOverride({});
  }, [simPositions]);

  const mergedPos = useMemo(() => {
    const merged: Record<string, { x: number; y: number }> = {};
    for (const id of Object.keys(simPositions)) {
      merged[id] = nodePosOverride[id] ?? simPositions[id]!;
    }
    return merged;
  }, [simPositions, nodePosOverride]);

  // Stable ref so the selection-pan effect can read current positions without adding them to deps.
  const mergedPosRef = useRef(mergedPos);
  mergedPosRef.current = mergedPos;

  const adjacentIds = useMemo(() => {
    if (!selectedId) return null;
    const adj = new Set<string>([selectedId]);
    for (const e of displayEdges) {
      if (e.src === selectedId) adj.add(e.tgt);
      if (e.tgt === selectedId) adj.add(e.src);
    }
    return adj;
  }, [selectedId, displayEdges]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, CodeGraphNode>();
    for (const n of displayNodes) m.set(n.id, n);
    return m;
  }, [displayNodes]);

  function clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.ox) / v.s, y: (clientY - rect.top - v.oy) / v.s };
  }

  function handleBgMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return;
    panningRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOx: viewRef.current.ox,
      startOy: viewRef.current.oy,
    };
  }

  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string): void {
    e.stopPropagation();
    if (e.button !== 0) return;
    const svgPos = clientToSvg(e.clientX, e.clientY);
    const np = mergedPos[nodeId];
    draggingRef.current = {
      id: nodeId,
      startSvgX: svgPos.x,
      startSvgY: svgPos.y,
      startNodeX: np?.x ?? 0,
      startNodeY: np?.y ?? 0,
    };
    panningRef.current = null;
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>): void {
    if (draggingRef.current) {
      const svgPos = clientToSvg(e.clientX, e.clientY);
      const { id, startSvgX, startSvgY, startNodeX, startNodeY } = draggingRef.current;
      setNodePosOverride((prev) => ({
        ...prev,
        [id]: { x: startNodeX + svgPos.x - startSvgX, y: startNodeY + svgPos.y - startSvgY },
      }));
    } else if (panningRef.current) {
      const { startClientX, startClientY, startOx, startOy } = panningRef.current;
      setView((v) => ({
        ...v,
        ox: startOx + e.clientX - startClientX,
        oy: startOy + e.clientY - startClientY,
      }));
    }
  }

  function handleSvgMouseUp(): void {
    draggingRef.current = null;
    panningRef.current = null;
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, s: Math.min(Math.max(v.s * factor, 0.1), 5) }));
  }

  const hoverNode = hoverId ? nodeMap.get(hoverId) : undefined;
  const hoverPos = hoverId ? mergedPos[hoverId] : undefined;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="select-none cursor-grab active:cursor-grabbing"
      onMouseMove={handleSvgMouseMove}
      onMouseUp={handleSvgMouseUp}
      onMouseLeave={handleSvgMouseUp}
      onWheel={handleWheel}
    >
      <rect
        width={width}
        height={height}
        fill="transparent"
        onMouseDown={handleBgMouseDown}
        onClick={() => { setSelectedId(null); onNodeSelect?.(null); }}
      />
      <g transform={`translate(${view.ox},${view.oy}) scale(${view.s})`}>
        {displayEdges.map((e, i) => {
          const s = mergedPos[e.src];
          const t = mergedPos[e.tgt];
          if (!s || !t) return null;
          const highlighted =
            selectedId && (e.src === selectedId || e.tgt === selectedId);
          return (
            <line
              key={`${e.src}→${e.tgt}-${i}`}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke="#6b7280"
              strokeOpacity={highlighted ? 0.8 : 0.3}
              strokeWidth={highlighted ? 1.5 : 1}
            />
          );
        })}

        {displayNodes.map((n) => {
          const pos = mergedPos[n.id];
          if (!pos) return null;
          const rad = nodeRadius(n.inDeg);
          const isSelected = n.id === selectedId;
          const dimmed = adjacentIds != null && !adjacentIds.has(n.id);
          return (
            <circle
              key={n.id}
              cx={pos.x}
              cy={pos.y}
              r={rad}
              fill={nodeColor(n)}
              stroke="white"
              strokeWidth={isSelected ? 3 : 1.5}
              opacity={dimmed ? 0.2 : 1}
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={(e) => {
                e.stopPropagation();
                const next = isSelected ? null : n.id;
                setSelectedId(next);
                if (!isSelected) {
                  onNodeClick?.(n);
                  onNodeSelect?.(n);
                } else {
                  onNodeSelect?.(null);
                }
              }}
            />
          );
        })}

        {hoverNode && hoverPos && (() => {
          const rad = nodeRadius(hoverNode.inDeg);
          const label = hoverNode.name || hoverNode.id.split('/').pop() || hoverNode.id;
          const subLabel = hoverNode.kind ? `${hoverNode.kind} · ${hoverNode.file?.split('/').slice(-2).join('/')}` : hoverNode.file;
          const labelW = Math.min(Math.max(label.length, (subLabel ?? '').length) * 6.5 + 12, 360);
          return (
            <g pointerEvents="none">
              <rect
                x={hoverPos.x + rad + 6}
                y={hoverPos.y - 16}
                width={labelW}
                height={subLabel ? 30 : 18}
                rx={3}
                fill="#1f2937"
                opacity={0.92}
              />
              <text x={hoverPos.x + rad + 11} y={hoverPos.y - 3} fontSize={11} fontWeight="600" fill="white">
                {label}
              </text>
              {subLabel && (
                <text x={hoverPos.x + rad + 11} y={hoverPos.y + 11} fontSize={9} fill="#9ca3af">
                  {subLabel}
                </text>
              )}
            </g>
          );
        })()}
      </g>
    </svg>
  );
}
