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
      // at (cx, *, cz). Points ordered along +Y for outward normals.
      //
      // Positions chosen so that each leg top (y ≈ 3000) sits inside the
      // body revolve solid:
      //   - body at x=±1800 has radius 700–850 around the spine at y=3500,
      //     so the body bottom is y ≈ 2650–2800 there
      //   - z=±550 sits inside the body's z-range at both hip and chest
      //   - the top pole at y=3000 is WELL INSIDE body, guaranteeing a
      //     visibly continuous leg-to-body junction
      const legPositions: Array<[number, number]> = [
        [-1800, -550], [-1800,  550],   // back legs
        [ 1800, -550], [ 1800,  550],   // front legs
      ];
      for (const [cx, cz] of legPositions) {
        const profile: number[] = [
          cx,          0, cz,    // foot pole (on axis)
          cx + 290,   60, cz,    // paw (widest near ground)
          cx + 240,  220, cz,    // ankle
          cx + 210, 1000, cz,    // lower leg
          cx + 260, 1900, cz,    // knee
          cx + 320, 2600, cz,    // thigh (widest up top)
          cx,       3000, cz,    // top pole — inside body
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
      // Papillon's plume tail curls up and back over the body. The path
      // STARTS INSIDE the body rear (roughly at the top-back of the revolve
      // solid, so the tail-body junction looks seamless) and curls up-back.
      // Closed circle profile → solid tube; bump radius to 180 for
      // visibility against the body silhouette.
      const tailPoints = 10;
      const tailRadius = 180;
      const tailProfile: number[] = [];
      for (let i = 0; i < tailPoints; i++) {
        const a = (i * Math.PI * 2) / tailPoints;
        tailProfile.push(tailRadius * Math.cos(a), tailRadius * Math.sin(a), 0);
      }
      // Body at x=-2500 has radius ≈ 300 → y ∈ [3200, 3800] there.
      // Starting tail at (-2500, 3700) places its first section INSIDE the
      // body envelope near the upper-rear.
      const tailPath: number[] = [
        -2500, 3700, 0,   // inside body, top-rear
        -2700, 4100, 0,
        -2900, 4600, 0,
        -3000, 5100, 0,
        -2950, 5700, 0,
        -2700, 6200, 0,
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
