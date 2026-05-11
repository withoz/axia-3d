/**
 * EdgeChain — utilities for turning an unordered set of selected edges into
 * an ordered polyline of vertex positions.
 *
 * Used by Revolve/Loft/Sweep actions which all need "these edges, but as
 * a walked-in-order vertex sequence."
 */

import * as THREE from 'three';
import { WasmBridge } from '../bridge/WasmBridge';

/** Ordered polyline extracted from a connected chain of edges. */
export interface EdgeChainResult {
  /** Vertex IDs in walk order. length = edgeIds.length + 1 (open chain). */
  vertIds: number[];
  /** World-space positions matching `vertIds`. */
  positions: THREE.Vector3[];
  /** true if the chain closes on itself (first == last vertex topologically). */
  closed: boolean;
}

/**
 * Try to extract an ordered polyline from the given edge IDs. Returns null
 * when the edge set does not form a simple chain (branching, disconnected,
 * too short, or impossible to resolve against the WASM bridge).
 *
 * A valid open chain has exactly two vertices with degree 1 (the endpoints);
 * every other vertex has degree 2. A valid closed chain has every vertex
 * at degree 2. Anything else is rejected.
 */
export function extractEdgeChain(
  edgeIds: number[],
  bridge: WasmBridge,
): EdgeChainResult | null {
  if (edgeIds.length < 1) return null;

  // vertex → edges it appears on (among the selected set)
  const vertEdges = new Map<number, number[]>();
  const edgeEnds = new Map<number, [number, number]>();

  for (const eid of edgeIds) {
    const ends = bridge.getEdgeEndpoints(eid);
    if (ends.length !== 2) return null;
    const [a, b] = ends;
    edgeEnds.set(eid, [a, b]);
    if (!vertEdges.has(a)) vertEdges.set(a, []);
    if (!vertEdges.has(b)) vertEdges.set(b, []);
    vertEdges.get(a)!.push(eid);
    vertEdges.get(b)!.push(eid);
  }

  // Classify verts by degree
  let endpoints: number[] = [];
  for (const [vid, eids] of vertEdges.entries()) {
    if (eids.length === 1) endpoints.push(vid);
    else if (eids.length !== 2) return null; // branching → not a simple chain
  }

  // Open chain (2 endpoints) vs closed loop (0 endpoints)
  const closed = endpoints.length === 0;
  if (!closed && endpoints.length !== 2) return null;

  // Walk the chain starting at one endpoint (or any vertex if closed)
  const startVert = closed ? vertEdges.keys().next().value : endpoints[0];
  if (startVert == null) return null;

  const visitedEdges = new Set<number>();
  const vertOrder: number[] = [startVert];
  let current = startVert;

  while (visitedEdges.size < edgeIds.length) {
    const incident = vertEdges.get(current) ?? [];
    const nextEdge = incident.find(e => !visitedEdges.has(e));
    if (nextEdge == null) break; // dead end — chain broken
    visitedEdges.add(nextEdge);
    const [a, b] = edgeEnds.get(nextEdge)!;
    const other = a === current ? b : a;
    vertOrder.push(other);
    current = other;
  }

  if (visitedEdges.size !== edgeIds.length) return null; // disconnected

  // For closed chain, remove the trailing duplicate of startVert — the
  // downstream Rust API treats "closed" as a flag; the vertex list should
  // not repeat the closing vertex.
  if (closed && vertOrder.length > 1 && vertOrder[0] === vertOrder[vertOrder.length - 1]) {
    vertOrder.pop();
  }

  // Fetch world positions
  const positions: THREE.Vector3[] = [];
  for (const vid of vertOrder) {
    const p = bridge.getVertexPos(vid);
    if (!p) return null;
    positions.push(new THREE.Vector3(p[0], p[1], p[2]));
  }

  return { vertIds: vertOrder, positions, closed };
}
