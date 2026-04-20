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
 * 기본 도형 생성 — 파피용(Papillon) 강아지. 몸통과 주둥이는 Revolve 프리미티브로
 * 자연스러운 테이퍼 곡면을 만들어 단순 원통보다 훨씬 유기적인 실루엣을 얻는다.
 *
 * 좌표계: +X = 앞, +Y = 위, +Z = 오른쪽. 바닥은 y=0.
 * 파트 구성:
 *   - 다리 4개     cylinder
 *   - 몸통         revolve (rear-pole → hip → mid → chest → neck → front-pole)
 *   - 머리         sphere
 *   - 주둥이       revolve (tapered cone from head forward)
 *   - 코           small sphere
 *   - 귀 2개       cone (세로로 뾰족)
 *   - 꼬리         cylinder (위로 플룸)
 */
function createInitialScene(bridge: WasmBridge, toolManager: ToolManager): void {
  debugLog('[Init] Creating initial "Papillon puppy" scene with revolve body/snout...');

  (async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      // ─── 다리 4개 ─────────────────────────────────────────────────
      const legRadius = 240, legHeight = 2600, legZ = 900;
      const legXFront = 1800, legXBack = -1800;
      bridge.create_cylinder?.(legXBack,  0, -legZ, legRadius, legHeight, 10);
      await tick();
      bridge.create_cylinder?.(legXBack,  0, +legZ, legRadius, legHeight, 10);
      await tick();
      bridge.create_cylinder?.(legXFront, 0, -legZ, legRadius, legHeight, 10);
      await tick();
      bridge.create_cylinder?.(legXFront, 0, +legZ, legRadius, legHeight, 10);
      await tick();

      // ─── 몸통 (revolve) ───────────────────────────────────────────
      // 척추 = +X 축 통과 (origin at y=3500). 프로파일은 XY 평면(z=0)에서
      // rear-pole → hip → mid (가장 굵음) → chest → neck → front-pole
      // 순으로 X 증가하며 정의. y값이 축 위의 반지름으로 작용함.
      // 20 segments로 매끄러운 곡면.
      const bodyProfile = [
        -2900, 3500, 0,   // rear pole (r=0)
        -2600, 3750, 0,   // rear r=250
        -1800, 4300, 0,   // hip  r=800
         -500, 4500, 0,   // mid  r=1000 (가장 굵음)
          800, 4450, 0,   // r=950
         1800, 4200, 0,   // chest r=700
         2500, 3850, 0,   // neck  r=350
         2800, 3500, 0,   // front pole (r=0)
      ];
      bridge.revolveProfile(
        bodyProfile,
        0, 3500, 0,   // axis origin (on spine)
        1, 0, 0,      // axis dir = +X
        20,           // segments
      );
      await tick();

      // ─── 머리 ──────────────────────────────────────────────────────
      const headX = 3300, headY = 3700, headR = 900;
      bridge.create_sphere?.(headX, headY, 0, headR, 20, 14);
      await tick();

      // ─── 주둥이 (revolve — base pole inside head, tip pole at nose) ─
      // 주둥이 축 = +X 축 at (headX+500, headY-200, 0). 머리 안쪽 깊숙한
      // 곳에서 base pole로 시작 → 바깥으로 나오며 중간에서 살짝 굵어졌다가
      // 코 끝에서 다시 pole로 수렴.
      const snoutY = headY - 200;
      const snoutAxisX = headX + 500;
      const snoutProfile = [
        snoutAxisX,        snoutY,       0,  // base pole (머리 안쪽)
        snoutAxisX + 100,  snoutY + 350, 0,  // r=350 (머리 표면 근처에서 가장 굵음)
        snoutAxisX + 400,  snoutY + 330, 0,
        snoutAxisX + 700,  snoutY + 280, 0,  // 코 쪽으로 테이퍼
        snoutAxisX + 850,  snoutY + 200, 0,
        snoutAxisX + 950,  snoutY,       0,  // tip pole (코 위치)
      ];
      bridge.revolveProfile(
        snoutProfile,
        snoutAxisX, snoutY, 0,  // axis origin
        1, 0, 0,                 // axis dir = +X
        16,                      // segments (주둥이는 가늘어서 적어도 OK)
      );
      await tick();

      // ─── 코 (주둥이 끝의 작은 구) ──────────────────────────────────
      bridge.create_sphere?.(snoutAxisX + 950, snoutY, 0, 180, 10, 8);
      await tick();

      // ─── 귀 2개 (cone) ──────────────────────────────────────────
      const earBaseY = headY + 700;
      const earR = 450, earH = 1800;
      bridge.create_cone?.(headX - 100, earBaseY, -600, earR, earH, 12);
      await tick();
      bridge.create_cone?.(headX - 100, earBaseY, +600, earR, earH, 12);
      await tick();

      // ─── 꼬리 (cylinder) ───────────────────────────────────────────
      bridge.create_cylinder?.(-2700, 4100, 0, 220, 2400, 10);
      await tick();
    } catch (e) {
      console.error('[Init] Papillon scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
