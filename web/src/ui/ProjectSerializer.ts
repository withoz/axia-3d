/**
 * Project Serializer — .xia project file Save / Load
 *
 * Extracted from main.ts (lines 1231-1385).
 * Handles project export (snapshot + fallback) and import with camera/style restoration.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { Viewport } from '../viewport/Viewport';
import { ToolManager } from '../tools/ToolManagerRefactored';
import { UnitSystem } from '../units/UnitSystem';
import { debugLog } from '../utils/debug';

export interface ProjectSerializerDeps {
  bridge: WasmBridge;
  viewport: Viewport;
  toolManager: ToolManager;
  units: UnitSystem;
}

/** Uint8Array → base64 문자열 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → Uint8Array */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface ProjectSerializerAPI {
  saveProject: () => void;
  openProject: () => void;
}

export function initProjectSerializer(deps: ProjectSerializerDeps): ProjectSerializerAPI {
  const { bridge, viewport, toolManager, units } = deps;

  /**
   * ADR-078 P-3 L1 — Save sync (push).
   *
   * Push SelectionManager.groupTags → Scene.boolean_group_tags via
   * WasmBridge BEFORE exportSnapshot. Idempotent order:
   *   1. clearBooleanGroupTags (drop any stale state from prior session)
   *   2. setBooleanGroupTag(groupA, 'A') if non-empty
   *   3. setBooleanGroupTag(groupB, 'B') if non-empty
   *
   * If both groups empty: clear-only (no set calls). Persistence layer
   * truth source = SelectionManager (UI runtime).
   *
   * Bypasses SelectionManager.setGroupTag (selection-bound). The bridge
   * has no selection constraint — Rust layer is a simple HashMap insert.
   */
  const pushGroupTagsToBridge = () => {
    bridge.clearBooleanGroupTags();
    const sel: any = (toolManager as any)?.selection;
    if (!sel) return;
    const groupA: number[] = sel.getGroupA?.() ?? [];
    const groupB: number[] = sel.getGroupB?.() ?? [];
    if (groupA.length > 0) bridge.setBooleanGroupTag(groupA, 'A');
    if (groupB.length > 0) bridge.setBooleanGroupTag(groupB, 'B');
  };

  /**
   * ADR-078 P-3 L2 — Load sync (pull).
   *
   * Pull Scene.boolean_group_tags → SelectionManager.groupTags via
   * WasmBridge AFTER importSnapshot + syncMesh (face IDs stable).
   * One restoreGroupTags call → one notifyChange emit → one V-2
   * outline rebuild.
   *
   * SelectionManager.restoreGroupTags handles policy (P-3 L3):
   * groupTags fully replaced + selection ∪ (A ∪ B) + 1 notifyChange.
   */
  const pullGroupTagsFromBridge = () => {
    const sel: any = (toolManager as any)?.selection;
    if (!sel || typeof sel.restoreGroupTags !== 'function') return;
    const groupA = bridge.getBooleanGroupAFaces();
    const groupB = bridge.getBooleanGroupBFaces();
    sel.restoreGroupTags(groupA, groupB);
  };

  /** WASM export 불가 시 fallback: 메시 버퍼를 직접 저장 */
  const saveFallback = () => {
    const buffers = bridge.getMeshBuffers();
    const edgeLines = bridge.getEdgeLines();

    const project = {
      format: 'xia',
      version: '1.0.0-fallback',
      engine: 'AXiA 3D',
      created: new Date().toISOString(),
      units: {
        unit: units.unit,
        precision: units.precision,
      },
      camera: viewport.getCameraState(),
      style: viewport.getStyleSettings(),
      buffers: buffers ? {
        positions: Array.from(buffers.positions),
        normals: Array.from(buffers.normals),
        indices: Array.from(buffers.indices),
        faceMap: Array.from(buffers.faceMap),
      } : null,
      edgeLines: edgeLines ? Array.from(edgeLines) : null,
    };

    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `AXiA_Project_${new Date().toISOString().slice(0, 10)}.xia`;
    a.click();
    URL.revokeObjectURL(url);
    debugLog('[Save] Fallback project saved:', json.length, 'bytes');
  };

  /** .xia 프로젝트 파일 저장 */
  const saveProject = () => {
    // ADR-078 P-3 — push group tags to bridge BEFORE exportSnapshot.
    pushGroupTagsToBridge();

    const snapshot = bridge.exportSnapshot();
    if (!snapshot) {
      console.warn('[Save] WASM export_snapshot not available (WASM rebuild needed)');
      saveFallback();
      return;
    }

    const project = {
      format: 'xia',
      version: '1.0.0',
      engine: 'AXiA 3D',
      created: new Date().toISOString(),
      units: {
        unit: units.unit,
        precision: units.precision,
      },
      camera: viewport.getCameraState(),
      style: viewport.getStyleSettings(),
      mesh: toBase64(snapshot),
    };

    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `AXiA_Project_${new Date().toISOString().slice(0, 10)}.xia`;
    a.click();
    URL.revokeObjectURL(url);
    debugLog('[Save] Project saved:', json.length, 'bytes');
  };

  /** .xia 프로젝트 파일 열기 */
  const openProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xia';
    input.style.display = 'none';
    document.body.appendChild(input);

    // Cleanup helper — removes DOM element and listeners exactly once
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const onChange = async () => {
      const file = input.files?.[0];
      cleanup();

      if (!file) return;

      try {
        const text = await file.text();
        const project = JSON.parse(text);

        if (project.format !== 'xia') {
          alert('올바른 .xia 파일이 아닙니다.');
          return;
        }

        // 메시 복원
        if (project.mesh) {
          const data = fromBase64(project.mesh);
          const ok = bridge.importSnapshot(data);
          if (ok) {
            toolManager.syncMesh();
            // ADR-078 P-3 — pull group tags AFTER syncMesh (face IDs stable).
            pullGroupTagsFromBridge();
            debugLog('[Open] Mesh restored from snapshot');
          } else {
            console.error('[Open] importSnapshot failed');
          }
        }

        // 단위 복원
        if (project.units) {
          units.unit = project.units.unit;
          if (project.units.precision !== undefined) {
            units.precision = project.units.precision;
          }
        }

        // 카메라 복원
        if (project.camera) {
          viewport.setCameraState(project.camera);
        }

        // 스타일 복원
        if (project.style) {
          const s = project.style;
          viewport.updateBackground(s.bgMode, s.bgSkyColor, s.bgGroundColor, s.bgMidColor);
          if (s.frontColor !== undefined) viewport.setFaceColors(s.frontColor, s.backColor);
          if (s.edgeColor !== undefined) viewport.setEdgeStyle({ color: s.edgeColor, visible: s.edgeVisible });
          if (s.gridVisible !== undefined) viewport.setGridVisible(s.gridVisible);
          if (s.axisVisible !== undefined) viewport.setAxisVisible(s.axisVisible);
        }

        debugLog('[Open] Project loaded:', file.name);
      } catch (e) {
        console.error('[Open] Failed to load project:', e);
        alert('파일을 불러오는데 실패했습니다.');
      }
    };

    const onCancel = () => {
      cleanup();
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    input.click();
  };

  return { saveProject, openProject };
}
