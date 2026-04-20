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
 * Initial Papillon scene built with the organic-modeling primitives that
 * AXiA now supports:
 *   - Revolve    — body, snout, and each of the 4 tapered legs
 *   - Sweep      — curled tail along a curved path
 *   - Sphere     — head + nose
 *   - Cone       — 2 ears
 *
 * After loading, "매끄럽게 분할 (Catmull-Clark)" in the menu smooths everything.
 *
 * Coordinates: +X forward, +Y up, +Z right. Ground at y = 0.
 */
function createInitialScene(bridge: WasmBridge, toolManager: ToolManager): void {
  debugLog('[Init] Creating Papillon puppy with revolve/sweep/sphere/cone...');

  (async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      // ─── Legs × 4 (tapered revolve) ─────────────────────────────
      // Profile is in the XZ-constant plane containing the vertical (+Y) axis
      // at (cx, *, cz). Points are ordered along +Y for outward normals.
      const legPositions: Array<[number, number]> = [
        [-1800, -900], [-1800,  900],   // back legs
        [ 1800, -900], [ 1800,  900],   // front legs
      ];
      for (const [cx, cz] of legPositions) {
        const profile: number[] = [
          cx,          0, cz,    // foot pole (on axis)
          cx + 290,   60, cz,    // paw (widest near ground)
          cx + 240,  200, cz,    // ankle
          cx + 210,  800, cz,    // lower leg
          cx + 260, 1600, cz,    // knee
          cx + 300, 2200, cz,    // thigh
          cx,       2500, cz,    // top pole (connects to body)
        ];
        bridge.revolveProfile(profile, cx, 0, cz, 0, 1, 0, 12);
        await tick();
      }

      // ─── Body (revolve, tapered along +X) ──────────────────────
      // Axis = +X through y = 3500 at z = 0. Profile y values act as
      // radii from the spine. rear-pole → hip (widest) → mid → chest →
      // neck → front-pole.
      bridge.revolveProfile(
        [
          -2800, 3500, 0,   // rear pole
          -2500, 3800, 0,
          -1800, 4350, 0,   // hip (r=850)
           -500, 4500, 0,   // mid (r=1000, thickest)
            800, 4450, 0,
           1800, 4200, 0,   // chest (r=700)
           2500, 3800, 0,   // neck (r=300)
           2800, 3500, 0,   // front pole
        ],
        0, 3500, 0,   // axis origin on spine
        1, 0, 0,       // axis dir = +X
        20,            // segments
      );
      await tick();

      // ─── Head (sphere) ─────────────────────────────────────────
      const headX = 3300, headY = 3700, headR = 900;
      bridge.create_sphere?.(headX, headY, 0, headR, 20, 14);
      await tick();

      // ─── Snout (revolve, tapered cone from head forward) ───────
      const snoutY = headY - 200;
      const snoutAxisX = headX + 500;
      bridge.revolveProfile(
        [
          snoutAxisX,        snoutY,       0,   // base pole inside head
          snoutAxisX + 100,  snoutY + 340, 0,
          snoutAxisX + 400,  snoutY + 320, 0,
          snoutAxisX + 700,  snoutY + 270, 0,
          snoutAxisX + 850,  snoutY + 190, 0,
          snoutAxisX + 950,  snoutY,       0,   // tip pole at nose position
        ],
        snoutAxisX, snoutY, 0,
        1, 0, 0,
        16,
      );
      await tick();

      // ─── Nose (sphere at snout tip) ────────────────────────────
      bridge.create_sphere?.(snoutAxisX + 950, snoutY, 0, 180, 10, 8);
      await tick();

      // ─── Ears × 2 (cones, vertical) ────────────────────────────
      const earBaseY = headY + 700, earR = 450, earH = 1800;
      bridge.create_cone?.(headX - 100, earBaseY, -600, earR, earH, 12);
      await tick();
      bridge.create_cone?.(headX - 100, earBaseY, +600, earR, earH, 12);
      await tick();

      // ─── Tail (sweep along curved upward path) ─────────────────
      // Papillon's plume tail curls up and back over the body. We sweep
      // a small circle profile along a hand-crafted curve. The closed
      // profile gives a tube; subdivision afterward can round it further.
      const tailPoints = 8;
      const tailRadius = 130;
      const tailProfile: number[] = [];
      for (let i = 0; i < tailPoints; i++) {
        const a = (i * Math.PI * 2) / tailPoints;
        tailProfile.push(tailRadius * Math.cos(a), tailRadius * Math.sin(a), 0);
      }
      const tailPath: number[] = [
        -2700, 4100, 0,
        -2850, 4500, 0,
        -3000, 5000, 0,
        -3050, 5500, 0,
        -2950, 6000, 0,
        -2650, 6300, 0,
        -2300, 6400, 0,
      ];
      bridge.sweepProfileAlongPath(tailProfile, tailPath, true);
      await tick();
    } catch (e) {
      console.error('[Init] Papillon scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
