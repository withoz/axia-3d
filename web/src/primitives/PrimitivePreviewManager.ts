/**
 * PrimitivePreviewManager — Unified preview rendering for Sphere/Cylinder/Cone
 * Renders radius circle (Sizing1) + height axis (Sizing2)
 * Lightweight: uses LineSegments + ArrowHelper for axis
 */

import * as THREE from 'three';
import { PrimitiveSession, PrimitiveParams } from './PrimitiveSession';

export class PrimitivePreviewManager {
  private scene: THREE.Scene;
  private session: PrimitiveSession;

  // Material cache (reused for all previews)
  private radiusCircleMaterial: THREE.LineBasicMaterial;
  private axisLineMaterial: THREE.LineBasicMaterial;

  // Sizing1: radius circle
  private radiusCircleGeometry: THREE.BufferGeometry | null = null;

  // Sizing2: height axis (simple line)
  private heightAxisGeometry: THREE.BufferGeometry | null = null;

  constructor(scene: THREE.Scene, session: PrimitiveSession) {
    this.scene = scene;
    this.session = session;

    // Create reusable materials
    this.radiusCircleMaterial = new THREE.LineBasicMaterial({
      color: 0x5b9bd5,
      linewidth: 2,
      depthTest: false,
    });

    this.axisLineMaterial = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      linewidth: 2,
      depthTest: false,
    });
  }

  /**
   * Update preview when params change
   * Called whenever session.params is updated
   */
  updatePreview(params: PrimitiveParams, state: string): void {
    // Sizing1: Show radius circle
    if (state === 'sizing1' || state === 'sizing2') {
      this.updateRadiusCircle(params.radius);
    } else {
      this.clearRadiusCircle();
    }

    // Sizing2: Show height axis (if applicable)
    if (state === 'sizing2') {
      this.updateHeightAxis(params.height);
    } else {
      this.clearHeightAxis();
    }
  }

  /**
   * Create/update radius circle (on XZ plane relative to anchor)
   * Segments: 32 (balance between visual quality and performance)
   */
  private updateRadiusCircle(radius: number): void {
    // Remove old geometry and dispose
    if (this.session.preview.radiusCircle) {
      this.scene.remove(this.session.preview.radiusCircle);
      this.session.preview.radiusCircle.geometry.dispose();
    }

    if (radius <= 0 || !this.session.anchor) return;

    const segments = 32;
    const points: THREE.Vector3[] = [];

    // Build circle in anchor's local plane (perpendicular to axis)
    const axis = this.session.axis;
    let tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(axis.dot(tangent)) > 0.9) {
      tangent = new THREE.Vector3(0, 1, 0);
    }
    const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();
    tangent = new THREE.Vector3().crossVectors(bitangent, axis).normalize();

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const point = new THREE.Vector3()
        .copy(this.session.anchor)
        .addScaledVector(tangent, x)
        .addScaledVector(bitangent, z);
      points.push(point);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineSegments(geometry, this.radiusCircleMaterial);
    this.scene.add(line);
    this.session.preview.radiusCircle = line;
  }

  /**
   * Clear radius circle preview
   */
  private clearRadiusCircle(): void {
    if (this.session.preview.radiusCircle) {
      this.scene.remove(this.session.preview.radiusCircle);
      this.session.preview.radiusCircle.geometry.dispose();
      this.session.preview.radiusCircle = undefined;
    }
  }

  /**
   * Create/update height axis line (vertical guide)
   * Shows direction and magnitude of height
   */
  private updateHeightAxis(height: number): void {
    // Remove old geometry and dispose
    if (this.session.preview.heightAxis) {
      this.scene.remove(this.session.preview.heightAxis);
      this.session.preview.heightAxis.geometry.dispose();
    }

    if (height <= 0 || !this.session.anchor) return;

    const start = this.session.anchor.clone();
    const end = new THREE.Vector3()
      .copy(this.session.anchor)
      .addScaledVector(this.session.axis, height);

    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, this.axisLineMaterial);
    this.scene.add(line);
    this.session.preview.heightAxis = line;
  }

  /**
   * Clear height axis preview
   */
  private clearHeightAxis(): void {
    if (this.session.preview.heightAxis) {
      this.scene.remove(this.session.preview.heightAxis);
      this.session.preview.heightAxis.geometry.dispose();
      this.session.preview.heightAxis = undefined;
    }
  }

  /**
   * Cleanup: dispose all geometries and remove from scene
   */
  dispose(): void {
    this.clearRadiusCircle();
    this.clearHeightAxis();
    this.radiusCircleMaterial.dispose();
    this.axisLineMaterial.dispose();
  }
}
