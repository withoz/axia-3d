/**
 * ADR-096 M-β — AutoReferenceImport: STEP/IGES import 결과를 자동으로
 * ImportedMesh Reference 시민으로 등록.
 *
 * Pattern reference:
 * - ADR-091 §E L4 (UI orchestration 분리) — FileImporter 가 직접
 *   bridge 호출 안 하고 본 helper 경유
 * - ADR-095 Phase 3-δ MarkAsReference — humanizeRBViolation 답습
 *   (engine throw → 사용자 facing 한국어 변환)
 *
 * 사용자 facing 가치 (ADR-046 P31 P1 + P3):
 * - P1: STEP 파일 import → 자동 Reference 분류 → "수정 안 함" 의도
 *   명시
 * - P3: AI agent 가 build vs reference 명시 구분 → 의도 차이 차단
 */

import type { WasmBridge } from '../bridge/WasmBridge';

export interface AutoRegisterResult {
  /** True iff Reference 자동 등록 성공 + Settings ON. */
  ok: boolean;
  /** 성공 시 Reference ID. */
  refId?: number;
  /** Reference 이름 (file stem 또는 fallback). */
  refName?: string;
  /** 등록된 face 수 (사용자 facing Toast 활용). */
  faceCount?: number;
  /** 사용자 facing 사유 (실패 또는 skip 시) — Toast 메시지로 활용. */
  reason?: string;
}

export interface AutoRegisterOpts {
  /** Settings flag — caller 가 미리 read 후 전달 (또는 helper 내부에서 read). */
  enabled?: boolean;
  /** Default Reference name fallback (file name 미존재 시). */
  fallbackName?: string;
}

/**
 * ADR-096 M-β — Import 결과를 자동 ImportedMesh Reference 로 등록.
 *
 * @param bridge - WasmBridge instance
 * @param faceIds - 등록할 axia FaceIds (injectIntoAxia 결과)
 * @param fileName - 출처 파일 이름 (예: "site.step"). undefined → fallback
 * @param opts - Settings flag override + name fallback
 * @returns AutoRegisterResult — Toast 활용 가능
 */
export function autoRegisterImportAsReference(
  bridge: WasmBridge,
  faceIds: number[],
  fileName?: string,
  opts: AutoRegisterOpts = {},
): AutoRegisterResult {
  // M-L3: Settings OFF → graceful skip (사용자 OFF preference 존중).
  if (opts.enabled === false) {
    return { ok: false, reason: '자동 Reference 분류 비활성 (Settings)' };
  }

  // Empty face list (defensive).
  if (faceIds.length === 0) {
    return { ok: false, reason: '등록할 face 가 없습니다' };
  }

  // M-L4 / M-L5: name + sourcePath derivation.
  const refName = deriveReferenceName(fileName, opts.fallbackName);
  const sourcePath = fileName ?? undefined;

  try {
    const refId = bridge.createReferenceImportedMesh(
      refName, faceIds, sourcePath,
    );
    return {
      ok: true,
      refId,
      refName,
      faceCount: faceIds.length,
    };
  } catch (e) {
    // M-L6: graceful fallback (bridge missing / R-B violation).
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: humanizeImportFailure(msg),
    };
  }
}

/**
 * File name → Reference name 변환 (M-L5).
 *
 * 예시:
 *   "site.step"          → "site"
 *   "model.iges"         → "model"
 *   "/path/to/site.step" → "site"
 *   undefined            → fallback (default "Imported Mesh")
 */
function deriveReferenceName(fileName?: string, fallback?: string): string {
  if (!fileName) return fallback ?? 'Imported Mesh';
  // Strip path (last separator).
  const lastSlash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? fileName.slice(lastSlash + 1) : fileName;
  // Strip extension (last dot).
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  return stem.length > 0 ? stem : (fallback ?? 'Imported Mesh');
}

/**
 * Import 실패 시 사용자 facing 한국어 변환 (M-L6, ADR-095 §E L3 답습).
 */
function humanizeImportFailure(engineMsg: string): string {
  if (engineMsg.includes('WASM endpoint missing')) {
    return '엔진 미준비 — 페이지 새로고침이 필요합니다';
  }
  if (engineMsg.includes('owned by a Xia')) {
    return '면이 이미 다른 객체에 속해 있어 자동 Reference 분류 실패';
  }
  if (engineMsg.includes('owned by a Shape')) {
    return '면이 이미 형태 (Shape) 에 속해 있어 자동 Reference 분류 실패';
  }
  if (engineMsg.includes('already owned by Reference')) {
    return '이미 다른 Reference 에 등록되어 있습니다';
  }
  return engineMsg;
}
