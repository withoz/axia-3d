/**
 * AutoIntersectSettings — Phase 2 전역 토글.
 *
 * "auto_intersect_on_draw" — 새 면을 그린 직후 기존 씬과의 교차선을
 * 자동으로 edge 로 변환 (SketchUp 스타일).
 *
 * **ADR-139 B-β-1 (2026-05-18)**: engine default `false`. 자동 trigger
 * antipattern (메타-원칙 #16, P5.UX.39-45 cascading fixes evidence) 폐기.
 *
 * **ADR-176 (2026-06-01, 사용자 결재 "둘 다 고침")**: **production default
 * ON**. Phase 1-4 (ADR-169~173) 가 absorb 파이프라인을 견고하게 만든 후
 * "선만 그려, 케이크는 알아서 나뉜다" 비전 활성. Engine default 는 OFF
 * 유지 (회귀 자산 300+ 보존, ADR-049 P-5e-α canonical — engine OFF +
 * production ON). localStorage `'false'` 명시 시 OFF preference 보존.
 *
 * localStorage 에 저장되어 세션 간 유지. 값 변경 시 bridge 에 즉시 push.
 */

const STORAGE_KEY = 'axia:auto-intersect-on-draw';

// ADR-176: production default ON (사용자 결재 2026-06-01). engine default
// 는 scene.rs 에서 OFF 유지 — production 만 ON via main.ts wiring.
let current = true;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  // ADR-049 P-5e-α canonical 답습: explicit OFF preference 보존
  // ('false' 명시 → OFF, 'true' 또는 미설정 → ON default)
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
