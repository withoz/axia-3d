/**
 * Initial Scene Loader — fetch .xia project file on startup
 *
 * Extracted from main.ts (section 4-0, lines 174-268).
 * Uses FileManager.loadFromArrayBuffer() to eliminate duplicate binary parsing.
 * Falls back to creating default shapes (box + cylinder + sphere) if fetch fails.
 */

import { WasmBridge } from '../bridge/WasmBridge';
import { FileManager } from '../file/FileManager';
import { ToolManager } from '../tools/ToolManagerRefactored';

export interface InitialSceneDeps {
  bridge: WasmBridge;
  fileManager: FileManager;
  toolManager: ToolManager;
  /** Callback to update file name in status bar */
  updateFileStatus: (fileName: string) => void;
}

export function loadInitialScene(deps: InitialSceneDeps): void {
  const { bridge, fileManager, toolManager, updateFileStatus } = deps;

  console.log('[Init] Loading initial scene from saved project...');

  fetch('/assets/AXiA_Project_2026-04-13.xia')
    .then(response => {
      if (!response.ok) throw new Error('Failed to load initial scene file');
      return response.arrayBuffer();
    })
    .then(async (arrayBuffer) => {
      const fileData = new Uint8Array(arrayBuffer);
      console.log(`[Init] Initial scene file loaded: ${fileData.length} bytes`);

      // FileManager의 파싱 로직 재사용 (중복 제거)
      const success = await fileManager.loadFromArrayBuffer(fileData);

      if (success) {
        updateFileStatus(fileManager.getCurrentFileName());
        console.log('[Init] Initial scene loaded successfully');
      } else {
        console.error('[Init] Failed to import snapshot');
      }

      // 메시 동기화
      toolManager.syncMesh();
    })
    .catch(err => {
      console.error('[Init] Failed to load initial scene:', err);
      console.log('[Init] Creating fallback scene with default shapes...');

      // Fallback: 기본 도형 생성 (파일 로드 실패 시)
      try {
        const cylinderId = bridge.create_cylinder?.(-12000, 3000, 0, 5000, 8000, 24);
        const expectedFaceId = bridge.faceCount();
        const boxId = bridge.drawRect(0, 0, 0, 0, 1, 0, 0, 0, 1, 10000, 8000);
        if (boxId >= 0) {
          bridge.pushPull(expectedFaceId, 10000);
        }
        const sphereId = bridge.create_sphere?.(12000, 3500, 0, 5000, 24, 16);
        toolManager.syncMesh();
      } catch (e) {
        console.error('[Init] Fallback scene creation failed:', e);
      }
    });
}
