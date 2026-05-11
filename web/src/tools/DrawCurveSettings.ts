/**
 * DrawCurveSettings — ADR-089 A-λ-β / A-π-β.
 *
 * "draw_curve_mode" — Draw 도구가 closed-curve (kernel-native, 1
 * self-loop edge with AnalyticCurve) 으로 그릴지, 또는 legacy 24-segment
 * polygon Shape 로 그릴지 결정.
 *
 * **Default ON** (A-π-β, 2026-05-08) — A-ν sweep 2989/2989 PASS 후
 * 사용자 결재. ADR-049 P-5e-α / ADR-087 K-ε hotfix 답습 패턴.
 * 신규 사용자는 자동 kernel-native, 기존 명시 OFF preference (localStorage
 * 'false') 보존.
 *
 * AutoIntersectSettings 패턴 답습. localStorage 에 저장되어 세션 간 유지.
 *
 * Phase 1 scope: DrawCircleTool 만. DrawArc / DrawBezier 등은 future
 * sub-step (별도 ADR-089 sub-step 또는 별도 ADR).
 */

const STORAGE_KEY = 'axia:draw-curve-mode';

let current = true; // A-π-β: default ON
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false; // explicit OFF preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getDrawCurveMode(): boolean {
  return current;
}

export function setDrawCurveMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onDrawCurveModeChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
