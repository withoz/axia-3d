// ADR-040 P25.3 — screen-space pixel threshold ↔ world-space distance.
//
// Pure helper extracted from Viewport.pixelToWorldAtDepth so that unit
// tests can exercise the math without instantiating Three.js cameras.
//
// Convention: pixel threshold is symmetric (e.g. 12px = a 24px-diameter
// "fat ray" around the cursor). World distance is the perpendicular
// world-space offset that projects to exactly `pixels` pixels at the
// given depth.

export interface PerspectiveCameraSpec {
  /** Vertical field of view, degrees. Three.js convention. */
  fovDeg: number;
  /** Camera position to point distance (world units, mm). */
  cameraToPointDistance: number;
}

export interface OrthographicCameraSpec {
  /** Top - bottom of the orthographic frustum (world units). */
  topMinusBottom: number;
  /** Camera zoom factor (Three.js default = 1). */
  zoom: number;
}

/**
 * Convert pixel threshold to world distance for a perspective camera.
 *
 * The math: at depth d from the camera, the half-height of the world
 * window visible in the viewport is `tan(fov/2) * d`. We map that to
 * the half-height of the canvas in pixels.
 */
export function pixelToWorldPerspective(
  pixels: number,
  viewportHeightPx: number,
  cam: PerspectiveCameraSpec,
): number {
  const fovRad = (cam.fovDeg * Math.PI) / 180;
  const halfHeightWorld = Math.tan(fovRad / 2) * cam.cameraToPointDistance;
  const halfHeightPx = viewportHeightPx / 2;
  return pixels * (halfHeightWorld / halfHeightPx);
}

/**
 * Convert pixel threshold to world distance for an orthographic camera.
 * Depth-independent (orthographic projection is a parallel projection).
 */
export function pixelToWorldOrthographic(
  pixels: number,
  viewportHeightPx: number,
  cam: OrthographicCameraSpec,
): number {
  const halfHeightWorld = cam.topMinusBottom / (2 * (cam.zoom || 1));
  const halfHeightPx = viewportHeightPx / 2;
  return pixels * (halfHeightWorld / halfHeightPx);
}
