/**
 * CylinderPathBSettings — ADR-094 B-η.
 *
 * "cylinder_path_b_mode" — Cylinder 생성 시 Path B (kernel-native
 * 3 face / 2 edge / 2 vert annulus topology, 산업 CAD parity, ~98%
 * 메모리 절감) 또는 legacy Path A (25 face polygon strip) 중 어느
 * 경로를 사용할지.
 *
 * **Default ON** (B-θ user retrospective 7/7 PASS 후, 2026-05-09):
 * 산업 CAD parity (3 face / 2 edge / 2 vert) + 95%+ 메모리 절감 즉시
 * 활성. 신규 사용자 자동 Path B, 기존 explicit OFF preference
 * (localStorage `'false'`) 보존. ADR-049 P-5e-α / ADR-087 K-ε hotfix
 * 답습 패턴.
 *
 * Pattern reference: DrawCurveSettings (ADR-089 A-λ-β/π-β) — localStorage
 * 에 저장되어 세션 간 유지. ADR-049 P-5e-α 답습.
 *
 * Production init flow (main.ts):
 *   1. read localStorage `axia:cylinder-path-b-mode`
 *   2. on === 'true' 시 bridge.setCylinderPathBDefault(true)
 *   3. WASM 엔진이 createSolidExtrude → kernel-native annulus 라우팅
 *
 * Out of scope: 사용자 시연 PASS 후 default 를 ON 으로 flip 하는 별도
 * 결재 (ADR-094 §10 — multi-gate, B-θ 또는 별도 phase).
 */

const STORAGE_KEY = 'axia:cylinder-path-b-mode';

let current = true; // B-θ post-retrospective: default ON
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false; // explicit OFF preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getCylinderPathBMode(): boolean {
  return current;
}

export function setCylinderPathBMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onCylinderPathBModeChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
