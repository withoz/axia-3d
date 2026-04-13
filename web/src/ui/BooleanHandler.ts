/**
 * Boolean Operation Handler — Union / Subtract / Intersect
 *
 * Extracted from main.ts (lines 1389-1430).
 * Performs boolean operations on selected face groups via WASM bridge.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { debugLog } from '../utils/debug';

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
    alert(
      `Boolean ${op}: 두 개의 솔리드를 선택해주세요.\n` +
      `현재 선택된 면: ${selection.length}개\n\n` +
      `사용법:\n` +
      `1. 첫 번째 솔리드의 면을 클릭 (Shift+클릭으로 여러 면)\n` +
      `2. 두 번째 솔리드의 면을 클릭\n` +
      `3. 수정 메뉴에서 Boolean 연산 선택`
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
    alert('Boolean 연산 실패: WASM 엔진이 준비되지 않았습니다.');
    return;
  }

  if (!result.ok) {
    alert(`Boolean ${op} 실패: ${result.error || '알 수 없는 오류'}`);
    return;
  }

  toolManager.syncMesh();
  debugLog(
    `[Boolean] ${op} 완료: 결과 면 ${result.resultFaces?.length ?? 0}개, ` +
    `총 정점 ${result.totalVerts}, 총 면 ${result.totalFaces}`
  );
}
