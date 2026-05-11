/**
 * UV Projection — compute per-vertex UV coordinates for texture mapping.
 *
 * Projection modes:
 *   - planar: project along face normal, u = dot(v, tangent), v = dot(v, bitangent)
 *   - box: pick the dominant axis, use the other two as UV
 *   - cylindrical: longitude (atan2) + height (axial)
 *
 * All modes output UV in [0, 1] scaled by `textureScale` (repeats per unit).
 * Units: world-space mm by default; `textureScale` = 0.001 means 1 tile / 1000mm.
 */

import * as THREE from 'three';

export type UVProjectionMode = 'planar' | 'box' | 'cylindrical';

export interface UVProjectionParams {
  mode: UVProjectionMode;
  /** Repeats per world unit (default 1 tile per 1000mm = 0.001) */
  scale: number;
  /** Rotation of the projection axis in radians (planar/box only) */
  rotation?: number;
  /** Override projection axis for cylindrical (default +Y) */
  axis?: THREE.Vector3;
}

export const DEFAULT_PROJECTION: UVProjectionParams = {
  mode: 'planar',
  scale: 0.001,
  rotation: 0,
};

// ═══════════════════════════════════════════════════════════════
// Core projection functions
// ═══════════════════════════════════════════════════════════════

/**
 * Planar projection — project point onto face plane, use face-local tangent/bitangent.
 * Works well for a single flat face.
 */
export function planarUV(
  position: THREE.Vector3,
  faceNormal: THREE.Vector3,
  scale: number,
  rotation: number = 0,
): [number, number] {
  // Build orthonormal frame on the face plane.
  const n = faceNormal.clone().normalize();
  // Pick a stable tangent: cross with world-up, fall back to world-right.
  let tangent = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0));
  if (tangent.lengthSq() < 1e-6) {
    tangent = new THREE.Vector3().crossVectors(n, new THREE.Vector3(1, 0, 0));
  }
  tangent.normalize();
  const bitangent = new THREE.Vector3().crossVectors(n, tangent).normalize();

  // Apply rotation in the tangent plane.
  if (rotation !== 0) {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const t2 = tangent.clone().multiplyScalar(c).addScaledVector(bitangent, s);
    const b2 = tangent.clone().multiplyScalar(-s).addScaledVector(bitangent, c);
    tangent.copy(t2);
    bitangent.copy(b2);
  }

  const u = position.dot(tangent) * scale;
  const v = position.dot(bitangent) * scale;
  return [u, v];
}

/**
 * Box projection — for each vertex, choose the face of a bounding box whose
 * normal is most aligned with the face normal, then use the other two axes as UV.
 */
export function boxUV(
  position: THREE.Vector3,
  faceNormal: THREE.Vector3,
  scale: number,
  rotation: number = 0,
): [number, number] {
  const ax = Math.abs(faceNormal.x);
  const ay = Math.abs(faceNormal.y);
  const az = Math.abs(faceNormal.z);

  let u: number, v: number;
  if (ax >= ay && ax >= az) {
    // ±X faces → UV = (Z, Y) (flip Z if normal.x < 0 for correct handedness)
    u = faceNormal.x >= 0 ? position.z : -position.z;
    v = position.y;
  } else if (ay >= ax && ay >= az) {
    // ±Y faces → UV = (X, Z)
    u = position.x;
    v = faceNormal.y >= 0 ? -position.z : position.z;
  } else {
    // ±Z faces → UV = (X, Y)
    u = faceNormal.z >= 0 ? -position.x : position.x;
    v = position.y;
  }

  u *= scale;
  v *= scale;

  if (rotation !== 0) {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const u2 = u * c - v * s;
    const v2 = u * s + v * c;
    return [u2, v2];
  }
  return [u, v];
}

/**
 * Cylindrical projection — longitude (atan2 around axis) + height (axial coord).
 * Used for cylinders/bottles: axis defaults to +Y.
 */
export function cylindricalUV(
  position: THREE.Vector3,
  scale: number,
  axis: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): [number, number] {
  const axisN = axis.clone().normalize();

  // Height along axis.
  const h = position.dot(axisN);

  // Radial component = position minus axial projection.
  const radial = position.clone().addScaledVector(axisN, -h);

  // Build frame perpendicular to axis.
  let tangent = new THREE.Vector3().crossVectors(axisN, new THREE.Vector3(1, 0, 0));
  if (tangent.lengthSq() < 1e-6) {
    tangent = new THREE.Vector3().crossVectors(axisN, new THREE.Vector3(0, 0, 1));
  }
  tangent.normalize();
  const bitangent = new THREE.Vector3().crossVectors(axisN, tangent).normalize();

  const x = radial.dot(tangent);
  const y = radial.dot(bitangent);

  // atan2 maps to [-π, π] → normalize to [0, 1] (one full wrap).
  const u = (Math.atan2(y, x) / (2 * Math.PI)) + 0.5;
  const v = h * scale;
  return [u, v];
}

// ═══════════════════════════════════════════════════════════════
// Entry point — dispatch by mode
// ═══════════════════════════════════════════════════════════════

export function computeUV(
  position: THREE.Vector3,
  faceNormal: THREE.Vector3,
  params: UVProjectionParams,
): [number, number] {
  const { mode, scale, rotation = 0, axis } = params;
  switch (mode) {
    case 'planar':
      return planarUV(position, faceNormal, scale, rotation);
    case 'box':
      return boxUV(position, faceNormal, scale, rotation);
    case 'cylindrical':
      return cylindricalUV(position, scale, axis);
  }
}

/**
 * Batch compute UVs for a geometry's vertex buffer.
 *
 * @param positions flat [x,y,z, x,y,z, ...] in world space
 * @param normals   flat [nx,ny,nz, ...] per-vertex normals
 * @param params    projection params
 * @returns flat [u,v, u,v, ...] array ready for BufferAttribute
 */
export function computeUVsFromBuffers(
  positions: Float32Array,
  normals: Float32Array,
  params: UVProjectionParams,
): Float32Array {
  const vertCount = positions.length / 3;
  const uvs = new Float32Array(vertCount * 2);
  const pos = new THREE.Vector3();
  const norm = new THREE.Vector3();
  for (let i = 0; i < vertCount; i++) {
    pos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    norm.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    const [u, v] = computeUV(pos, norm, params);
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  return uvs;
}
