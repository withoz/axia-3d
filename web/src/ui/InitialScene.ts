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
 * 기본 도형 생성 — 파피용(Papillon) 스타일 강아지 모델.
 *
 * 좌표계: +X = 앞, +Y = 위, +Z = 오른쪽. 바닥은 y=0.
 * 파피용 특징을 반영:
 *   - 호리호리한 몸통 + 가느다란 다리
 *   - 큰 뾰족 귀 (콘으로 곧게 세움)
 *   - 뾰족한 주둥이 (머리 앞쪽으로 짧은 수평 원통)
 *   - 높이 든 꼬리 (뒤쪽에서 위로 길게 뻗음)
 */
function createInitialScene(bridge: WasmBridge, toolManager: ToolManager): void {
  debugLog('[Init] Creating initial "Papillon puppy" scene...');

  // Use async IIFE to sequence WASM calls, each in its own microtask
  // to avoid wasm-bindgen RefCell borrow conflicts
  (async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      // ─── 다리 4개 (가느다란 원기둥) ───────────────────────────────
      const legRadius = 240;
      const legHeight = 2600;
      const legZ = 900;
      const legXFront = 1800;
      const legXBack = -1800;
      bridge.create_cylinder?.(legXBack,  0, -legZ, legRadius, legHeight, 10);
      await tick();
      bridge.create_cylinder?.(legXBack,  0, +legZ, legRadius, legHeight, 10);
      await tick();
      bridge.create_cylinder?.(legXFront, 0, -legZ, legRadius, legHeight, 10);
      await tick();
      bridge.create_cylinder?.(legXFront, 0, +legZ, legRadius, legHeight, 10);
      await tick();

      // ─── 몸통 (호리호리한 수평 원통) ─────────────────────────────
      //   radius 900, x∈[-2600, 2800], 중심 y=3500
      const bodyBaseFaceId = bridge.faceCount();
      bridge.drawCircle(
        -2600, 3500, 0,  // 뒤쪽 끝
        1, 0, 0,         // normal = +X
        900,             // radius (파피용처럼 슬림)
        24,
      );
      await tick();
      bridge.pushPull(bodyBaseFaceId, 5400); // 길이 5400
      await tick();

      // ─── 머리 (구) — 몸통 앞쪽 위 ────────────────────────────────
      const headX = 3300, headY = 3700, headR = 900;
      bridge.create_sphere?.(headX, headY, 0, headR, 20, 14);
      await tick();

      // ─── 주둥이 (짧은 수평 원기둥, 머리 앞쪽으로 돌출) ───────────
      const snoutBaseFaceId = bridge.faceCount();
      bridge.drawCircle(
        headX + 600, headY - 200, 0,
        1, 0, 0,         // normal +X
        320,             // 얇은 주둥이
        16,
      );
      await tick();
      bridge.pushPull(snoutBaseFaceId, 700);
      await tick();

      // ─── 코 (작은 구, 주둥이 끝에) ────────────────────────────────
      bridge.create_sphere?.(headX + 1380, headY - 200, 0, 220, 10, 8);
      await tick();

      // ─── 귀 2개 (큰 뾰족 귀 — 콘, 머리 위로 곧게) ────────────────
      // create_cone(base_x, base_y, base_z, radius, height, segments)
      // 머리 위쪽 좌우에 베이스, 위로 뻗음.
      const earBaseY = headY + 700;   // 머리 위 살짝 겹침
      const earR = 450;
      const earH = 1800;
      bridge.create_cone?.(headX - 100, earBaseY, -600, earR, earH, 12);
      await tick();
      bridge.create_cone?.(headX - 100, earBaseY, +600, earR, earH, 12);
      await tick();

      // ─── 꼬리 (길고 높은 원기둥) ─────────────────────────────────
      // 파피용 특유의 풍성하게 말린 꼬리 느낌은 프리미티브로 어려우나,
      // 몸통 뒤 상단에서 위로 길게 뻗어 실루엣을 표현.
      bridge.create_cylinder?.(-2700, 4100, 0, 220, 2400, 10);
      await tick();
    } catch (e) {
      console.error('[Init] Papillon scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
