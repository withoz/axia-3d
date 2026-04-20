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
        // More intermediate profile samples → smoother silhouette along
        // the leg (paw bulge, ankle narrow, knee curve, thigh swell).
        const profile: number[] = [
          cx,          0, cz,    // foot pole
          cx + 260,   40, cz,
          cx + 300,  110, cz,    // paw widest
          cx + 260,  220, cz,    // ankle
          cx + 220,  600, cz,    // lower calf
          cx + 220, 1100, cz,
          cx + 245, 1700, cz,    // knee
          cx + 290, 2200, cz,
          cx + 325, 2600, cz,    // thigh
          cx + 280, 2850, cz,
          cx,       3000, cz,    // top pole — inside body
        ];
        // 20 rotational segments (up from 12) for a clearly round leg.
        bridge.revolveProfile(profile, cx, 0, cz, 0, 1, 0, 20);
        await tick();
      }

      // ─── Body (revolve, tapered along +X) ──────────────────────
      // Axis = +X through y = 3500 at z = 0. Profile y values act as
      // radii from the spine. rear-pole → hip (widest) → mid → chest →
      // neck → front-pole.
      bridge.revolveProfile(
        [
          // Denser rear taper — rear pole area was previously sharp
          -2800, 3500, 0,   // rear pole
          -2700, 3640, 0,
          -2500, 3800, 0,
          -2100, 4100, 0,
          -1800, 4350, 0,   // hip (r=850)
          -1100, 4470, 0,
           -500, 4500, 0,   // mid (r=1000, thickest)
            400, 4480, 0,
            800, 4450, 0,
           1300, 4330, 0,
           1800, 4200, 0,   // chest (r=700)
           2200, 4010, 0,
           2500, 3800, 0,   // neck (r=300)
           2700, 3640, 0,
           2800, 3500, 0,   // front pole
        ],
        0, 3500, 0,   // axis origin on spine
        1, 0, 0,       // axis dir = +X
        28,            // segments 20 → 28 for smoother circumference
      );
      await tick();

      // ─── Head (sphere, denser tessellation) ────────────────────
      const headX = 3300, headY = 3700, headR = 900;
      bridge.create_sphere?.(headX, headY, 0, headR, 32, 20);
      await tick();

      // ─── Snout (revolve, tapered cone from head forward) ───────
      const snoutY = headY - 200;
      const snoutAxisX = headX + 500;
      bridge.revolveProfile(
        [
          snoutAxisX,        snoutY,       0,   // base pole inside head
          snoutAxisX + 100,  snoutY + 340, 0,
          snoutAxisX + 250,  snoutY + 335, 0,
          snoutAxisX + 400,  snoutY + 320, 0,
          snoutAxisX + 550,  snoutY + 300, 0,
          snoutAxisX + 700,  snoutY + 270, 0,
          snoutAxisX + 800,  snoutY + 240, 0,
          snoutAxisX + 850,  snoutY + 190, 0,
          snoutAxisX + 900,  snoutY + 120, 0,
          snoutAxisX + 950,  snoutY,       0,   // tip pole at nose position
        ],
        snoutAxisX, snoutY, 0,
        1, 0, 0,
        24,   // 16 → 24
      );
      await tick();

      // ─── Nose (sphere at snout tip) ────────────────────────────
      bridge.create_sphere?.(snoutAxisX + 950, snoutY, 0, 180, 16, 12);
      await tick();

      // ─── Ears × 2 (tilted revolve — Papillon "butterfly" V-shape) ─
      // Real Papillon ears angle ~20° outward from vertical, and their
      // height is comparable to the head radius (not 2× like before).
      // Cone primitives are axis-locked to +Y, so we use Revolve with a
      // tilted axis instead: mostly +Y, plus ±Z for the outward lean.
      const buildEar = (zSign: -1 | 1) => {
        // Base center: slightly inside the top of the head so the ear's
        // bottom visibly emerges from the head surface.
        const baseX = headX - 120;
        const baseY = headY + 550;
        const baseZ = zSign * 420;
        // Axis direction tilted ~20° outward in YZ plane.
        const tiltZ = zSign * 0.34;           // sin(20°) ≈ 0.34
        const axisY = 0.94;                   // cos(20°) ≈ 0.94
        // Profile lies in the plane containing the axis AND the world +X
        // direction (which is perpendicular to the YZ-tilt axis).
        // Length along axis = 1250 — comparable to head r=900.
        const L = 1250;
        const addPt = (t: number, r: number): [number, number, number] => [
          baseX + r,                 // +X is our perpendicular-in-plane axis
          baseY + t * axisY,
          baseZ + t * tiltZ,
        ];
        // Denser control points → smoother transition from wide base
        // to sharp tip.
        const pts = [
          addPt(0,        0),        // base pole
          addPt(0,      600),        // base rim (wide)
          addPt(L*0.15, 590),
          addPt(L*0.30, 540),        // lower ear
          addPt(L*0.50, 440),
          addPt(L*0.65, 320),        // upper half, tapering
          addPt(L*0.80, 220),
          addPt(L*0.90, 140),        // near tip
          addPt(L*0.97,  60),
          addPt(L,        0),        // tip pole (pointed)
        ];
        const profile: number[] = [];
        for (const p of pts) profile.push(...p);
        // 14 → 20 rotational segments for a visibly round ear rim.
        bridge.revolveProfile(profile, baseX, baseY, baseZ, 0, axisY, tiltZ, 20);
      };
      buildEar(-1);
      await tick();
      buildEar(+1);
      await tick();

      // ─── Tail (sweep along curved upward path) ─────────────────
      // Papillon's plume tail curls up and back over the body. The path
      // STARTS INSIDE the body rear (roughly at the top-back of the revolve
      // solid, so the tail-body junction looks seamless) and curls up-back.
      // Closed circle profile → solid tube; bump radius to 180 for
      // visibility against the body silhouette.
      const tailPoints = 16;                // 10 → 16 for rounder cross-section
      const tailRadius = 180;
      const tailProfile: number[] = [];
      for (let i = 0; i < tailPoints; i++) {
        const a = (i * Math.PI * 2) / tailPoints;
        tailProfile.push(tailRadius * Math.cos(a), tailRadius * Math.sin(a), 0);
      }
      // Denser path → smoother curl. Inserted midpoints between the
      // original 7 key positions so the sweep-frame transport doesn't
      // produce visible kinks at the sharper bends.
      const tailPath: number[] = [
        -2500, 3700, 0,   // inside body, top-rear
        -2600, 3900, 0,
        -2720, 4100, 0,
        -2830, 4350, 0,
        -2915, 4620, 0,
        -2970, 4900, 0,
        -3005, 5180, 0,
        -3005, 5470, 0,
        -2970, 5730, 0,
        -2870, 5980, 0,
        -2700, 6200, 0,
        -2500, 6340, 0,
        -2300, 6410, 0,
      ];
      bridge.sweepProfileAlongPath(tailProfile, tailPath, true);
      await tick();
    } catch (e) {
      console.error('[Init] Papillon scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
