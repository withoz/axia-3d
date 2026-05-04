/**
 * Boolean Operation Handler — Union / Subtract / Intersect
 *
 * Extracted from main.ts (lines 1389-1430).
 * Performs boolean operations on selected face groups via WASM bridge.
 */

import {
  WasmBridge, NurbsBooleanResult,
  BooleanDispatchDcelResult,
} from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { Toast } from './Toast';
import { debugLog } from '../utils/debug';

/** ADR-027 Phase G3 — `faceSurfaceKind` codes that pick the NURBS path. */
const SURFACE_KIND_BSPLINE = 7;

/** Format a successful NURBS Boolean result for the Toast. */
function formatNurbsBooleanOk(
  r: Extract<NurbsBooleanResult, { kind: 'ok' }>,
): string {
  const opNameKo =
    r.op === 'union' ? '합집합' : r.op === 'subtract' ? '차집합' : '교집합';
  if (r.is_disjoint) {
    return `NURBS ${opNameKo}: 두 곡면이 교차하지 않습니다 (변경 없음).`;
  }
  const lines = [
    `NURBS ${opNameKo} (Phase G3 MVP) — 분석 완료`,
    `  • 교차 체인: ${r.intersection_chains}`,
    `  • Trim 루프 A: ${r.trim_a_count}, B: ${r.trim_b_count}`,
  ];
  if (r.warning_open_chains_skipped) {
    lines.push('  ⚠ 열린 체인 일부 생략 (closed chain만 MVP 지원)');
  }
  if (r.tangent_contact) {
    lines.push('  ⚠ 접선 접촉 감지');
  }
  lines.push(
    '  ℹ 메시 적용은 후속 PR — BSplineSurface trim_loops 저장소 추가 후 활성화',
  );
  return lines.join('\n');
}

function formatNurbsBooleanError(
  r: Extract<NurbsBooleanResult, { kind: 'error' }>,
): string {
  switch (r.reason) {
    case 'unsupported_surface':
      return (
        `NURBS Boolean — 선택한 면이 BSplineSurface가 아닙니다.\n` +
        `(Phase G3 MVP는 NURBS surface 부착 face만 지원)\n\n` +
        `Detail: ${r.detail}`
      );
    case 'bad_op':
      return `NURBS Boolean — 잘못된 연산 이름. ${r.detail}`;
    case 'engine':
      return `NURBS Boolean 엔진 오류:\n${r.detail}`;
    case 'parse':
      return `NURBS Boolean — 엔진 응답 파싱 실패. WASM 빌드를 재확인하세요.`;
  }
}

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
 * ADR-064 Step 6-γ — Handle the DCEL dispatch result.
 *
 * @returns `true` if the result was fully handled (success / disjoint /
 *   error / D-H safe-only no-closed-loops). `false` if the caller
 *   should fall through to legacy paths (null bridge / pathUsed='Mesh').
 */
