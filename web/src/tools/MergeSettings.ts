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
const STORAGE_KEY_MAT = 'axia:merge:respectMaterial';
const DEFAULT_TOL = 0.5;
const MAX_TOL = 10.0; // 그 이상은 기하학적으로 의미 없음

let current = DEFAULT_TOL;
let respectMaterial = false; // C2 — 재질 경계 존중 여부

// 초기 로드 — localStorage
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const v = parseFloat(saved);
    if (Number.isFinite(v) && v >= 0 && v <= MAX_TOL) current = v;
  }
  const savedMat = localStorage.getItem(STORAGE_KEY_MAT);
  if (savedMat === 'true') respectMaterial = true;
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

/** C2 — 재질 경계 존중 여부 (true면 다른 material의 face는 병합 안 함). */
export function getRespectMaterial(): boolean {
  return respectMaterial;
}

export function setRespectMaterial(value: boolean): void {
  if (value === respectMaterial) return;
  respectMaterial = value;
  try { localStorage.setItem(STORAGE_KEY_MAT, value ? 'true' : 'false'); } catch { /* ignore */ }
}

/**
 * 재질 존중 활성 시 — face 리스트에서 같은 material을 가진 그룹만 병합 후보로 필터.
 * MaterialLibrary와 WasmBridge에 의존하지 않는 순수 함수.
 * 반환: material id → face ids map.
 */
export function groupFacesByMaterial<TFace extends number>(
  faceIds: TFace[],
  getMaterialForFace: (id: TFace) => string | undefined,
): Map<string, TFace[]> {
  const groups = new Map<string, TFace[]>();
  for (const fid of faceIds) {
    const mat = getMaterialForFace(fid) ?? '_default_';
    let arr = groups.get(mat);
    if (!arr) { arr = []; groups.set(mat, arr); }
    arr.push(fid);
  }
  return groups;
}

export const MERGE_TOL_DEFAULT = DEFAULT_TOL;
export const MERGE_TOL_MAX = MAX_TOL;
