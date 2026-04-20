/**
 * MergeSettings — 전역 face-merge 설정 (현재는 angle tolerance만).
 *
 * 기본값: 0.5° (CAD-grade strict).
 * 사용자가 설정 UI에서 조정하면 localStorage에 저장되고 bridge 호출에 전달됨.
 *
 * 안전성: 기본값(0.5)은 기존 `are_faces_coplanar_strict`와 동일 →
 *         설정 미터치 시 동작 변화 없음.
 */

const STORAGE_KEY = 'axia:merge:angleTolDeg';
const DEFAULT_TOL = 0.5;
const MAX_TOL = 10.0; // 그 이상은 기하학적으로 의미 없음

let current = DEFAULT_TOL;

// 초기 로드 — localStorage
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const v = parseFloat(saved);
    if (Number.isFinite(v) && v >= 0 && v <= MAX_TOL) current = v;
  }
} catch { /* private mode */ }

const listeners = new Set<(tol: number) => void>();

export function getMergeTolerance(): number {
  return current;
}

export function setMergeTolerance(value: number): void {
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(0, Math.min(MAX_TOL, value));
  if (clamped === current) return;
  current = clamped;
  try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  for (const fn of listeners) fn(clamped);
}

export function onMergeToleranceChange(fn: (tol: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const MERGE_TOL_DEFAULT = DEFAULT_TOL;
export const MERGE_TOL_MAX = MAX_TOL;
