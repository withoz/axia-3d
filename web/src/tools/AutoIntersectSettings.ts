/**
 * AutoIntersectSettings — Phase 2 전역 토글.
 *
 * "auto_intersect_on_draw" — 새 면을 그린 직후 기존 씬과의 교차선을
 * 자동으로 edge 로 변환 (SketchUp 스타일). 기본 true.
 *
 * localStorage 에 저장되어 세션 간 유지. 값 변경 시 bridge 에 즉시 push.
 */

const STORAGE_KEY = 'axia:auto-intersect-on-draw';

let current = true;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false;
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getAutoIntersect(): boolean {
  return current;
}

export function setAutoIntersect(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onAutoIntersectChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
