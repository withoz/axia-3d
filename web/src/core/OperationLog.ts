/**
 * OperationLog — record of recent parameter-driven user operations.
 *
 * Tier 3B Phase 1 MVP: not a full parametric feature tree (which would
 * require every operation to be replayable-from-scratch with modified
 * inputs). Instead, this captures only "last invocation parameters" so
 * the user can quickly re-run an operation with a different value via
 * the History panel.
 *
 * Design:
 *   - Append-only ring buffer (cap=50) of {id, kind, params, displayName, ts}
 *   - Kinds that get logged: fillet / chamfer / thicken / array-linear /
 *     array-radial / subdivide. (Draw/Push-Pull are interactive; less
 *     useful to "re-run" since user visually placed the geometry.)
 *   - Listeners for UI to refresh.
 *   - No persistence across page reloads (MVP). Future: serialize to
 *     AXIA file appendix.
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
}

export class OperationLog {
  private entries: OperationEntry[] = [];
  private nextId = 1;
  private readonly cap: number;
  private listeners: Array<() => void> = [];

  constructor(cap: number = 50) { this.cap = cap; }

  record(kind: OperationKind, displayName: string, params: string): OperationEntry {
    const entry: OperationEntry = {
      id: this.nextId++,
      kind,
      displayName,
      params,
      timestamp: Date.now(),
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
