/**
 * Wire shapes of crew's cross-repo project graph answers (studio#1079, estate#414 slice X3s): the project blast radius
 * with its member coverage and freshness (crew#1476, crew#1555), the path between two symbols (crew#1476) and the
 * possible boundaries (crew#1477). Written by crew `packages/crew/src/projects/graph.ts` (`projectBlastRadius`,
 * `projectGraphPath`, `projectGraphBoundaries`) and served by `packages/crew/src/projects/routes.ts`
 * (`/projects/:id/graph/blast-radius`, `/graph/path`, `/graph/boundaries`). wicked-crew-api-types 0.223.0 names them;
 * studio pins an older api-types, so the fields it lacks are typed here, field for field, until the pin moves.
 */
import type { ProjectBlastRadius, ProjectGraphCrossing, ProjectGraphHit, ProjectGraphLinkage } from './types.js';

/** crew#1476, crew#1477: estate's per-member link coverage; an omitted number is unknown, never 0. */
export interface ProjectGraphMemberCoverage {
  repoId: string;
  repo: string;
  links_in?: number;
  links_out?: number;
  incomplete?: boolean;
  package_imports?: number;
  manifests?: number;
  boundary_counts?: Record<string, number>;
}

/** (crew#1714, wicked-estate >= 0.35.10) An edge from a dependent toward the target. */
export interface ProjectGraphVia {
  id: string;
  kind: string | { other: string };
}

/** A project blast-radius dependent as api-types 0.223.0 has it: the 0.216.0 hit plus estate's depth and drift. */
export interface ProjectGraphHitWire extends ProjectGraphHit {
  /** crew#1555: hops from the target, 1 = direct; absent when estate omits it. */
  depth?: number;
  stale?: 'modified' | 'deleted';
  via?: ProjectGraphVia[];
  via_omitted?: number;
}

/** crew#1555, crew#1556, crew#1797: estate's freshness of the indexed files, attributed to members. */
export interface ProjectBlastRadiusFreshness {
  commits_behind?: number | null;
  indexing?: string[];
  stale_files?: Array<{ repoId: string; repo: string; file: string; status: 'modified' | 'deleted' }>;
  stale_files_total: number;
  /** The total may still count a removed member's files; it is then at most this many. */
  stale_files_total_partial?: true;
  unindexed_files?: number | null;
  checked_files: number;
  not_file_backed: number;
}

/** `GET /projects/:id/graph/blast-radius?name=` as crew 0.223.0's api-types has it. */
export interface ProjectBlastRadiusWire extends Omit<ProjectBlastRadius, 'dependents'> {
  /** crew#1555: false means no symbol by that name. */
  resolved?: boolean;
  freshness?: ProjectBlastRadiusFreshness;
  /** crew#1476: current members' link coverage, when estate names this project. */
  coverage?: ProjectGraphMemberCoverage[];
  dependents: ProjectGraphHitWire[];
}

/** crew#1476: one endpoint of a project path, attributed to a current member. */
export interface ProjectGraphPathEnd {
  repoId: string;
  repo: string;
  symbol: string;
  name: string;
  kind: string;
  file: string;
  /** estate's line_1based. */
  line: number;
}

export interface ProjectGraphPathHop {
  source: ProjectGraphPathEnd;
  target: ProjectGraphPathEnd;
  kind: string;
  confidence?: number;
}

/** crew#1476: `GET /projects/:id/graph/path?from=&to=&maxDepth=`. */
export interface ProjectGraphPath {
  projectId: string;
  from: string;
  to: string;
  found: boolean;
  resolved?: boolean;
  unresolved: 'from' | 'to' | null;
  hops: ProjectGraphPathHop[];
  depth_bounded: boolean;
  node_bounded: boolean;
  crossings?: ProjectGraphCrossing[];
  reposSearched: string[];
  missingRepos: string[];
  linkage: ProjectGraphLinkage;
  note: string;
  /** The route crossed a detached repository; refresh to rebuild without it. */
  excluded?: string;
  coverage?: ProjectGraphMemberCoverage[];
  link_stale?: boolean;
  link_stale_labels?: string[];
}

/** crew#1477: an import estate could not prove is a member link; never an edge. */
export interface ProjectGraphPossible {
  repoId: string;
  repo: string;
  reason: string;
  package: string;
}

/** crew#1477: `GET /projects/:id/graph/boundaries`. */
export interface ProjectGraphBoundaries {
  projectId: string;
  linked: boolean;
  generation?: number;
  stale?: boolean;
  stale_labels?: string[];
  last_error?: string | null;
  members: ProjectGraphMemberCoverage[];
  possible: ProjectGraphPossible[];
  possible_total?: number;
  possible_truncated?: boolean;
  note: string;
}
