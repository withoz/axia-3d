/**
 * OperationLog — record of recent parameter-driven user operations.
 *
 * Tier 3B Phase 1 MVP (2026-04-21): captures last-invocation parameters
 *   so the user can quickly re-run an op with a different value.
 *
 * Tier 3B Phase 2 (2026-04-26 4순위): graph-aware. Each entry now also
 *   records the set of **input** face/edge ids it acted on and the set of
 *   **output** ids it produced. With these, the log builds a directed
 *   dependency graph (op_b depends on op_a iff op_b.inputs ∩ op_a.outputs
 *   ≠ ∅) and exposes:
 *     - getDependents(id) — direct successors
 *     - getCascadeChain(id) — full transitive closure of dependents
 *     - findUpstream(id) — direct predecessors
 *
 *   This is the foundation for downstream auto-recompute (Phase 3 will
 *   wire the cascade into actual replay). The MVP UI still drives a
 *   single re-run; the new API just lets the panel WARN the user how
 *   many downstream ops are about to be invalidated.
 */
export type OperationKind =
  | 'fillet-edge'
  | 'chamfer-edge'
  | 'thicken-faces'
  | 'array-linear'
  | 'array-radial'
  | 'subdivide'
  | 'bend-selection'
  | 'twist-selection'
  | 'taper-selection';

export interface OperationEntry {
  id: number;
  kind: OperationKind;
  displayName: string;  // user-facing, e.g. "Fillet 50mm × 2 edges"
  params: string;        // original prompt string (for re-running prompt pre-fill)
  timestamp: number;
  /** Face/edge ids the op acted on (selection at invocation time). */
  inputs: number[];
  /** Face/edge ids the op produced (best-effort, may be empty if the
   *  caller didn't supply them). Used for dependency-graph traversal. */
  outputs: number[];
}

export class OperationLog {
  private entries: OperationEntry[] = [];
  private nextId = 1;
  private readonly cap: number;
  private listeners: Array<() => void> = [];

  constructor(cap: number = 50) { this.cap = cap; }

  record(
    kind: OperationKind,
    displayName: string,
    params: string,
    io: { inputs?: number[]; outputs?: number[] } = {},
  ): OperationEntry {
    const entry: OperationEntry = {
      id: this.nextId++,
      kind,
      displayName,
      params,
      timestamp: Date.now(),
      inputs: (io.inputs ?? []).slice(),
      outputs: (io.outputs ?? []).slice(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.cap) {
      this.entries.splice(0, this.entries.length - this.cap);
    }
    this.notifyListeners();
    return entry;
  }

  /** All entries, newest last. Callers should reverse for UI display. */
  getAll(): OperationEntry[] { return this.entries.slice(); }

  getById(id: number): OperationEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  clear(): void {
    this.entries = [];
    this.notifyListeners();
  }

  // ── Phase 2 — Dependency graph queries ────────────────────────────

  /** Direct dependents: entries logged AFTER `opId` whose `inputs` intersect
   *  with `opId`'s `outputs`. Empty if the op has no recorded outputs. */
  getDependents(opId: number): OperationEntry[] {
    const op = this.getById(opId);
    if (!op || op.outputs.length === 0) return [];
    const out = new Set(op.outputs);
    return this.entries.filter(e =>
      e.id > opId && e.inputs.some(i => out.has(i))
    );
  }

  /** Transitive closure of dependents: every op directly or indirectly
   *  affected by changes to `opId`. Returned in chronological order. */
  getCascadeChain(opId: number): OperationEntry[] {
    const visited = new Set<number>();
    const result: OperationEntry[] = [];
    const queue: number[] = [opId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const dep of this.getDependents(cur)) {
        if (visited.has(dep.id)) continue;
        visited.add(dep.id);
        result.push(dep);
        queue.push(dep.id);
      }
    }
    result.sort((a, b) => a.id - b.id);
    return result;
  }

  /** Direct upstream: entries logged BEFORE `opId` whose `outputs` intersect
   *  with `opId`'s `inputs`. Useful for "what does this depend on?" UI. */
  findUpstream(opId: number): OperationEntry[] {
    const op = this.getById(opId);
    if (!op || op.inputs.length === 0) return [];
    const inp = new Set(op.inputs);
    return this.entries.filter(e =>
      e.id < opId && e.outputs.some(o => inp.has(o))
    );
  }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notifyListeners(): void {
    for (const l of this.listeners) l();
  }
}

let _singleton: OperationLog | null = null;

export function getOperationLog(): OperationLog {
  if (!_singleton) _singleton = new OperationLog();
  return _singleton;
}
