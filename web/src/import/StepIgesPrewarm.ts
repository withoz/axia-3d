/**
 * StepIgesPrewarm — ADR-118 γ-7 (γ-4 component): background pre-warm of
 * OCCT.js so user-facing Import STEP/IGES wait is perceived 0s when init
 * completes before user clicks Import.
 *
 * Anchor (사용자 결재 2026-05-17): "추천대로 승인합니다" (γ-7 = γ-1
 * streaming + γ-4 pre-warm 묶음).
 *
 * **Strategy**:
 * - Page load 직후 `requestIdleCallback` (fallback `setTimeout 2000ms`)
 *   으로 background OCCT init 시작
 * - 사용자가 File → Import STEP 클릭 시 이미 완료 / 진행 중 →
 *   `ensureLoaded()` 가 캐시된 instance 즉시 반환 또는 진행 중 promise
 *   재사용 (StepIgesImporter singleton 자연 동작)
 * - localStorage `axia:step-iges-prewarm = 'false'` 명시 시 opt-out
 *   (metered connection / 메모리 절약 사용자)
 *
 * **Bundle 정합**:
 * - Initial bundle 0MB strict 유지 (ADR-035 P20.C #2) — StepIgesImporter
 *   는 이미 lazy chunk (opencascade-deps 5.37 MB)
 * - Pre-warm 도 동일한 lazy chunk dynamic import 사용 — bundle 영향 0
 *
 * **사용자 facing 변화**:
 * - Before: Import 클릭 → 180s wait → file dialog 사용 가능
 * - After (default ON): Page load + 5s idle → background init 진행 →
 *   Import 클릭 시점에 이미 ~80% 완료 평균 → ~30s wait (cold first visit)
 * - Return visits (HTTP cache warm): ~5-10s
 *
 * Cross-link: ADR-085 (Toast progress 보존, background init 도 stage
 * 진행 표시), ADR-082 Drift #5 (본질 해소), ADR-118 (architectural spec).
 */

import { debugLog, debugWarn } from '../utils/debug';

const STORAGE_KEY = 'axia:step-iges-prewarm';

/**
 * Pre-warm 활성 여부 (default ON). localStorage `'false'` 명시 시 opt-out.
 *
 * Pattern reference: SpherePathBSettings / CylinderPathBSettings.
 */
export function getPrewarmEnabled(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved !== 'false'; // default ON
  } catch {
    return true; // private mode → default ON
  }
}

/**
 * Pre-warm flag 변경 (사용자 설정 UI 에서 호출). localStorage 에 persist.
 */
export function setPrewarmEnabled(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch { /* ignore */ }
}

let _prewarmStarted = false;

/**
 * Page load 직후 호출 — `requestIdleCallback` (fallback `setTimeout`)
 * 으로 background 에서 OCCT init 시작.
 *
 * Idempotent: 두 번째 호출은 no-op (싱글톤 `StepIgesImporter` 가 cache).
 *
 * **Graceful failure**: opencascade.js 미설치 / 네트워크 실패 시 silent
 * skip — 사용자가 명시적으로 Import 클릭 시 standard error message 표시
 * (StepIgesImporter.importFile 의 graceful 분기 답습).
 */
export function prewarmStepIgesEngine(): void {
  if (_prewarmStarted) {
    debugLog('[StepIgesPrewarm] already started — skip');
    return;
  }

  if (!getPrewarmEnabled()) {
    debugLog('[StepIgesPrewarm] disabled via localStorage — skip');
    return;
  }

  _prewarmStarted = true;

  const startInit = async (): Promise<void> => {
    debugLog('[StepIgesPrewarm] starting background OCCT init');
    try {
      // ADR-118 γ-1 (implicit): dynamic import 가 Vite 의 lazy chunk
      // loader 를 통해 `StepIgesImporter` + `opencascade-deps` chunk
      // 를 fetch — 브라우저 HTTP/2 multiplexing 으로 모든 WASM module
      // 자동 parallel fetch. Explicit `compileStreaming` 은 opencascade.js
      // vendor 의 internal WASM loader 가 controll 하므로 본 wrapper
      // 에서는 vendor 의 best-effort 동작에 의존. WebAssembly streaming
      // 활성은 modern browser 의 자동 동작 (Content-Type: application/
      // wasm + Response 객체 → instantiateStreaming).
      const { StepIgesImporter } = await import('./StepIgesImporter');
      const importer = StepIgesImporter.getInstance();
      // ensureLoaded 가 promise cache — 사용자가 Import 클릭 시 동일
      // promise 가 resolve 됨 (또는 이미 resolved 상태).
      await importer.ensureLoaded();
      debugLog('[StepIgesPrewarm] OCCT ready (pre-warm complete)');
    } catch (e) {
      // Silent skip — opencascade.js 미설치 / 네트워크 실패 등.
      // 사용자가 명시 Import 시 standard error 처리.
      debugWarn('[StepIgesPrewarm] init failed (graceful skip):', e);
    }
  };

  // requestIdleCallback 우선 (modern browsers). 미지원 시 setTimeout 2s.
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    // 5s timeout — page idle 안 와도 5s 후 강제 시작 (인터랙티브 페이지
    // 에서도 background init 보장).
    w.requestIdleCallback(startInit, { timeout: 5000 });
  } else {
    // Fallback: 2s 지연 (initial render + viewport setup 후).
    setTimeout(startInit, 2000);
  }
}

/**
 * 테스트용 reset. 다음 prewarmStepIgesEngine 호출이 다시 init 시작.
 */
export function resetPrewarmForTest(): void {
  _prewarmStarted = false;
}
