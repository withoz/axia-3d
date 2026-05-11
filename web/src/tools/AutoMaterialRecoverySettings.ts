/**
 * AutoMaterialRecoverySettings — ADR-100 R-ε.
 *
 * `axia:auto-material-recovery` — Phase 5-C (재질 손상 자동 복구) 의
 * 자동 실행 여부. Material removal op (removeProjectMaterial / future
 * cascade ops) 후 main.ts 가 본 flag 조회 → ON 이면
 * `attemptMaterialRecoveryWithDialog` 자동 호출.
 *
 * **Default OFF** (R-E lock-in — ADR-097 T-ε 답습): 사용자 데이터
 * 변경의 위험성 (특히 PartialFailure 시 dialog escalation 의 인터럽트)
 * 때문에 첫 phase 는 explicit opt-in. ADR-094 default ON 패턴과 다름.
 *
 * Pattern reference: AutoTopologyRecoverySettings (ADR-097 T-ε) +
 * AutoReferenceImportSettings (ADR-096) — localStorage 'true' explicit
 * ON preference 보존, listener-reactive change events.
 *
 * Out of scope (별도 sub-step):
 * - R-ζ Real Chromium 시연 + closure
 * - 자동 호출 trigger 의 op-별 세분화 (현재는 main.ts 단일 hook)
 */

const STORAGE_KEY = 'axia:auto-material-recovery';

let current = false; // Default OFF (R-E lock-in)
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'true') current = true; // explicit ON preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getAutoMaterialRecoveryMode(): boolean {
  return current;
}

export function setAutoMaterialRecoveryMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onAutoMaterialRecoveryModeChange(
  cb: (enabled: boolean) => void,
): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
