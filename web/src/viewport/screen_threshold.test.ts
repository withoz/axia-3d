// ADR-040 P25.7 #4 — screen_threshold_independent_of_camera_distance
//
// The 12px hover threshold must produce a world-distance that scales
// linearly with camera-to-point distance under perspective projection,
// and is depth-invariant under orthographic. Concretely: zooming in or
// out must NOT make a hover that was "12px away" suddenly hit or miss.

import { describe, it, expect } from 'vitest';
import {
  pixelToWorldPerspective,
  pixelToWorldOrthographic,
} from './screen_threshold';

describe('ADR-040 P25.3 — pixel→world threshold conversion (perspective)', () => {
  const VIEWPORT_HEIGHT_PX = 1080;
  const FOV_DEG = 50;
  const PIXELS = 12;

  it('linearly proportional to camera-to-point distance', () => {
    const dNear = 1000; // 1m from camera
    const dFar = 5000; // 5m from camera
    const wNear = pixelToWorldPerspective(PIXELS, VIEWPORT_HEIGHT_PX, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: dNear,
    });
    const wFar = pixelToWorldPerspective(PIXELS, VIEWPORT_HEIGHT_PX, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: dFar,
    });
    // 5x distance → 5x world threshold (same screen size)
    expect(wFar / wNear).toBeCloseTo(5.0, 6);
  });

  it('zero-pixel threshold yields zero world distance', () => {
    expect(
      pixelToWorldPerspective(0, VIEWPORT_HEIGHT_PX, {
        fovDeg: FOV_DEG,
        cameraToPointDistance: 100,
      }),
    ).toBe(0);
  });

  it('linear in pixel count at fixed depth', () => {
    const w12 = pixelToWorldPerspective(12, VIEWPORT_HEIGHT_PX, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: 2000,
    });
    const w24 = pixelToWorldPerspective(24, VIEWPORT_HEIGHT_PX, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: 2000,
    });
    expect(w24 / w12).toBeCloseTo(2.0, 6);
  });

  it('mcp_screen_threshold_independent_of_camera_distance — scaled hover', () => {
    // The "screen-space contract": at any camera distance, a point that
    // is 12 pixels off the cursor must be exactly at the world threshold.
    // We simulate two camera setups and verify the ratio.
    //
    // Setup 1: cursor at (0,0,0), camera 2000mm away → world threshold ≈ A
    // Setup 2: cursor at (0,0,0), camera 8000mm away → world threshold ≈ 4A
    //
    // 4x camera distance → 4x world threshold ⇒ a 4A-mm-away point is
    // exactly 12px in setup 2, while in setup 1 the same world point
    // would be 48px (way out of threshold). Both setups correctly
    // gate the same screen-space distance.
    const wA = pixelToWorldPerspective(12, VIEWPORT_HEIGHT_PX, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: 2000,
    });
    const wB = pixelToWorldPerspective(12, VIEWPORT_HEIGHT_PX, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: 8000,
    });
    expect(wB / wA).toBeCloseTo(4.0, 6);
  });

  it('FOV scaling matches tan(fov/2)', () => {
    const wNarrow = pixelToWorldPerspective(12, VIEWPORT_HEIGHT_PX, {
      fovDeg: 30,
      cameraToPointDistance: 1000,
    });
    const wWide = pixelToWorldPerspective(12, VIEWPORT_HEIGHT_PX, {
      fovDeg: 90,
      cameraToPointDistance: 1000,
    });
    const expectedRatio =
      Math.tan((90 * Math.PI) / 360) / Math.tan((30 * Math.PI) / 360);
    expect(wWide / wNarrow).toBeCloseTo(expectedRatio, 6);
  });

  it('larger viewport → smaller world threshold (more pixels per unit)', () => {
    const wSmall = pixelToWorldPerspective(12, 540, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: 1000,
    });
    const wLarge = pixelToWorldPerspective(12, 2160, {
      fovDeg: FOV_DEG,
      cameraToPointDistance: 1000,
    });
    // 4x viewport height → 4x more pixels per world unit → 1/4 world threshold
    expect(wLarge / wSmall).toBeCloseTo(0.25, 6);
  });
});

describe('ADR-040 P25.3 — pixel→world threshold conversion (orthographic)', () => {
  const VIEWPORT_HEIGHT_PX = 1080;

  it('depth-invariant — orthographic projection is parallel', () => {
    // Same camera spec, two depths (orthographic doesn't care).
    const cam = { topMinusBottom: 4000, zoom: 1 };
    const w = pixelToWorldOrthographic(12, VIEWPORT_HEIGHT_PX, cam);
    // Sanity: 12 px in 1080 px screen = 12/1080 of half-height (2000mm),
    // doubled for full height. world = 12 / (1080/2) * (4000/2) = 12/1080 * 4000
    expect(w).toBeCloseTo((12 / 1080) * 4000, 6);
  });

  it('zoom doubles → world threshold halves', () => {
    const cam1 = { topMinusBottom: 4000, zoom: 1 };
    const cam2 = { topMinusBottom: 4000, zoom: 2 };
    const w1 = pixelToWorldOrthographic(12, VIEWPORT_HEIGHT_PX, cam1);
    const w2 = pixelToWorldOrthographic(12, VIEWPORT_HEIGHT_PX, cam2);
    expect(w2 / w1).toBeCloseTo(0.5, 6);
  });

  it('zero zoom defaults to 1 (defensive)', () => {
    const w = pixelToWorldOrthographic(12, VIEWPORT_HEIGHT_PX, {
      topMinusBottom: 4000,
      zoom: 0,
    });
    expect(w).toBeCloseTo((12 / 1080) * 4000, 6);
  });
});
