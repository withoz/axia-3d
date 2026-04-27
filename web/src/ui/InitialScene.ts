/**
 * Initial Scene Loader — startup hook.
 *
 * 2026-04-27: 빈 씬으로 시작 (도형 없음).
 *   이전엔 고양이 데모 씬을 매번 만들었으나, 사용자가 항상 깨끗한 캔버스를
 *   원하므로 default geometry 생성을 제거. 파일을 열거나 도구로 그리기 전까지
 *   씬은 비어 있다.
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
  const { toolManager, updateFileStatus } = deps;

  debugLog('[Init] Starting with empty scene (no default geometry)');
  updateFileStatus('untitled');
  void deps.bridge;        // suppress unused — 이후 도구 사용 시 활성
  void deps.fileManager;   // suppress unused — save/load 경로에서 사용

  // 빈 씬이라도 syncMesh 한 번 돌려서 viewport / BVH / telemetry 초기 상태 정합.
  toolManager.syncMesh();
}
