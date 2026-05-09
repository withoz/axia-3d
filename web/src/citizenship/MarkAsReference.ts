/**
 * ADR-095 Phase 3-δ — Reference 시민권 UI orchestration helper.
 *
 * 사용자가 explicit "참조로 표시 (Mark as Reference)" 액션을 트리거할
 * 때 bridge.createReference* 의 R-B violation 처리 + 사용자 facing
 * Toast 메시지 변환 + 결과 inspection 의 single point.
 *
 * Pattern reference: ADR-091 §E L4 (UI orchestration 분리) — Inspector
 * 또는 ContextMenu 가 직접 bridge 호출하지 않고 본 모듈을 경유.
 * jsdom 단위 테스트 격리 + 다중 trigger point SSOT 보장.
 *
 * 3 Reference categories (ADR-095 §2.1):
 * - ConstructionLine — 작도선 (edges)
 * - ImportedMesh — STEP/IGES/OBJ import (faces + source path)
 * - PointCloud — 스캔 데이터 (verts)
 */

import type { WasmBridge } from '../bridge/WasmBridge';

export interface MarkResult {
  /** True iff Reference 생성 성공. */
  ok: boolean;
  /** 성공 시 Reference ID. 실패 시 undefined. */
  refId?: number;
  /** 사용자 facing 사유 (실패 시) — Toast 메시지로 활용 가능. */
  reason?: string;
}

/**
 * ADR-095 Phase 3-δ — N개 face 를 ImportedMesh Reference 로 표시.
 *
 * R-B violation (face 가 Form/Property 시민에 소유) 시 strict 거부.
 * 사용자 facing 메시지: 한국어 (Inspector / Toast 직접 표시 가능).
 *
 * @param bridge — WasmBridge instance
 * @param faceIds — 표시할 face IDs
 * @param name — Reference 이름 (default: "Imported Mesh")
 * @param sourcePath — 출처 파일 경로 (optional)
 */
export function markFacesAsReference(
  bridge: WasmBridge,
  faceIds: number[],
  name: string = 'Imported Mesh',
  sourcePath?: string,
): MarkResult {
  if (faceIds.length === 0) {
    return { ok: false, reason: '선택된 면이 없습니다' };
  }
  try {
    const refId = bridge.createReferenceImportedMesh(name, faceIds, sourcePath);
    return { ok: true, refId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: humanizeRBViolation(msg) };
  }
}

/**
 * ADR-095 Phase 3-δ — N개 edge 를 ConstructionLine Reference 로 표시.
 *
 * 작도선 (construction line) 으로 분류. final build 미포함 + 수정 안
 * 함 의도.
 */
export function markEdgesAsReference(
  bridge: WasmBridge,
  edgeIds: number[],
  name: string = 'Construction Line',
): MarkResult {
  if (edgeIds.length === 0) {
    return { ok: false, reason: '선택된 엣지가 없습니다' };
  }
  try {
    const refId = bridge.createReferenceConstructionLine(name, edgeIds);
    return { ok: true, refId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: humanizeRBViolation(msg) };
  }
}

/**
 * ADR-095 Phase 3-δ — N개 vert 를 PointCloud Reference 로 표시.
 *
 * 측정 데이터 (LiDAR scan / sensor) 분류.
 */
export function markVertsAsReference(
  bridge: WasmBridge,
  vertIds: number[],
  name: string = 'Point Cloud',
): MarkResult {
  if (vertIds.length === 0) {
    return { ok: false, reason: '선택된 정점이 없습니다' };
  }
  try {
    const refId = bridge.createReferencePointCloud(name, vertIds);
    return { ok: true, refId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: humanizeRBViolation(msg) };
  }
}

/**
 * Engine R-B violation 메시지를 사용자 facing 한국어로 변환.
 *
 * Engine 메시지 예시:
 *   "createReferenceImportedMesh: face FaceId(7) is owned by a Xia
 *    (Property citizen) — cannot register as Reference"
 *
 * 사용자 메시지: "이 면은 이미 [Property/Form/Reference] 시민에 속해
 * 있어 참조로 표시할 수 없습니다."
 */
function humanizeRBViolation(engineMsg: string): string {
  if (engineMsg.includes('owned by a Xia')) {
    return '이 면은 이미 다른 객체 (Xia) 에 속해 있어 참조로 표시할 수 없습니다';
  }
  if (engineMsg.includes('owned by a Shape')) {
    return '이 면은 이미 형태 (Shape) 에 속해 있어 참조로 표시할 수 없습니다';
  }
  if (engineMsg.includes('already owned by Reference')) {
    return '이 항목은 이미 다른 참조에 등록되어 있습니다';
  }
  if (engineMsg.includes('WASM endpoint missing')) {
    return '엔진 미준비 — 페이지 새로고침이 필요합니다';
  }
  // Fallback to original message (engineering layer 디버깅용).
  return engineMsg;
}
