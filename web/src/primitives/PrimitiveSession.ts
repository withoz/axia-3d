/**
 * PrimitiveSession — SSOT (Single Source of Truth) for Sphere/Cylinder/Cone creation
 * All inputs (drag, HUD, panel) write to session.params → preview + UI subscribe to it
 */

import * as THREE from 'three';

export type PrimitiveType = 'sphere' | 'cylinder' | 'cone' | 'torus';

export type InteractionState = 'idle' | 'sizing1' | 'sizing2' | 'done';

/**
 * Common parameters for all primitives
 * - radius: sizing1 for all shapes
 * - height: sizing2 for cylinder/cone (sphere uses only radius)
 * - topRadius: optional for cone frustum (future extension)
 */
export interface PrimitiveParams {
  radius: number;
  height: number;
  topRadius?: number;
}

/**
 * Preview visualization data
 */
export interface PreviewGeometry {
  radiusCircle?: THREE.Line | THREE.LineSegments; // Sizing1: radius circle preview
  heightAxis?: THREE.Line;   // Sizing2: height axis guide
  silhouette?: THREE.Line;   // Optional: cylinder/cone outline
}

/**
 * Unified session for all primitive creation/editing
 * Stores state, parameters, preview, anchor point, and axis
 */
export class PrimitiveSession {
  // === Core state ===
  primitiveType: PrimitiveType;
  state: InteractionState = 'idle';

  // === Geometry ===
  anchor: THREE.Vector3 | null = null;      // First click position (base center)
  axis: THREE.Vector3 = new THREE.Vector3(0, 0, 1); // Height direction (default: world up)

  // === Parameters (SSOT) ===
  params: PrimitiveParams = {
    radius: 0,
    height: 0,
    topRadius: 0,
  };

  // === Preview ===
  preview: PreviewGeometry = {};

  // === Input control ===
  inputLock: boolean = false; // Lock drag updates while typing VCB

  // === Callbacks ===
  onParamsChange?: (params: PrimitiveParams) => void;
  onStateChange?: (state: InteractionState) => void;

  constructor(type: PrimitiveType) {
    this.primitiveType = type;
  }

  /**
   * Set anchor point and axis (at Click #1)
   */
  setAnchor(point: THREE.Vector3, axis?: THREE.Vector3): void {
    this.anchor = point.clone();
    if (axis) {
      this.axis = axis.clone().normalize();
    }
  }

  /**
   * SSOT: Update parameters and notify observers
   * Called by drag, HUD input, or panel input
   */
  setParam(key: keyof PrimitiveParams, value: number): void {
    if (this.inputLock) return; // Ignore drag while typing

    if (this.params[key] !== value) {
      this.params[key] = value;
      this.onParamsChange?.(this.params);
    }
  }

  /**
   * Update multiple params at once
   */
  setParams(updates: Partial<PrimitiveParams>): void {
    if (this.inputLock) return;

    Object.assign(this.params, updates);
    this.onParamsChange?.(this.params);
  }

  /**
   * Transition to next sizing state
   */
  nextState(): void {
    const stateSequence: InteractionState[] = ['idle', 'sizing1', 'sizing2', 'done'];
    const currentIdx = stateSequence.indexOf(this.state);

    if (currentIdx < stateSequence.length - 1) {
      this.state = stateSequence[currentIdx + 1];
      this.onStateChange?.(this.state);
    }
  }

  /**
   * Transition to previous state (for cancel/undo within session)
   */
  prevState(): void {
    const stateSequence: InteractionState[] = ['idle', 'sizing1', 'sizing2', 'done'];
    const currentIdx = stateSequence.indexOf(this.state);

    if (currentIdx > 0) {
      this.state = stateSequence[currentIdx - 1];
      this.onStateChange?.(this.state);
    }
  }

  /**
   * Check if shape requires Sizing2 (height).
   *
   * For Torus, sizing1 = `radius` (major) and sizing2 = `height` (minor
   * radius — semantic alias in `params.height`). ADR-115 β-3-ζ Path B
   * tool integration (사용자 결재 2026-05-17).
   */
  requiresSizing2(): boolean {
    return this.primitiveType === 'cylinder'
      || this.primitiveType === 'cone'
      || this.primitiveType === 'torus';
  }

  /**
   * Check if ready to commit (all required params filled)
   */
  isComplete(): boolean {
    if (!this.anchor) return false;
    if (this.params.radius <= 0) return false;
    if (this.requiresSizing2() && this.params.height <= 0) return false;
    return true;
  }

  /**
   * Get active parameter key for current sizing state
   */
  getActiveSizingParam(): keyof PrimitiveParams | null {
    if (this.state === 'sizing1') return 'radius';
    if (this.state === 'sizing2') return 'height';
    return null;
  }

  /**
   * Reset session for next creation
   */
  reset(): void {
    this.state = 'idle';
    this.anchor = null;
    this.axis = new THREE.Vector3(0, 0, 1);
    this.params = { radius: 0, height: 0, topRadius: 0 };
    this.preview = {};
    this.inputLock = false;
  }

  /**
   * Dispose preview geometry
   */
  dispose(): void {
    if (this.preview.radiusCircle) {
      this.preview.radiusCircle.geometry.dispose();
      (this.preview.radiusCircle.material as THREE.Material).dispose();
    }
    if (this.preview.heightAxis) {
      this.preview.heightAxis.geometry.dispose();
      (this.preview.heightAxis.material as THREE.Material).dispose();
    }
    if (this.preview.silhouette) {
      this.preview.silhouette.geometry.dispose();
      (this.preview.silhouette.material as THREE.Material).dispose();
    }
    this.reset();
  }
}
