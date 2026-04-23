/**
 * SectionPlane — 건축/CAD 단면도 생성.
 *
 * Three.js의 global clipping planes를 활용해 축 정렬(XY/YZ/XZ) 단면을
 * 실시간으로 생성. SketchUp의 "Section Plane" 기능 대응 MVP.
 *
 * 기능:
 *   · 3축(X/Y/Z) 중 하나 선택 → 해당 축 방향 clip plane 활성
 *   · 슬라이더 드래그로 위치 조정 → 실시간 단면 업데이트
 *   · 뒤집기(flip) 버튼 → 잘라내는 방향 전환
 *   · 비활성 모드 → 완전 해제 (메시 원상 복구)
 *
 * 제약 (MVP):
 *   · 축 정렬 단면만 지원. 임의 각도 섹션은 Phase 2 (arbitrary-axis plane)
 *   · Cross-section fill 없음 (잘린 단면에 2D fill 그리는 기능은 추후)
 *   · Multi-plane 동시 활성 불가 (SketchUp Pro는 여러 개 동시 가능)
 */

import * as THREE from 'three';
import type { Viewport } from './Viewport';

export type SectionAxis = 'x' | 'y' | 'z' | 'off';

export class SectionPlane {
  private viewport: Viewport;
  private plane: THREE.Plane = new THREE.Plane();
  private axis: SectionAxis = 'off';
  private position: number = 0;    // world-space distance along axis
  private flipped: boolean = false;

  /** Visual cue — 단면 위치 하이라이트 (얇은 colored plane mesh). */
  private indicator: THREE.Mesh | null = null;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    // Enable local clipping so only affected objects (meshGroup) get cut.
    viewport.renderer.localClippingEnabled = true;
  }

  /** 축을 설정하거나 'off'로 비활성화. */
  setAxis(axis: SectionAxis): void {
    this.axis = axis;
    if (axis === 'off') {
      this.clearClipping();
      this.removeIndicator();
      return;
    }
    this.rebuildPlane();
    this.applyClipping();
    this.buildIndicator();
  }

  setPosition(pos: number): void {
    this.position = pos;
    if (this.axis === 'off') return;
    this.rebuildPlane();
    this.applyClipping();
    this.updateIndicator();
  }

  setFlipped(flipped: boolean): void {
    this.flipped = flipped;
    if (this.axis === 'off') return;
    this.rebuildPlane();
    this.applyClipping();
  }

  getState(): { axis: SectionAxis; position: number; flipped: boolean } {
    return { axis: this.axis, position: this.position, flipped: this.flipped };
  }

  dispose(): void {
    this.clearClipping();
    this.removeIndicator();
  }

  // ───────────────────────────────────────────────────────────

  private rebuildPlane(): void {
    let n: THREE.Vector3;
    switch (this.axis) {
      case 'x': n = new THREE.Vector3(1, 0, 0); break;
      case 'y': n = new THREE.Vector3(0, 1, 0); break;
      case 'z': n = new THREE.Vector3(0, 0, 1); break;
      default: return;
    }
    if (this.flipped) n.negate();
    // Three.js Plane: n·p + constant = 0. clip keeps side where n·p + const > 0.
    // We want to keep the side OPPOSITE the axis direction from the position,
    // so that increasing position "reveals more" of the object.
    this.plane.setFromNormalAndCoplanarPoint(n, n.clone().multiplyScalar(this.position));
  }

  private applyClipping(): void {
    const planes = [this.plane];
    // Traverse meshGroup and set clipping planes on all materials.
    this.viewport.meshGroup?.traverse((obj) => {
      const m = (obj as THREE.Mesh).material;
      if (!m) return;
      const apply = (mat: THREE.Material) => {
        (mat as THREE.Material & { clippingPlanes?: THREE.Plane[] }).clippingPlanes = planes;
        (mat as THREE.Material & { clipIntersection?: boolean }).clipIntersection = false;
      };
      if (Array.isArray(m)) m.forEach(apply);
      else apply(m);
    });
  }

  private clearClipping(): void {
    this.viewport.meshGroup?.traverse((obj) => {
      const m = (obj as THREE.Mesh).material;
      if (!m) return;
      const clear = (mat: THREE.Material) => {
        (mat as THREE.Material & { clippingPlanes?: THREE.Plane[] | null }).clippingPlanes = null;
      };
      if (Array.isArray(m)) m.forEach(clear);
      else clear(m);
    });
  }

  private buildIndicator(): void {
    this.removeIndicator();
    const size = 50000;  // huge so it spans the scene
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: this.axisColor(),
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.indicator = new THREE.Mesh(geo, mat);
    this.indicator.userData.noPick = true;
    this.indicator.renderOrder = 2000;
    this.updateIndicator();
    this.viewport.scene.add(this.indicator);
  }

  private updateIndicator(): void {
    if (!this.indicator) return;
    switch (this.axis) {
      case 'x':
        this.indicator.rotation.set(0, Math.PI / 2, 0);
        this.indicator.position.set(this.position, 0, 0);
        break;
      case 'y':
        this.indicator.rotation.set(-Math.PI / 2, 0, 0);
        this.indicator.position.set(0, this.position, 0);
        break;
      case 'z':
        this.indicator.rotation.set(0, 0, 0);
        this.indicator.position.set(0, 0, this.position);
        break;
      default: break;
    }
  }

  private removeIndicator(): void {
    if (this.indicator) {
      this.viewport.scene.remove(this.indicator);
      this.indicator.geometry.dispose();
      (this.indicator.material as THREE.Material).dispose();
      this.indicator = null;
    }
  }

  private axisColor(): number {
    switch (this.axis) {
      case 'x': return 0xff4f4f;
      case 'y': return 0x4fff4f;
      case 'z': return 0x4f4fff;
      default: return 0xffffff;
    }
  }
}
