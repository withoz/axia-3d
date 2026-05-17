/**
 * SpherePathBSettings — ADR-104 β-1-ζ (사용자 결재 2026-05-17).
 *
 * "sphere_path_b_mode" — Sphere 생성 시 Path B (kernel-native 2 hemisphere
 * face / 1 equator edge / 1 vert canonical, 산업 CAD parity, 99%+ 메모리
 * 절감) 또는 legacy Path A (289 face default polygonal mesh) 중 어느 경로
 * 를 사용할지.
 *
 * **Default ON** (β-1-ζ initial activation, 2026-05-17): ADR-094 답습 —
 * 산업 CAD parity (2 face / 1 edge / 1 vert) + 99% 메모리 절감 즉시 활성.
 * 신규 사용자 자동 Path B, 기존 explicit OFF preference
 * (localStorage `'false'`) 보존. ADR-049 P-5e-α / ADR-094 B-η 답습 패턴.
 *
 * Pattern reference: CylinderPathBSettings (ADR-094 B-η) — 1:1 mirror.
 * localStorage 에 저장되어 세션 간 유지. ADR-049 P-5e-α 답습.
 *
 * Production init flow (main.ts):
 *   1. read localStorage `axia:sphere-path-b-mode`
 *   2. on === 'true' (또는 missing → default true) 시
 *      bridge.setSpherePathBDefault(true)
 *   3. WASM 엔진의 `create_sphere` → kernel-native 2-hemisphere 라우팅
 *
 * Out of scope (별도 ADR 후속):
 * - β-2 Cone Path B (ADR-104 §11.1)
 * - β-3 Torus Path B (ADR-104 §11.2)
 */

const STORAGE_KEY = 'axia:sphere-path-b-mode';

let current = true; // β-1-ζ initial: default ON (ADR-094 답습)
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false; // explicit OFF preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getSpherePathBMode(): boolean {
  return current;
}

export function setSpherePathBMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onSpherePathBModeChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
