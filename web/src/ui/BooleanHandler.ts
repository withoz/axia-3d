/**
 * Boolean Operation Handler — Union / Subtract / Intersect
 *
 * Extracted from main.ts (lines 1389-1430).
 * Performs boolean operations on selected face groups via WASM bridge.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { Toast } from './Toast';
import { debugLog } from '../utils/debug';

/** Rust 엔진 에러 메시지를 한국어 사용자 안내로 변환.
 *  - "hole" 포함 → Phase G 구멍 있는 면 거부 케이스
 *  - 그 외 → 원문 유지 (debug용)
 */
function translateBooleanError(rawError: string | undefined, op: string): string {
  if (!rawError) return `Boolean ${op} 실패: 알 수 없는 오류`;
  if (rawError.includes('hole') || rawError.includes('multi-loop')) {
    return (
      `Boolean ${op} — 선택한 면에 구멍(hole)이 있어 연산할 수 없습니다.\n` +
      `(현재 Boolean은 단일 outer loop 면만 지원 — constrained Delaunay triangulation 추가 시 확장 예정)\n\n` +
      `우회:\n` +
      `1. 구멍이 없는 다른 면을 선택하거나\n` +
      `2. "내부 면을 구멍으로 합치기"를 역으로 해제한 뒤 시도`
    );
  }
  return `Boolean ${op} 실패: ${rawError}`;
}

export interface BooleanHandlerDeps {
  bridge: WasmBridge;
  toolManager: ToolManager;
}

export function startBooleanOp(
  deps: BooleanHandlerDeps,
  op: 'union' | 'subtract' | 'intersect',
): void {
  const { bridge, toolManager } = deps;

  // 현재 선택된 face들을 2그룹으로 나누어 Boolean 수행
  // MVP: 선택 시스템과 연동 — face 그룹 A, B를 번갈아 선택
  const selection = toolManager.selection.getSelectedFaces();
  if (selection.length < 2) {
    Toast.warning(
      `Boolean ${op}: 두 솔리드의 면을 선택하세요 (현재 ${selection.length}개)\n` +
      `1) 첫 솔리드 면 클릭 → 2) Shift+클릭으로 두 번째 솔리드 면 추가 → 3) 연산 실행`,
      6000,
    );
    return;
  }

  // 간단 분리: 선택 목록의 절반을 A, 나머지를 B로 처리
  // (향후: 솔리드 단위 자동 그룹핑)
  const mid = Math.ceil(selection.length / 2);
  const facesA = selection.slice(0, mid);
  const facesB = selection.slice(mid);

  debugLog(`[Boolean] ${op}: A=${facesA.length} faces, B=${facesB.length} faces`);

  const result = bridge.booleanOp(facesA, facesB, op);
  if (!result) {
    Toast.error('Boolean 연산 실패: WASM 엔진이 준비되지 않았습니다', 4000);
    return;
  }

  if (!result.ok) {
    Toast.error(translateBooleanError(result.error, op), 8000);
    debugLog(`[Boolean] ${op} 실패 (raw): ${result.error}`);
    return;
  }

  toolManager.syncMesh();
  const nameKo = op === 'union' ? '합집합' : op === 'subtract' ? '차집합' : '교집합';
  Toast.info(
    `Boolean ${nameKo} 완료 — 결과 면 ${result.resultFaces?.length ?? 0}개`,
    2500,
  );
  debugLog(
    `[Boolean] ${op} 완료: 결과 면 ${result.resultFaces?.length ?? 0}개, ` +
    `총 정점 ${result.totalVerts}, 총 면 ${result.totalFaces}`
  );
}
