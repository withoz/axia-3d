/**
 * Boolean Operation Handler — Union / Subtract / Intersect
 *
 * Extracted from main.ts (lines 1389-1430).
 * Performs boolean operations on selected face groups via WASM bridge.
 */

import {
  WasmBridge,
  BooleanDispatchDcelMultiResult,
} from '../bridge/WasmBridge';
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

const OP_NAME_KO: Record<'union' | 'subtract' | 'intersect', string> = {
  union: '합집합',
  subtract: '차집합',
  intersect: '교집합',
};

/**
 * ADR-066 Y-4 — Handle the multi-face DCEL dispatch result.
 * This is the canonical BooleanHandler entry — supersedes the
 * legacy single-face DCEL fast-path (ADR-064 Step 6-γ) and the
 * NURBS probe (ADR-027 Phase G3) per ADR-076 Step 1 cleanup.
 *
 * @returns `true` if the result was fully handled. `false` if the
 *   caller should fall through to the Sheet / Mesh boolean path
 *   (null bridge / pathUsed='Mesh' Y-E ineligible).
 */
function handleMultiDcelResult(
  deps: BooleanHandlerDeps,
  result: BooleanDispatchDcelMultiResult | null,
  op: 'union' | 'subtract' | 'intersect',
): boolean {
  // bridge missing / WASM not exposed → fall through (graceful).
  if (!result) return false;

  // §F lock-in — engine error envelope shown explicitly.
  if (result.kind === 'error') {
    Toast.error(
      `NURBS ${OP_NAME_KO[op]} (multi) — 엔진 오류 (${result.reason}):\n${result.detail}`,
      8000,
    );
    debugLog(`[Multi DCEL Bool] ${op} error: ${result.reason} — ${result.detail}`);
    return true;
  }

  // pathUsed === 'Mesh' → Y-E ineligible, fall through to legacy paths.
  if (result.pathUsed !== 'Nurbs') {
    debugLog(
      `[Multi DCEL Bool] ${op} ineligible (pathUsed=${result.pathUsed}, ` +
        `reason=${result.fallbackReason?.label ?? 'unknown'}); falling through.`,
    );
    return false;
  }

  // pathUsed === 'Nurbs' from here on. Analyze per-pair outcomes.
  const totalPairs = result.perPair.length;
  const successPairs = result.perPair.filter(p => p.outcome.kind === 'ok').length;
  const errPairs = totalPairs - successPairs;
  const newCount = result.allNewFaces.length;
  const removedCount = result.allRemovedFaces.length;

  // All-disjoint / no-closed-loops case — no actual mesh change.
  // (Per-pair Ok with disjoint=true OR new_faces empty due to D-H safe-only.)
  if (newCount === 0 && removedCount === 0) {
    Toast.info(
      `NURBS ${OP_NAME_KO[op]} (multi): 모든 ${totalPairs}개 pair 가 ` +
        `교차하지 않거나 면 분할 미생성 (변경 없음).`,
      4500,
    );
    debugLog(`[Multi DCEL Bool] ${op} all-disjoint/no-loops: ${totalPairs} pairs`);
    return true;
  }

  // Partial failure — some pairs succeeded, some err'd.
  // Per Y-4-d=(a) — Toast.warning with first warning hint, syncMesh
  // since at least one pair mutated state.
  if (errPairs > 0) {
    deps.toolManager.syncMesh();
    const firstWarning = result.warnings[0] ?? '(상세 없음)';
    Toast.warning(
      `NURBS ${OP_NAME_KO[op]} (multi) 부분 성공 — ` +
        `${successPairs}/${totalPairs} pair 성공, 새 면 ${newCount}개, ` +
        `제거 ${removedCount}개.\n첫 경고: ${firstWarning}`,
      6000,
    );
    debugLog(
      `[Multi DCEL Bool] ${op} partial: ${successPairs}/${totalPairs} ok, ` +
        `new=${newCount}, removed=${removedCount}, warnings=${result.warnings.length}`,
    );
    return true;
  }

  // Full success — Y-4-c gives per-pair count visibility.
  deps.toolManager.syncMesh();
  Toast.info(
    `NURBS ${OP_NAME_KO[op]} (multi) 완료 — 새 면 ${newCount}개, ` +
      `제거 면 ${removedCount}개 (${successPairs}/${totalPairs} pair 성공).`,
    3000,
  );
  debugLog(
    `[Multi DCEL Bool] ${op} ok: ${successPairs}/${totalPairs} pairs, ` +
      `allNew=${newCount}, allRemoved=${removedCount}, ` +
      `warnings=${result.warnings.length}`,
  );
  return true;
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

  // ADR-066 Y-4 (Path Y) — Multi-face DCEL Boolean dispatch fast-path.
  //
  // For ≥2 selected faces, attempt the multi-face DCEL dispatcher
  // (`booleanDispatchDcelMulti`) which routes eligible NURBS-aware
  // selections through `nurbs_boolean_to_dcel` per cartesian pair.
  // Selection split (Y-4-b=(a)) — half/half (matches existing mesh
  // path policy below for fall-through compatibility).
  //
  // Y-1 1×1 degenerate handles the 2-face case via Path Z internally
  // (single fast-path becomes special case of multi). Per Y-4-g=(b),
  // the legacy single-face DCEL fast-path below is kept for back-compat.
  //
  // Result handling matrix (per handleMultiDcelResult):
  // | Case                        | Toast    | syncMesh | Fall-through |
  // |-----------------------------|----------|----------|--------------|
  // | null bridge                 | none     | no       | yes          |
  // | kind: 'error'               | error    | no       | no           |
  // | pathUsed: 'Mesh' (Y-E)      | none     | no       | yes          |
  // | all-disjoint / no-loops     | info     | no       | no           |
  // | partial (some err'd)        | warning  | yes      | no           |
  // | full success                | info     | yes      | no           |
  if (selection.length >= 2 &&
      typeof bridge.booleanDispatchDcelMulti === 'function') {
    const mid = Math.ceil(selection.length / 2);
    const facesA = selection.slice(0, mid);
    const facesB = selection.slice(mid);
    const multiResult = bridge.booleanDispatchDcelMulti(facesA, facesB, op);
    const handled = handleMultiDcelResult(deps, multiResult, op);
    if (handled) return;
    // fall-through: null bridge OR pathUsed === 'Mesh'.
    // ADR-076 Step 1 — Legacy paths sunset:
    // Previously this fall-through reached (a) single DCEL fast-path
    // (ADR-064 Step 6-γ, superseded by Y-1 1×1 degenerate) and
    // (b) legacy NURBS probe (ADR-027 Phase G3 kind===7, superseded by
    // Y-1 surface_to_bspline accepting BSpline). Both became
    // unreachable when ADR-066 Y-4 multi DCEL fast-path entered the
    // chain. Removed per ADR-076 §A.
  }

  // ADR-007 Rev 2 — Sheet 면은 Wall과 다른 경로 (Sheet 2D Boolean).
  //   - 모든 operand가 Sheet → sheet_boolean (Tier 4 B-5)
  //   - 일부만 Sheet → 혼합 거부 (안내)
  //   - 전부 Wall → 기존 Mesh boolean
  const sheetIds: number[] = [];
  const wallIds: number[] = [];
  for (const f of selection) {
    if (bridge.isFaceInVolume?.(f) === false) sheetIds.push(f);
    else wallIds.push(f);
  }
  if (sheetIds.length > 0 && wallIds.length > 0) {
    Toast.warning(
      `Sheet ${sheetIds.length}개 + Wall ${wallIds.length}개 혼합 선택 — ` +
      `Sheet끼리 또는 Wall끼리만 가능합니다.`,
      6000,
    );
    return;
  }
  // Sheet-only 경로 — 정확히 2개 필요 (MVP, convex만 지원)
  if (sheetIds.length === selection.length) {
    if (selection.length !== 2) {
      Toast.warning(
        `Sheet Boolean은 정확히 2개의 동일 평면 Sheet 면이 필요합니다 (현재 ${selection.length}개).`,
        5000,
      );
      return;
    }
    const newFace = bridge.sheetBoolean(selection[0], selection[1], op);
    if (newFace == null) {
      // sheetBoolean 내부에서 이미 Toast.error 호출됨
      return;
    }
    toolManager.syncMesh();
    const nameKo = op === 'union' ? '합집합' : op === 'subtract' ? '차집합' : '교집합';
    Toast.info(`Sheet ${nameKo} 완료 — 결과 face #${newFace}`, 2500);
    debugLog(`[SheetBool] ${op} 완료: 결과 face=${newFace}`);
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
