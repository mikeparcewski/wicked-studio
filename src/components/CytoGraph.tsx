import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { CodeGraphNode, CodeGraphEdge } from '../api/types.js';

cytoscape.use(fcose as Parameters<typeof cytoscape.use>[0]);

interface Props {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  externalSelectedId?: string | null;
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

function nodeSize(inDeg: number): number {
  return Math.round(Math.min(20 + Math.sqrt(inDeg) * 6, 60));
}

export function CytoGraph({ nodes, edges, externalSelectedId, onNodeClick, onNodeSelect }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cy, setCy] = useState<cytoscape.Core | null>(null);
  // Maps original estate symbol ID → safe Cytoscape element ID ("n0", "n1", …).
  const cyIdMapRef = useRef<Map<string, string>>(new Map());
  // Callback refs so event handlers always call the latest version without rebuilding the graph.
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeSelectRef = useRef(onNodeSelect);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    onNodeSelectRef.current = onNodeSelect;
  }, [onNodeClick, onNodeSelect]);

  // Build/rebuild the graph when data changes.
  useEffect(() => {
    if (!containerRef.current) return;

    // Map original estate symbol IDs (which contain spaces, #, ., etc.) to
    // safe numeric Cytoscape IDs ("n0", "n1", …). Cytoscape resolves edge
    // source/target by data.id using an internal lookup that is sensitive to
    // certain special characters in the ID string — using plain numeric IDs
    // eliminates all such issues while keeping original IDs in data for callbacks.
    const cyIdOf = new Map(nodes.map((n, i) => [n.id, `n${i}`]));
    cyIdMapRef.current = cyIdOf;

    const elements: cytoscape.ElementDefinition[] = [
      ...nodes.map((n) => ({
        group: 'nodes' as const,
        data: {
          id: cyIdOf.get(n.id)!,
          label: n.name || n.id.split('/').pop() || n.id,
          color: nodeColor(n),
          size: nodeSize(n.inDeg),
          kind: n.kind,
          file: n.file,
          inDeg: n.inDeg,
          outDeg: n.outDeg,
          raw: n,
        },
      })),
      // Only include edges where both endpoints are in the visible node set.
      ...edges
        .filter((e) => cyIdOf.has(e.src) && cyIdOf.has(e.tgt))
        .map((e, i) => ({
          group: 'edges' as const,
          data: {
            id: `e${i}`,
            source: cyIdOf.get(e.src)!,
            target: cyIdOf.get(e.tgt)!,
          },
        })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': 10,
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#ffffff',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-outline-color': 'data(color)',
            'text-outline-width': 2,
            'text-max-width': '120px',
            'text-wrap': 'ellipsis',
            width: 'data(size)',
            height: 'data(size)',
            'border-width': 0,
            'overlay-padding': 4,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#fbbf24',
            'border-opacity': 1,
          },
        },
        {
          selector: 'node.dimmed',
          style: { opacity: 0.15 },
        },
        {
          selector: 'node.highlighted',
          style: { opacity: 1 },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#cbd5e1',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7,
            'curve-style': 'bezier',
            opacity: 0.5,
          },
        },
        {
          selector: 'edge.highlighted',
          style: { 'line-color': '#fbbf24', 'target-arrow-color': '#fbbf24', opacity: 0.9, width: 2 },
        },
        {
          selector: 'edge.dimmed',
          style: { opacity: 0.05 },
        },
      ],
      layout: {
        name: 'fcose',
        animate: false,
        quality: 'default',
        randomize: true,
        idealEdgeLength: 120,
        nodeRepulsion: 8000,
        numIter: 2500,
        nodeSeparation: 60,
      } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
    });

    cy.on('tap', 'node', (evt) => {
      const raw = evt.target.data('raw') as CodeGraphNode;
      onNodeClickRef.current?.(raw);
      onNodeSelectRef.current?.(raw);

      cy.elements().removeClass('highlighted dimmed');
      const neighbourhood = evt.target.closedNeighborhood();
      cy.elements().addClass('dimmed');
      neighbourhood.removeClass('dimmed').addClass('highlighted');
      evt.target.select();
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass('highlighted dimmed');
        cy.elements('node').unselect();
        onNodeSelectRef.current?.(null);
      }
    });

    cy.ready(() => { if (!cy.destroyed()) cy.fit(undefined, 40); });

    setCy(cy);
    return () => {
      cy.destroy();
      setCy(null);
    };
  }, [nodes, edges]);

  // Sync external selection without rebuilding.
  useEffect(() => {
    if (!cy) return;
    // The selection effect can fire after the instance was torn down (modal close /
    // re-render race) — cytoscape then throws "Cannot read properties of null
    // (reading 'isHeadless')" from inside animate(), which the ErrorBoundary turns
    // into a full error screen on node click. A destroyed cy is a no-op, not a crash.
    if (cy.destroyed()) return;
    cy.elements('node').unselect();
    cy.elements().removeClass('highlighted dimmed');
    if (externalSelectedId) {
      const safeCyId = cyIdMapRef.current.get(externalSelectedId) ?? externalSelectedId;
      const target = cy.$id(safeCyId);
      if (target.length) {
        target.select();
        const neighbourhood = target.closedNeighborhood();
        cy.elements().addClass('dimmed');
        neighbourhood.removeClass('dimmed').addClass('highlighted');
        if (!cy.destroyed()) {
          cy.animate({ fit: { eles: neighbourhood, padding: 60 }, duration: 300 });
        }
      }
    }
  }, [cy, externalSelectedId]);

  return <div ref={containerRef} className="w-full h-full" />;
}
