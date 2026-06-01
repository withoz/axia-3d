/**
 * AutoFaceSynthesisSettings — ADR-139 B-β-2 (2026-05-18).
 *
 * "auto_face_synthesis_on_draw" — LOCKED #12 ADR-025 P11 Step 4.99 의
 * 자동 cycle face synthesis 토글.
 *
 * **ADR-139 B-β-2 (2026-05-18)**: engine default `false`. 자동 cycle
 * detection antipattern (메타-원칙 #16) 폐기.
 *
 * **ADR-176 (2026-06-01, 사용자 결재 "둘 다 고침")**: **production default
 * ON**. Phase 1-4 (ADR-169~173) 견고화 후 "선만 그려, 케이크는 알아서
 * 나뉜다" 비전 활성. Engine default 는 scene.rs 에서 OFF 유지 (회귀 자산
 * 보존, ADR-049 P-5e-α canonical). localStorage `'false'` 명시 시 OFF
 * preference 보존.
 *
 * AutoIntersectSettings 패턴 답습 (ADR-176). localStorage 에 저장.
 * 값 변경 시 bridge 에 즉시 push.
 */

const STORAGE_KEY = 'axia:auto-face-synthesis-on-draw';

// ADR-176: production default ON (사용자 결재 2026-06-01). engine default
// 는 scene.rs 에서 OFF 유지 — production 만 ON via main.ts wiring.
let current = true;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  // ADR-049 P-5e-α canonical: explicit OFF preference 보존
  // ('false' 명시 → OFF, 'true' 또는 미설정 → ON default)
  if (saved === 'false') current = false;
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getAutoFaceSynthesis(): boolean {
  return current;
}

export function setAutoFaceSynthesis(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onAutoFaceSynthesisChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
