/**
 * ADR-050 P-5d / P-5e-α — Draw Shape Mode (Two-Layer Citizenship).
 *
 * When enabled, the 3 core Draw tools (Rect / Line / Circle) call the
 * As-Shape WASM bridge variants (P-5c) to create form-layer Shapes
 * instead of property-layer Xias.
 *
 * **P-5e-α default flip (2026-05-05)**: default flipped from `false`
 * to `true`. New users now default to form-layer Shape draws (ADR-049
 * §4 Q3 — Two-Layer Citizenship as the engine's primary mental model).
 * Existing users who explicitly toggled OFF have `localStorage
 * 'axia:draw-shape-mode' = 'false'` and that preference is preserved
 * (backward compat).
 *
 * Mirrors `AutoIntersectSettings.ts` — module-level state + getter /
 * setter / listener registration + localStorage persistence.
 *
 * Cross-references:
 * - ADR-050 §B P-5d lock-ins (default flip per P-5e-α)
 * - LOCKED #26 Phase 1 (Two-Layer Citizenship Model)
 */

const STORAGE_KEY = 'axia:draw-shape-mode';

let current = true; // ADR-050 P-5e-α default flip (2026-05-05).
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  // Strict 'true' / 'false' — anything else (including null) keeps default.
  // Existing users who explicitly opted OFF have 'false' stored and that
  // preference is honored across the default flip.
  if (saved === 'false') current = false;
  else if (saved === 'true') current = true;
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
