import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { KnowledgeMapEdge, KnowledgeMapNode } from '../../api/knowledgeShapes.js';
import { resolveToken } from '../../styles/resolveToken.js';

cytoscape.use(fcose as Parameters<typeof cytoscape.use>[0]);

/**
 * The Knowledge map drawn (DES-KNOWLEDGE-DATA-001 §10.3): sources and their tables, repositories and their code, and
 * the approved data shapes between them. Each kind has its own shape AND colour, each typed edge its own line style
 * AND its name on the line, so nothing is told by colour alone (the list beside it says the same in words).
 */
const NODE_TOKENS: Record<KnowledgeMapNode['kind'], string> = {
  source: '--status-gate',
  table: '--accent-dim',
  shape: '--accent',
  code: '--status-run',
  repo: '--ink-muted',
  knowledge: '--ink-muted',
};
const NODE_SHAPES: Record<KnowledgeMapNode['kind'], cytoscape.Css.NodeShape> = {
  source: 'round-rectangle',
  table: 'rectangle',
  shape: 'diamond',
  code: 'ellipse',
  repo: 'hexagon',
  knowledge: 'ellipse',
};
const NODE_SIZE: Record<KnowledgeMapNode['kind'], number> = { source: 34, table: 24, shape: 26, code: 22, repo: 30, knowledge: 18 };

/** The typed relations drawn with their name; `contains` and `derived_from` are drawn faint and unnamed. */
export const NAMED_RELS: ReadonlySet<string> = new Set(['describes', 'joins', 'governed_by', 'measures', 'tracked_in', 'addresses', 'closes']);

export function KnowledgeGraph({ nodes, edges, onSelect }: {
  nodes: readonly KnowledgeMapNode[];
  edges: readonly KnowledgeMapEdge[];
  onSelect?: (node: KnowledgeMapNode | null) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (ref.current === null) return undefined;
    const idOf = new Map(nodes.map((n, i) => [n.key, `n${i}`]));
    const ink = resolveToken('--ink-high');
    const faint = resolveToken('--ink-dim');
    const elements: cytoscape.ElementDefinition[] = [
      ...nodes.map((n) => ({
        group: 'nodes' as const,
        data: { id: idOf.get(n.key)!, label: n.label, color: resolveToken(NODE_TOKENS[n.kind]), shape: NODE_SHAPES[n.kind], size: NODE_SIZE[n.kind], kind: n.kind, raw: n },
      })),
      ...edges
        .filter((e) => idOf.has(e.from) && idOf.has(e.to))
        .map((e, i) => ({
          group: 'edges' as const,
          data: { id: `e${i}`, source: idOf.get(e.from)!, target: idOf.get(e.to)!, rel: e.rel, label: NAMED_RELS.has(e.rel) ? e.rel.replace('_', ' ') : '' },
          classes: NAMED_RELS.has(e.rel) ? `typed rel-${e.rel}` : 'quiet',
        })),
    ];
    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            shape: 'data(shape)' as never,
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            'font-size': 11,
            'font-family': 'ui-sans-serif, system-ui, sans-serif',
            color: ink,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'text-max-width': '140px',
            'text-wrap': 'ellipsis',
            'text-background-color': resolveToken('--surface-base'),
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
          },
        },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': resolveToken('--accent') } },
        { selector: 'edge', style: { width: 1, 'curve-style': 'bezier', 'line-color': faint, 'target-arrow-color': faint, 'target-arrow-shape': 'none', opacity: 0.45 } },
        {
          selector: 'edge.typed',
          style: {
            width: 2,
            opacity: 0.95,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            label: 'data(label)',
            'font-size': 10,
            color: ink,
            'text-rotation': 'autorotate',
            'text-background-color': resolveToken('--surface-base'),
            'text-background-opacity': 0.9,
            'text-background-padding': '2px',
          },
        },
        { selector: 'edge.rel-joins', style: { 'line-color': resolveToken('--accent'), 'target-arrow-color': resolveToken('--accent'), 'line-style': 'solid' } },
        { selector: 'edge.rel-describes', style: { 'line-color': resolveToken('--status-run'), 'target-arrow-color': resolveToken('--status-run'), 'line-style': 'dashed' } },
        { selector: 'edge.rel-governed_by', style: { 'line-color': resolveToken('--status-gate'), 'target-arrow-color': resolveToken('--status-gate'), 'line-style': 'dotted', width: 3 } },
      ],
      layout: { name: 'fcose', animate: false, randomize: true, quality: 'default', idealEdgeLength: 140, nodeRepulsion: 20000, numIter: 2500, nodeSeparation: 100 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 3,
    });
    cy.on('tap', 'node', (evt) => onSelectRef.current?.(evt.target.data('raw') as KnowledgeMapNode));
    cy.on('tap', (evt) => {
      if (evt.target === cy) onSelectRef.current?.(null);
    });
    cy.ready(() => {
      if (!cy.destroyed()) cy.fit(undefined, 32);
    });
    return () => cy.destroy();
  }, [nodes, edges]);

  return <div ref={ref} className="wk-know-graph" data-testid="knowledge-graph-canvas" role="img" aria-label="The knowledge map: sources, tables, repositories, code and data shapes" />;
}
