/**
 * TorusPathBSettings — ADR-104 β-3-ζ (사용자 결재 2026-05-17).
 *
 * "torus_path_b_mode" — Torus 생성 시 Path B (kernel-native 1 face /
 * 1 edge / 1 vert canonical, ~99.7% 메모리 절감) 활성 여부. Torus 는
 * Path A polygonal baseline 이 없어 kernel-native from day 1 — flag 는
 * 패턴 consistency (sphere/cone 답습) 위한 future Path A 분기 hook.
 *
 * **Default ON** (β-3-ζ initial activation, 2026-05-17): ADR-094 /
 * ADR-113 / ADR-114 답습. 신규 사용자 자동 Path B (사실 유일 path).
 * explicit OFF preference (localStorage `'false'`) 보존.
 *
 * Pattern reference: SpherePathBSettings (β-1-ζ) / ConePathBSettings
 * (β-2-ζ) 1:1 mirror.
 *
 * Production init flow (main.ts):
 *   1. read localStorage `axia:torus-path-b-mode`
 *   2. on === 'true' (또는 missing → default true) 시
 *      bridge.setTorusPathBDefault(true)
 *   3. WASM 엔진의 `createTorus` 는 항상 kernel-native 라우팅
 *
 * ADR-104 Path B family closure (cylinder + sphere + cone + torus).
 */

const STORAGE_KEY = 'axia:torus-path-b-mode';

let current = true; // β-3-ζ initial: default ON
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false; // explicit OFF preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getTorusPathBMode(): boolean {
  return current;
}

export function setTorusPathBMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onTorusPathBModeChange(cb: (enabled: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
