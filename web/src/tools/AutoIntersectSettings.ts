/**
 * AutoIntersectSettings — Phase 2 전역 토글.
 *
 * "auto_intersect_on_draw" — 새 면을 그린 직후 기존 씬과의 교차선을
 * 자동으로 edge 로 변환 (SketchUp 스타일).
 *
 * **ADR-139 B-β-1 (2026-05-18)**: default `false`. 자동 trigger
 * antipattern (메타-원칙 #16, P5.UX.39-45 cascading fixes evidence) 폐기.
 * Boundary tool 명시 only 정책 정합. localStorage `'true'` 명시 시 legacy
 * ON preference 보존 (ADR-049 P-5e-α canonical 답습).
 *
 * localStorage 에 저장되어 세션 간 유지. 값 변경 시 bridge 에 즉시 push.
 */

const STORAGE_KEY = 'axia:auto-intersect-on-draw';

// ADR-139 B-β-1: default OFF (메타-원칙 #16 자동화 antipattern 폐기)
let current = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  // ADR-049 P-5e-α canonical 답습: legacy ON preference 보존
  // ('true' 명시 → ON, 'false' 또는 미설정 → OFF default)
  if (saved === 'true') current = true;
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
