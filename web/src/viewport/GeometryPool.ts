import * as THREE from 'three';

/**
 * Object pool for Three.js geometries and materials to reduce GC pressure.
 * Used during ghost preview updates where geometry changes every frame.
 */
export class GeometryPool {
  private meshPool: THREE.Mesh[] = [];
  private linePool: THREE.LineSegments[] = [];
  private poolSize = 20;

  /**
   * Acquire a mesh from the pool or create a new one.
   * Be sure to call release() when done.
   */
  acquireMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (this.meshPool.length > 0) {
      mesh = this.meshPool.pop()!;
      mesh.geometry = geometry;
      mesh.material = material;
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }
    return mesh;
  }

  /**
   * Acquire a line segments object from the pool or create a new one.
   * Be sure to call release() when done.
   */
  acquireLines(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.LineSegments {
    let lines: THREE.LineSegments;
    if (this.linePool.length > 0) {
      lines = this.linePool.pop()!;
      lines.geometry = geometry;
      lines.material = material;
    } else {
      lines = new THREE.LineSegments(geometry, material);
    }
    return lines;
  }

  /**
   * Release an object back to the pool.
   * Only meshes and line segments are pooled.
   */
  release(obj: THREE.Object3D): void {
    if (obj instanceof THREE.Mesh && this.meshPool.length < this.poolSize) {
      // Clear references to prevent memory leaks
      obj.geometry.dispose();
      this.meshPool.push(obj);
    } else if (obj instanceof THREE.LineSegments && this.linePool.length < this.poolSize) {
      // Clear references to prevent memory leaks
      obj.geometry.dispose();
      this.linePool.push(obj);
    } else {
      // Pool is full or wrong type, dispose it
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
      }
      if ((obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) && obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
  }

  /**
   * Dispose all pooled objects and clear the pool.
   * Call this when shutting down the viewport.
   */
  dispose(): void {
    this.meshPool.forEach(mesh => {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
    });
    this.meshPool.length = 0;

    this.linePool.forEach(lines => {
      lines.geometry.dispose();
      if (Array.isArray(lines.material)) {
        lines.material.forEach(m => m.dispose());
      } else {
        lines.material.dispose();
      }
    });
    this.linePool.length = 0;
  }

  /**
   * Get the current pool statistics (for debugging).
   */
  getStats(): { meshPoolSize: number; linePoolSize: number } {
    return {
      meshPoolSize: this.meshPool.length,
      linePoolSize: this.linePool.length,
    };
  }
}
