/**
 * OffsetSessionManager — 단순화된 Offset/Push-Pull 상태 관리 (최적화됨)
 */

import * as THREE from 'three';
import { ToolContext } from './ITool';
import { debugLog, debugWarn } from '../utils/debug';

export interface OffsetSession {
  target: { type: 'single' | 'smooth_group'; faceIds: number[] };
  input: { distance: number; bothSides?: boolean; solidify?: boolean };
  ui: { active: boolean; mode: 'preview' | 'confirm'; inputMethod: 'mouse' | 'vcb' | 'snap'; startTime: number };
  preview: { ghostGroup: THREE.Group | null; labelText: string; previewDistance: number };
  snap: { enabled: boolean; gridSnap?: number };
}

export class OffsetSessionManager {
  private session: OffsetSession | null = null;
  private ctx: ToolContext;
  private ghostMaterial: THREE.MeshBasicMaterial | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  start(faceIds: number[]): boolean {
    if (this.session) {
      debugWarn('[OffsetSessionManager] Session already active');
      return false;
    }

    if (!faceIds || faceIds.length === 0) {
      return false;
    }

    this.session = {
      target: { type: faceIds.length > 1 ? 'smooth_group' : 'single', faceIds },
      input: { distance: 0, bothSides: false, solidify: false },
      ui: { active: true, mode: 'preview', inputMethod: 'mouse', startTime: Date.now() },
      preview: { ghostGroup: null, labelText: '0.0 mm', previewDistance: 0 },
      snap: { enabled: true, gridSnap: 1.0 },
    };

    debugLog('[OffsetSessionManager] Session started:', this.session.target.type, 'faces:', faceIds.length);
    return true;
  }

  setParam(distance: number, source: 'mouse' | 'vcb' | 'snap' = 'mouse'): void {
    if (!this.session) return;

    const snappedDistance = this.applySnap(distance);
    this.session.input.distance = snappedDistance;
    this.session.preview.previewDistance = snappedDistance;
    this.session.ui.inputMethod = source;
    this.session.ui.mode = 'preview';

    this.updatePreview();
  }

  confirm(): boolean {
    if (!this.session) return false;

    try {
      this.applyOffset();
      this.cleanup();
      this.session = null;
      return true;
    } catch (e) {
      debugWarn('[OffsetSessionManager] Confirm failed:', e);
      return false;
    }
  }

  cancel(): void {
    if (!this.session) return;

    this.cleanup();
    this.ctx.bridge.undo();
    this.session = null;
  }

  isActive(): boolean {
    return this.session?.ui.active ?? false;
  }

  getCurrentDistance(): number {
    return this.session?.input.distance ?? 0;
  }

  getSession(): OffsetSession | null {
    return this.session;
  }

  // ─── Preview 갱신 ───────────────────────

  private updatePreview(): void {
    if (!this.session) return;

    this.updateSimpleGhost();
    this.updateLabel();
  }

  /**
   * 간단한 ghost 표시 (성능 최적화)
   */
  private updateSimpleGhost(): void {
    if (!this.session) return;

    if (!this.session.preview.ghostGroup) {
      this.session.preview.ghostGroup = new THREE.Group();
      this.ctx.viewport.scene.add(this.session.preview.ghostGroup);
    }

    // 이전 content 제거
    this.session.preview.ghostGroup.clear();

    const { faceIds } = this.session.target;
    const distance = this.session.preview.previewDistance;

    // 최대 5개 face만 표시 (성능)
    for (let i = 0; i < Math.min(faceIds.length, 5); i++) {
      const faceId = faceIds[i];
      
      // 면의 centroid 구하기
      const centroidData = this.ctx.bridge.facesCentroid([faceId]);
      const normal = this.ctx.bridge.getFaceNormal(faceId);

      if (!centroidData || !normal) continue;

      // centroidData는 Vector3
      const centroid = centroidData.clone();

      const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
      const length = Math.abs(distance) || 5;
      const arrowColor = distance > 0 ? 0x00ff00 : 0xff0000;

      const arrow = new THREE.ArrowHelper(n, centroid, length, arrowColor, 2, 2);
      this.session.preview.ghostGroup.add(arrow);
    }
  }

  private updateLabel(): void {
    if (!this.session) return;

    const distance = this.session.preview.previewDistance;
    const sign = distance >= 0 ? '' : '-';
    const absDist = Math.abs(distance);
    this.session.preview.labelText = sign + this.ctx.units.format(absDist);
  }

  // ─── Offset 적용 ───────────────────────

  private applyOffset(): void {
    if (!this.session) return;

    const { faceIds, type } = this.session.target;
    const distance = this.session.input.distance;

    if (type === 'smooth_group' && faceIds.length > 1) {
      const faceArray = new Uint32Array(faceIds);
      const ok = this.ctx.bridge.engine?.push_pull_smooth_group_seamless?.(faceArray, distance) ?? false;
      if (ok) {
        this.ctx.syncMesh();
      }
    } else {
      // ADR-087 K-ζ — kernel-aware createSolidExtrude only.
      const ok = this.ctx.bridge.createSolidExtrude(faceIds[0], distance);
      if (ok) {
        this.ctx.syncMesh();
      }
    }
  }

  // ─── Cleanup ───────────────────────

  private cleanup(): void {
    if (!this.session || !this.session.preview.ghostGroup) return;

    this.ctx.viewport.scene.remove(this.session.preview.ghostGroup);

    this.session.preview.ghostGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      } else if (child instanceof THREE.Line) {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      }
    });

    this.session.preview.ghostGroup.clear();
    this.session.preview.ghostGroup = null;
  }

  // ─── 유틸리티 ───────────────────────

  private applySnap(value: number): number {
    if (!this.session || !this.session.snap.enabled) return value;
    const gridSnap = this.session.snap.gridSnap ?? 1.0;
    return Math.round(value / gridSnap) * gridSnap;
  }

  dispose(): void {
    this.ghostMaterial?.dispose?.();
    this.ghostMaterial = null;
    if (this.session) {
      this.cleanup();
      this.session = null;
    }
  }
}
