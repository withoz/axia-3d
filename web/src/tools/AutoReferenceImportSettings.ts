/**
 * AutoReferenceImportSettings — ADR-096 M-β.
 *
 * "auto_reference_import_mode" — STEP/IGES/OBJ 등 외부 모델 import
 * 결과를 자동으로 ImportedMesh Reference 시민으로 등록할지 여부.
 *
 * **Default ON** (ADR-095 §1.2 약속의 사용자 facing 활성, ADR-049
 * P-5e-α / ADR-094 §E L4 답습 패턴): 신규 사용자 자동 분류, 기존
 * explicit OFF preference (localStorage `'false'`) 보존.
 *
 * Pattern reference: CylinderPathBSettings (ADR-094) — localStorage
 * 에 저장되어 세션 간 유지.
 *
 * Out of scope: Reference 자동 분류 후 *수정 안 함* invariant 강제 →
 * Boolean / Push-Pull / Offset 거부 (ADR-095 R-E lock-in) 는 별도
 * sub-step 또는 ADR.
 */

const STORAGE_KEY = 'axia:auto-reference-import';

let current = true; // Default ON (M-L3)
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'false') current = false; // explicit OFF preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getAutoReferenceImportMode(): boolean {
  return current;
}

export function setAutoReferenceImportMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onAutoReferenceImportModeChange(
  cb: (enabled: boolean) => void,
): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
