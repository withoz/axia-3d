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

/**
 * 기본 도형 생성 — 프리미티브(박스/원기둥/구)로 조합한 간단한 "강아지" 모델.
 *
 * 좌표계: +X = 앞, +Y = 위, +Z = 오른쪽. 바닥은 y=0.
 * 파트:
 *   - 다리 4개 (원기둥, 바닥 y=0 ~ 몸통 아래 y=2500)
 *   - 몸통 (박스, y=2500 ~ y=4500, 길이 6000 X축)
 *   - 머리 (구, 몸통 앞쪽 +X 방향)
 *   - 귀 2개 (작은 구, 머리 위)
 *   - 코 (작은 구, 머리 앞쪽 끝)
 *   - 꼬리 (원기둥, 몸통 뒤쪽 위로)
 */
function createInitialScene(bridge: WasmBridge, toolManager: ToolManager): void {
  debugLog('[Init] Creating initial "puppy" scene...');

  // Use async IIFE to sequence WASM calls, each in its own microtask
  // to avoid wasm-bindgen RefCell borrow conflicts
  (async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      // ─── 다리 4개 (원기둥, 높이 2500) ─────────────────────────────
      // 각 다리는 바닥 중심 (x, 0, z), 몸통 아래 y=2500까지 올라감
      const legRadius = 400;
      const legHeight = 2500;
      const legZ = 1000;
      const legXFront = 2000;
      const legXBack = -2000;
      bridge.create_cylinder?.(legXBack,  0, -legZ, legRadius, legHeight, 12); // 뒤-좌
      await tick();
      bridge.create_cylinder?.(legXBack,  0, +legZ, legRadius, legHeight, 12); // 뒤-우
      await tick();
      bridge.create_cylinder?.(legXFront, 0, -legZ, legRadius, legHeight, 12); // 앞-좌
      await tick();
      bridge.create_cylinder?.(legXFront, 0, +legZ, legRadius, legHeight, 12); // 앞-우
      await tick();

      // ─── 몸통 (박스, x=-3000..+3000, y=2500..4500, z=-1250..+1250) ──
      // drawRect 시그니처: (cx,cy,cz, nx,ny,nz, ux,uy,uz, width, height)
      // 몸통 바닥면: 중심 (0, 2500, 0), 법선 +Y(위), up=+X(몸 길이 방향),
      // width = Z 폭 2500, height = X 길이 6000.
      const bodyBaseFaceId = bridge.faceCount();
      bridge.drawRect(
        0, 2500, 0,      // center
        0, 1, 0,         // normal (facing up)
        1, 0, 0,         // up = +X (몸의 앞쪽)
        2500,            // width (Z)
        6000,            // height (X)
      );
      await tick();
      bridge.pushPull(bodyBaseFaceId, 2000); // 위로 2000 → 몸통 높이 y=2500..4500
      await tick();

      // ─── 머리 (구, 몸통 앞쪽 위) ────────────────────────────────
      const headX = 3800, headY = 3800, headR = 1300;
      bridge.create_sphere?.(headX, headY, 0, headR, 20, 14);
      await tick();

      // ─── 귀 2개 (구, 머리 위 좌우) ──────────────────────────────
      bridge.create_sphere?.(headX - 200, headY + 1100, -700, 400, 12, 8);
      await tick();
      bridge.create_sphere?.(headX - 200, headY + 1100, +700, 400, 12, 8);
      await tick();

      // ─── 코 (작은 구, 머리 앞쪽 끝) ──────────────────────────────
      bridge.create_sphere?.(headX + 1200, headY - 200, 0, 300, 10, 8);
      await tick();

      // ─── 꼬리 (원기둥, 몸통 뒤쪽 위로) ─────────────────────────────
      // 뒤쪽 상단에서 살짝 위로 올라가는 스터비 꼬리
      bridge.create_cylinder?.(-3100, 4000, 0, 180, 1400, 8);
      await tick();
    } catch (e) {
      console.error('[Init] Puppy scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
