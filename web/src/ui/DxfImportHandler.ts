/**
 * DXF Import Handler — Rust DCEL conversion via WASM bridge
 *
 * Extracted from main.ts (lines 1576-1629).
 * Opens file dialog, reads DXF, sends to WASM engine, syncs mesh.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { debugLog } from '../utils/debug';
import { Toast } from './Toast';

export interface DxfImportDeps {
  bridge: WasmBridge;
  toolManager: ToolManager;
}

export function importDxfFile(deps: DxfImportDeps): void {
  const { bridge, toolManager } = deps;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.dxf';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.onchange = async () => {
    const file = input.files?.[0];
    document.body.removeChild(input);
    if (!file) return;

    debugLog(`[DXF Import] 파일: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    // Phase H4 — 단위 선택 다이얼로그 (DXF $INSUNITS 없거나 모호할 때)
    // 사용자가 명시 선택하여 스케일 오차 방지.
    const unitScale = promptUnitScale(file.name);
    if (unitScale === null) {
      debugLog('[DXF Import] 사용자 취소');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const result = bridge.importDxf(data);
      // Note: 현재 Rust import_dxf은 단위 무관 — 기본 mm 가정.
      // 비-mm이면 import 후 전체 scale 적용 (아래 post-import).

      if (!result) {
        alert('DXF 가져오기 실패: WASM 엔진이 준비되지 않았습니다.\n로컬에서 wasm-pack 빌드 후 다시 시도해 주세요.');
        return;
      }

      if (!result.ok) {
        alert(`DXF 파싱 실패: ${result.error || '알 수 없는 오류'}`);
        return;
      }

      // Phase H (ADR-007 Barrier) — import 직후 자동 정규화
      // 외부 DXF 데이터를 AXiA 네이티브 규칙에 맞춰 정리.
      const normReport = bridge.normalizeForImport();
      if (normReport.remainingViolations > 0) {
        console.warn(
          `[DXF Import] Normalize 후에도 ${normReport.remainingViolations}개 위반 남음`,
          normReport
        );
      }
      debugLog('[DXF Import] Normalize 결과:', normReport);

      // Sync mesh (WASM → Three.js)
      toolManager.syncMesh();

      const summary = [
        result.lines && `선 ${result.lines}`,
        result.polylines && `폴리선 ${result.polylines}`,
        result.circles && `원 ${result.circles}`,
        result.arcs && `호 ${result.arcs}`,
        result.faces3d && `3D면 ${result.faces3d}`,
        result.solids && `솔리드 ${result.solids}`,
        result.ellipses && `타원 ${result.ellipses}`,
        result.splines && `스플라인 ${result.splines}`,
      ].filter(Boolean).join(', ');

      debugLog(`[DXF Import] 완료: ${summary}`);
      debugLog(`[DXF Import] 총 정점: ${result.totalVerts}, 총 면: ${result.totalFaces}, 스킵: ${result.skipped}`);

      // Phase H4 — 비-mm 단위 경고 (자동 스케일 미구현, 사용자 수동 대응)
      if (unitScale !== 1.0) {
        Toast.warning(
          `단위: 비-mm (계수 ${unitScale}×) — 현재 자동 스케일 미지원. ` +
          `필요 시 모두 선택 후 스케일 도구로 ${unitScale}× 적용하세요.`,
          6000,
        );
      }

      // Phase H5 — 자유 엣지가 있으면 사용자에게 안내 (자동 합성 안 함)
      // 2D DXF 도면은 LINE/POLYLINE만 있어 face 없이 edge만 있는 상태가 일반적.
      const freeEdges = bridge.countFreeEdges();
      if (freeEdges > 0) {
        Toast.info(
          `자유 엣지 ${freeEdges}개 발견. 메뉴 → 수정 → '자유 엣지 → 면 합성' 으로 면 생성 가능.`,
          5000,
        );
      }

    } catch (err) {
      console.error('[DXF Import] 오류:', err);
      alert(`DXF 가져오기 중 오류: ${(err as Error).message}`);
    }
  };

  input.click();
}

/**
 * Phase H4 — 단위 선택 프롬프트.
 * `confirm` 대신 `prompt`로 단위명 받아 scale 반환. 취소 시 null.
 * 기본값: mm (1.0). CAD 도면 대부분이 mm.
 */
function promptUnitScale(fileName: string): number | null {
  const units: Record<string, number> = {
    'mm': 1.0,
    'cm': 10.0,
    'm': 1000.0,
    'in': 25.4,
    'ft': 304.8,
  };
  const msg =
    `"${fileName}" 의 단위를 선택하세요.\n\n` +
    `mm (밀리미터, 기본)\n` +
    `cm (센티미터)\n` +
    `m (미터)\n` +
    `in (인치)\n` +
    `ft (피트)\n\n` +
    `단위명 입력 (기본 mm):`;
  const input = window.prompt(msg, 'mm');
  if (input === null) return null;
  const key = input.trim().toLowerCase();
  if (key === '' || key === 'mm') return 1.0;
  return units[key] ?? 1.0;
}
