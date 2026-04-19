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
import { debugLog } from '../utils/debug';

export interface InitialSceneDeps {
  bridge: WasmBridge;
  fileManager: FileManager;
  toolManager: ToolManager;
  /** Callback to update file name in status bar */
  updateFileStatus: (fileName: string) => void;
}

export function loadInitialScene(deps: InitialSceneDeps): void {
  const { bridge, toolManager, updateFileStatus } = deps;

  // 2026-04-19: 저장된 .xia 파일 대신 매번 프레시한 기본 도형을 그려서 시작.
  // (저장 파일에서 오는 잔여 상태 회피 + 최신 BVH/edge 경로 테스트)
  debugLog('[Init] Creating initial scene with default shapes...');
  updateFileStatus('untitled');
  void deps.fileManager; // suppress unused (fileManager는 이후 save 경로에서 사용)
  createInitialScene(bridge, toolManager);
}

/** 기본 도형 생성: cylinder + box + sphere. */
function createInitialScene(bridge: WasmBridge, toolManager: ToolManager): void {
  debugLog('[Init] Creating initial scene with default shapes...');

  // Use async IIFE to sequence WASM calls, each in its own microtask
  // to avoid wasm-bindgen RefCell borrow conflicts
  (async () => {
    try {
      bridge.create_cylinder?.(-12000, 3000, 0, 5000, 8000, 24);
      await new Promise(r => setTimeout(r, 0));

      const expectedFaceId = bridge.faceCount();
      const boxId = bridge.drawRect(0, 0, 0, 0, 1, 0, 0, 0, 1, 10000, 8000);
      await new Promise(r => setTimeout(r, 0));

      if (boxId >= 0) {
        bridge.pushPull(expectedFaceId, 10000);
        await new Promise(r => setTimeout(r, 0));
      }

      bridge.create_sphere?.(12000, 3500, 0, 5000, 24, 16);
      await new Promise(r => setTimeout(r, 0));
    } catch (e) {
      console.error('[Init] Fallback scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
