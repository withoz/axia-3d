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
  debugLog('[Init] Creating cute cat scene...');
  updateFileStatus('untitled');
  void deps.fileManager; // suppress unused (fileManager는 이후 save 경로에서 사용)
  createInitialScene(bridge, toolManager);
}

/**
 * Initial Scene — 귀여운 고양이 (cute cat).
 *
 * Parts:
 *   - 4 tapered legs (revolve), shorter than dog's
 *   - Compact body (revolve), rounder than dog's
 *   - Larger head sphere — cat proportion (head ~1/3 of body length)
 *   - Tiny nose bump (sphere) + 2 small eye bumps
 *   - 2 upright triangular ears (revolve, slight outward tilt)
 *   - Long S-curved tail (sweep)
 *
 * Coordinates: +X forward, +Y up, +Z right. Ground y = 0.
 */
function createInitialScene(bridge: WasmBridge, toolManager: ToolManager): void {
  (async () => {
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      // ─── Legs × 4 — shorter than a dog's, rounder paws ─────────
      // Cats stand lower, with compact legs and prominent paws.
      // Top pole = y=2400 (well inside the body solid which spans
      // y ≈ 1700..3900 at the hip). Z offset ±480 keeps legs inside
      // the body's ±900 cross-section.
      const legPositions: Array<[number, number]> = [
        [-1500, -480], [-1500,  480],   // back legs
        [ 1500, -480], [ 1500,  480],   // front legs
      ];
      for (const [cx, cz] of legPositions) {
        const profile: number[] = [
          cx,          0, cz,    // foot pole
          cx + 240,   30, cz,
          cx + 310,   90, cz,    // paw (chunky, cat-like)
          cx + 290,  180, cz,
          cx + 240,  320, cz,    // ankle
          cx + 210,  700, cz,
          cx + 220, 1100, cz,    // mid leg
          cx + 240, 1500, cz,
          cx + 280, 1900, cz,    // upper thigh
          cx + 240, 2200, cz,
          cx,       2400, cz,    // top pole — inside body
        ];
        bridge.revolveProfile(profile, cx, 0, cz, 0, 1, 0, 18);
        await tick();
      }

      // ─── Body ──────────────────────────────────────────────────
      // Shorter & rounder than the dog. Axis = +X through y=2800 at
      // z=0. Profile y is the world y-coord → radius = y - 2800.
      // rear-pole → rounded hip → mid (thickest) → chest → neck →
      // front-pole. Max radius 1050 for a plump cat silhouette.
      bridge.revolveProfile(
        [
          -2300, 2800, 0,   // rear pole
          -2200, 2960, 0,
          -2000, 3200, 0,
          -1700, 3500, 0,   // hip  (r=700)
          -1200, 3760, 0,   // widening
           -600, 3880, 0,   // mid  (r=1080, widest)
            100, 3850, 0,
            700, 3760, 0,
           1200, 3600, 0,   // chest starts narrowing
           1600, 3400, 0,
           1900, 3200, 0,
           2100, 3000, 0,   // neck
           2250, 2870, 0,
           2300, 2800, 0,   // front pole
        ],
        0, 2800, 0,
        1, 0, 0,
        28,
      );
      await tick();

      // ─── Head ──────────────────────────────────────────────────
      // Cat head is proportionally LARGE vs body. Placed forward of
      // the body's front pole, slightly raised so ears clear body top.
      const headX = 2700, headY = 3200, headR = 1050;
      bridge.create_sphere?.(headX, headY, 0, headR, 32, 20);
      await tick();

      // ─── Snout — tiny bump, not a protruding cone ──────────────
      // Cats have a very short muzzle. Small sphere embedded in the
      // head front reads as the snout.
      bridge.create_sphere?.(headX + 900, headY - 180, 0, 360, 18, 14);
      await tick();

      // ─── Nose — tiny sphere right at the muzzle tip ────────────
      bridge.create_sphere?.(headX + 1180, headY - 180, 0, 110, 14, 10);
      await tick();

      // ─── Eyes × 2 — small bumps on head front ─────────────────
      // Half-embedded in the head surface so they appear as gentle
      // orbital bulges. Placed forward + left/right of head center,
      // slightly above the muzzle line.
      const eyeR = 230;
      const eyeForward = 820;
      const eyeUp = 60;
      const eyeSide = 420;
      bridge.create_sphere?.(headX + eyeForward, headY + eyeUp, -eyeSide, eyeR, 14, 10);
      await tick();
      bridge.create_sphere?.(headX + eyeForward, headY + eyeUp,  eyeSide, eyeR, 14, 10);
      await tick();

      // ─── Ears × 2 — TALL TRIANGULAR, barely tilted outward ────
      // Classic cat silhouette: sharp triangles on top of the head.
      // Axis nearly +Y with just a 10° outward lean so they don't
      // sit perfectly parallel (which looks stiff).
      const buildCatEar = (zSign: -1 | 1) => {
        const baseX = headX - 200;
        const baseY = headY + 650;
        const baseZ = zSign * 450;
        const tiltZ = zSign * 0.17;   // sin(~10°)
        const axisY = 0.985;
        const L = 1000;
        const addPt = (t: number, r: number): [number, number, number] => [
          baseX + r,
          baseY + t * axisY,
          baseZ + t * tiltZ,
        ];
        // Narrower base than the dog's butterfly ear, sharper taper
        // to tip — gives the classic pointed cat ear.
        const pts = [
          addPt(0,        0),        // base pole
          addPt(0,      440),        // base rim
          addPt(L*0.12, 425),
          addPt(L*0.28, 380),
          addPt(L*0.48, 290),
          addPt(L*0.68, 190),
          addPt(L*0.85, 100),
          addPt(L*0.95,  40),
          addPt(L,        0),        // tip pole
        ];
        const profile: number[] = [];
        for (const p of pts) profile.push(...p);
        bridge.revolveProfile(profile, baseX, baseY, baseZ, 0, axisY, tiltZ, 18);
      };
      buildCatEar(-1);
      await tick();
      buildCatEar(+1);
      await tick();

      // ─── Tail — long S-curve, thinner than dog's ──────────────
      // Starts from body rear-top, arcs up, curves back, and drops
      // a little toward the tip to give a gentle S. Radius 100 for
      // a slender cat tail.
      const tailPoints = 14;
      const tailRadius = 100;
      const tailProfile: number[] = [];
      for (let i = 0; i < tailPoints; i++) {
        const a = (i * Math.PI * 2) / tailPoints;
        tailProfile.push(tailRadius * Math.cos(a), tailRadius * Math.sin(a), 0);
      }
      const tailPath: number[] = [
        -2000, 3500, 0,   // inside body, top-rear
        -2250, 3780, 0,
        -2500, 4080, 0,
        -2720, 4380, 0,
        -2870, 4700, 0,
        -2920, 5020, 0,   // peak of the arc
        -2860, 5300, 0,
        -2680, 5530, 0,
        -2410, 5670, 0,   // S bend starts curling back forward
        -2100, 5710, 0,
        -1780, 5650, 0,
        -1500, 5510, 0,
        -1290, 5320, 0,   // tip
      ];
      bridge.sweepProfileAlongPath(tailProfile, tailPath, true);
      await tick();
    } catch (e) {
      console.error('[Init] Cat scene creation failed:', e);
    }

    toolManager.syncMesh();
  })();
}