function handleDcelResult(
  deps: BooleanHandlerDeps,
  result: BooleanDispatchDcelResult | null,
  op: 'union' | 'subtract' | 'intersect',
): boolean {
  // bridge missing / WASM not exposed → fall through (D-AG graceful).
  if (!result) return false;

  // §F lock-in — engine error envelope shown explicitly.
  if (result.kind === 'error') {
    Toast.error(
      `NURBS ${OP_NAME_KO[op]} — 엔진 오류 (${result.reason}):\n${result.detail}`,
      8000,
    );
    debugLog(`[DCEL Bool] ${op} error: ${result.reason} — ${result.detail}`);
    return true;
  }

  // pathUsed === 'Mesh' → ineligible, fall through to legacy mesh path.
  // (D-AG=(a) — caller fallback semantics realized as fall-through here.)
  if (result.pathUsed !== 'Nurbs') {
    debugLog(
      `[DCEL Bool] ${op} ineligible (pathUsed=${result.pathUsed}, ` +
        `reason=${result.fallbackReason?.label ?? 'unknown'}); falling through.`,
    );
    return false;
  }

  // pathUsed === 'Nurbs' from here on — dcel must be populated.
  if (!result.dcel) {
    Toast.error(
      `NURBS ${OP_NAME_KO[op]} — 엔진 응답 불일치 (Nurbs path with null dcel)`,
      6000,
    );
    return true;
  }

  // Disjoint case — D-F=(c) — both inputs preserved unchanged.
  if (result.dcel.disjoint) {
    Toast.info(
      `NURBS ${OP_NAME_KO[op]}: 두 곡면이 교차하지 않습니다 (변경 없음).`,
      4000,
    );
    debugLog(`[DCEL Bool] ${op} disjoint — no mesh change`);
    return true;
  }

  // D-H safe-only — SSI ran but produced no closed trim loops.
  // Inputs preserved; no new faces; user gets a hint about the
  // legacy mesh path which may handle the open-chain case.
  const newCount = result.dcel.newFacesA.length + result.dcel.newFacesB.length;
  if (newCount === 0) {
    Toast.warning(
      `NURBS ${OP_NAME_KO[op]} — 교차선만 검출, 면 분할 미생성.\n` +
        '닫힌 trim 루프가 없는 경우 (예: 평면이 교차선으로만 만남).\n' +
        '일반 Boolean 경로로 시도하려면 선택을 다시 확인하세요.',
      7000,
    );
    debugLog(`[DCEL Bool] ${op} no-closed-loops (D-H safe-only)`);
    return true;
  }

  // Success — D-AK=(a) syncMesh + Toast.info with face deltas.
  deps.toolManager.syncMesh();
  const removedCount = result.dcel.removedFaces.length;
  Toast.info(
    `NURBS ${OP_NAME_KO[op]} 완료 — 새 면 ${newCount}개, ` +
      `제거 면 ${removedCount}개 (DCEL).`,
    3000,
  );
  debugLog(
    `[DCEL Bool] ${op} ok: newFacesA=${result.dcel.newFacesA.length}, ` +
      `newFacesB=${result.dcel.newFacesB.length}, ` +
      `removed=${removedCount}, ` +
      `chainCount=${result.intersectionChainCount}, ` +
      `clean=${result.dcel.robustnessClean}`,
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

  // ADR-064 Step 6-γ (Path Z) — DCEL Boolean dispatch fast-path.
  //
  // For exactly 2 selected faces, attempt the DCEL-producing dispatcher
  // (`booleanDispatchDcel`) which routes eligible analytic-surface pairs
  // through `nurbs_boolean_to_dcel` (Step 5). Per D-AG=(a), ineligible
  // / unsupported / parse-error / null-bridge cases fall through to the
  // legacy NURBS probe / Sheet / Mesh paths below — graceful degradation.
  //
  // Per D-AF=(b), the legacy NURBS probe (kind===7 fast-path) is
  // preserved for back-compat. DCEL handles the same kinds as a superset
  // (Plane / BezierPatch / BSplineSurface), so the legacy branch is
  // reachable only when DCEL declines (`pathUsed: 'Mesh'`) or returns
  // null (engine missing) — those cases naturally fall through.
  if (selection.length === 2 && typeof bridge.booleanDispatchDcel === 'function') {
    const dcelResult = bridge.booleanDispatchDcel(selection[0], selection[1], op);
    const handled = handleDcelResult(deps, dcelResult, op);
    if (handled) return;
    // fall-through: dcelResult was null OR pathUsed === 'Mesh' OR error
    //   handled-as-fallback. legacy paths take over below.
  }

  // ADR-027 Phase G3 — NURBS Boolean fast-path.
  // If exactly two faces selected AND both carry BSplineSurface, dispatch
  // to the analytic NURBS path (parameter-space CSG via SSI + trim loops).
  if (selection.length === 2 && bridge.faceSurfaceKind) {
    const kindA = bridge.faceSurfaceKind(selection[0]);
    const kindB = bridge.faceSurfaceKind(selection[1]);
    if (kindA === SURFACE_KIND_BSPLINE && kindB === SURFACE_KIND_BSPLINE) {
      debugLog(`[NURBS Bool] ${op}: face A=${selection[0]} B=${selection[1]}`);
      const result =
        typeof bridge.nurbsBoolean === 'function'
          ? bridge.nurbsBoolean(selection[0], selection[1], op)
          : null;
      if (!result) {
        Toast.error(
          'NURBS Boolean 실패: WASM 엔진이 준비되지 않았습니다',
          4000,
        );
        return;
      }
      if (result.kind === 'error') {
        Toast.error(formatNurbsBooleanError(result), 8000);
        debugLog(`[NURBS Bool] ${op} error: ${result.reason} — ${result.detail}`);
        return;
      }
      Toast.info(formatNurbsBooleanOk(result), 6000);
      debugLog(
        `[NURBS Bool] ${op} ok: chains=${result.intersection_chains}, ` +
          `trim_a=${result.trim_a_count}, trim_b=${result.trim_b_count}`,
      );
      // No syncMesh() — MVP does not mutate mesh state yet.
      return;
    }
    // Mixed: one BSpline + one regular → not supported in this pass.
    if (kindA === SURFACE_KIND_BSPLINE || kindB === SURFACE_KIND_BSPLINE) {
      Toast.warning(
        `NURBS Boolean: 두 면이 모두 BSplineSurface여야 합니다 ` +
          `(현재 kindA=${kindA}, kindB=${kindB}). 일반 Mesh boolean으로 진행합니다.`,
        5000,
      );
      // fall through to regular path
    }
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
