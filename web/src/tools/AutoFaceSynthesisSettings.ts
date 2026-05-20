/**
 * AutoFaceSynthesisSettings — ADR-139 B-β-2 (2026-05-18).
 *
 * "auto_face_synthesis_on_draw" — LOCKED #12 ADR-025 P11 Step 4.99 의
 * 자동 cycle face synthesis 토글.
 *
 * **ADR-139 B-β-2 (2026-05-18)**: default `false`. 자동 cycle detection
 * antipattern (메타-원칙 #16) 폐기. Boundary tool (B-γ ~ B-ε) 명시 trigger
 * 로 대체. localStorage `'true'` 명시 시 legacy ON preference 보존
 * (ADR-049 P-5e-α canonical 답습).
 *
 * AutoIntersectSettings 패턴 답습 (ADR-139 B-β-1). localStorage 에 저장.
 * 값 변경 시 bridge 에 즉시 push.
 */

const STORAGE_KEY = 'axia:auto-face-synthesis-on-draw';

// ADR-139 B-β-2: default OFF (메타-원칙 #16 자동화 antipattern 폐기)
let current = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  // legacy ON preference 보존 ('true' 명시 → ON, 'false' 또는 미설정 → OFF)
  if (saved === 'true') current = true;
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
