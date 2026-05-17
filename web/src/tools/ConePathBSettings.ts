/**
 * ConePathBSettings — ADR-104 β-2-ζ (사용자 결재 2026-05-17).
 *
 * "cone_path_b_mode" — Cone 생성 시 Path B (kernel-native 2 face /
 * 1 edge / 1 vert canonical, 산업 CAD parity, ~92% 메모리 절감) 또는
 * legacy Path A (~25 face polygonal cone) 중 어느 경로를 사용할지.
 *
 * **Default ON** (β-2-ζ initial activation, 2026-05-17): ADR-094 / ADR-113
 * 답습 — 산업 CAD parity (2 face / 1 edge / 1 vert) + 92% 메모리 절감
 * 즉시 활성. 신규 사용자 자동 Path B, 기존 explicit OFF preference
 * (localStorage `'false'`) 보존. ADR-049 P-5e-α / ADR-094 B-η 답습 패턴.
 *
 * Pattern reference: SpherePathBSettings (ADR-104 β-1-ζ) — 1:1 mirror.
 * localStorage 에 저장되어 세션 간 유지.
 *
 * Production init flow (main.ts):
 *   1. read localStorage `axia:cone-path-b-mode`
 *   2. on === 'true' (또는 missing → default true) 시
 *      bridge.setConePathBDefault(true)
 *   3. WASM 엔진의 `create_cone` → kernel-native 2-face 라우팅
 *
 * Out of scope (별도 ADR 후속):
 * - β-3 Torus Path B (ADR-104 §11.2)
 */

const STORAGE_KEY = 'axia:cone-path-b-mode';

let current = true; // β-2-ζ initial: default ON (ADR-094 / ADR-113 답습)
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false; // explicit OFF preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getConePathBMode(): boolean {
  return current;
}

export function setConePathBMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onConePathBModeChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
