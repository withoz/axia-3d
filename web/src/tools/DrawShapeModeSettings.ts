/**
 * ADR-050 P-5d — Draw Shape Mode (Two-Layer Citizenship opt-in).
 *
 * When enabled, the 3 core Draw tools (Rect / Line / Circle) call the
 * As-Shape WASM bridge variants (P-5c) to create form-layer Shapes
 * instead of property-layer Xias.
 *
 * Default: `false` — legacy Xia path stays the default. The user
 * opts in via the SettingsPanel checkbox. P-5e will flip the default
 * after the LOCKED #1 / #26 migration completes.
 *
 * Mirrors `AutoIntersectSettings.ts` — module-level state + getter /
 * setter / listener registration + localStorage persistence.
 *
 * Cross-references:
 * - ADR-050 §B P-5d lock-ins (default false, drop-in alongside)
 * - LOCKED #26 Phase 1 (Two-Layer Citizenship Model)
 */

const STORAGE_KEY = 'axia:draw-shape-mode';

let current = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  // Strict 'true' / 'false' — anything else (including null) keeps default.
  if (saved === 'true') current = true;
} catch {
  /* private mode */
}

const listeners = new Set<(enabled: boolean) => void>();

/**
 * Returns the current Draw Shape Mode flag.
 * `true` → tools create form-layer Shape (P-5c bridge).
 * `false` → tools create property-layer Xia (legacy default).
 */
export function getDrawShapeMode(): boolean {
  return current;
}

/**
 * Set the Draw Shape Mode flag. Persists to localStorage and notifies
 * all registered listeners. No-op when the value is unchanged.
 */
export function setDrawShapeMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* ignore */
  }
  for (const cb of listeners) cb(value);
}

/**
 * Register a listener that fires whenever the flag changes. Returns
 * an unregister function for cleanup.
 */
export function onDrawShapeModeChange(
  cb: (enabled: boolean) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
