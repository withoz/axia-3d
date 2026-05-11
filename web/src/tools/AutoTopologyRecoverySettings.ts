/**
 * AutoTopologyRecoverySettings — ADR-097 T-ε.
 *
 * `axia:auto-topology-recovery` — Phase 4 (위상 손상 자동 복구) 의
 * 자동 실행 여부. 토픽 변경 op (Boolean / Push-Pull / Erase / Draw /
 * Material removal) 후 main.ts 가 본 flag 조회 → ON 이면
 * `attemptRecoveryWithDialog` 자동 호출.
 *
 * **Default OFF** (T-A=a 보호 정책): 사용자 데이터 자동 변경의
 * 위험성 (특히 PartialFailure 시 dialog escalation 의 인터럽트) 때문에
 * 첫 phase 는 explicit opt-in. ADR-094 default ON 패턴과 다름 —
 * 094 는 메모리 절감 (시각 불변), 097 는 토폴로지 변경 (시각 가변).
 *
 * Pattern reference: AutoReferenceImportSettings (ADR-096), localStorage
 * 'true' explicit ON preference 보존.
 *
 * Out of scope (별도 sub-step):
 * - T-ζ Real Chromium 시연 + closure
 * - 자동 호출 trigger 의 op-별 세분화 (현재는 main.ts 단일 hook)
 */

const STORAGE_KEY = 'axia:auto-topology-recovery';

let current = false; // Default OFF (T-ε §B-T-J)
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'true') current = true; // explicit ON preference 보존
} catch { /* private mode */ }

const listeners = new Set<(enabled: boolean) => void>();

export function getAutoTopologyRecoveryMode(): boolean {
  return current;
}

export function setAutoTopologyRecoveryMode(value: boolean): void {
  if (current === value) return;
  current = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
  for (const cb of listeners) cb(value);
}

export function onAutoTopologyRecoveryModeChange(
  cb: (enabled: boolean) => void,
): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
