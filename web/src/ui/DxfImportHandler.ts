/**
 * DXF Import Handler — Rust DCEL conversion via WASM bridge
 *
 * Extracted from main.ts (lines 1576-1629).
 * Opens file dialog, reads DXF, sends to WASM engine, syncs mesh.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { debugLog } from '../utils/debug';

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

    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const result = bridge.importDxf(data);

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

    } catch (err) {
      console.error('[DXF Import] 오류:', err);
      alert(`DXF 가져오기 중 오류: ${(err as Error).message}`);
    }
  };

  input.click();
}
