/**
 * DrawPlaneIndicator — hover-time visualization of the drawing plane.
 *
 * When a drawing tool (line/rect/circle/arc/freehand/bezier) is active and
 * the user is not yet drawing, a tiny RGB axes gizmo is rendered at the
 * cursor location, oriented to the plane that a click would capture:
 *   • red   = `right`  (local U)
 *   • green = `up`     (local V)
 *   • blue  = `normal` (local N)
 *
 * A faint translucent quad around the origin makes the plane legible even
 * when the axes are nearly edge-on to the camera.
 *
 * Usage:
 *   const ind = new DrawPlaneIndicator(viewport.scene);
 *   ind.show(worldPoint, { normal, up, right, onFace });
 *   ind.hide();
 *   ind.dispose();
 *
 * Size is fixed in world units (mm). The indicator is rendered on top of
 * geometry (`depthTest: false`) and has `renderOrder: 2000` so it stays
 * visible against the main mesh.
 */

import * as THREE from 'three';

export interface PlaneFrame {
  readonly normal: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly onFace: boolean;
}

const AXIS_LEN = 40;   // mm — axis length
const QUAD_HALF = 18;  // mm — plane patch half-size
const COLOR_RIGHT = 0xff5c5c;
const COLOR_UP    = 0x5cff7a;
const COLOR_NORM  = 0x5ca8ff;
const COLOR_QUAD_FACE   = 0x74c0fc;
const COLOR_QUAD_GROUND = 0xadb5bd;

export class DrawPlaneIndicator {
  private scene: THREE.Scene;
  private group: THREE.Group;

  // axes — three Line segments sharing no state
  private rightLine: THREE.Line;
  private upLine: THREE.Line;
  private normalLine: THREE.Line;

  // translucent plane patch
  private quad: THREE.Mesh;
  private quadMat: THREE.MeshBasicMaterial;

  private visible = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.renderOrder = 2000;
    this.group.visible = false;

    const makeAxis = (color: number): THREE.Line => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(AXIS_LEN, 0, 0),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
        // ADR/H4 fix (2026-05-02): transparent + depthWrite:true 는 THREE.js
        // anti-pattern. Overlay 가 자기 depth 를 buffer 에 써서 SSAO post-pass
        // 와 다음 frame 에서 다른 객체를 의도치 않게 가림. 사용자 보고
        // "rect 활성 시 라인 사라짐" 의 후보 원인.
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 2001;
      return line;
    };

    this.rightLine = makeAxis(COLOR_RIGHT);
    this.upLine = makeAxis(COLOR_UP);
    this.normalLine = makeAxis(COLOR_NORM);
    this.group.add(this.rightLine, this.upLine, this.normalLine);

    // Plane patch — a unit quad in local (right,up) space, scaled at show().
    const quadGeo = new THREE.PlaneGeometry(QUAD_HALF * 2, QUAD_HALF * 2);
    this.quadMat = new THREE.MeshBasicMaterial({
      color: COLOR_QUAD_GROUND,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthTest: false,
      // H4 fix (2026-05-02): same as axes — depthWrite:false 강제. 36×36mm
      // 의 큰 plane 패치가 자기 depth 를 buffer 에 쓰면 SSAO post-pass
      // 가 그 영역의 ambient occlusion 을 잘못 계산해서 라인 contrast 가
      // 떨어지거나 다음 frame 에서 의도치 않게 occluder 역할.
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(quadGeo, this.quadMat);
    this.quad.renderOrder = 2000;
    this.group.add(this.quad);

    scene.add(this.group);
  }

  /** Position the gizmo at `origin` and orient it to `plane`. */
  show(origin: THREE.Vector3, plane: PlaneFrame): void {
    // Orient axes: right→X+, up→Y+, normal→Z+ of local frame
    // THREE.Line geometry was built along X+ so we rotate per axis.
    this.rightLine.position.copy(origin);
    this.rightLine.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0), plane.right,
    );

    this.upLine.position.copy(origin);
    this.upLine.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0), plane.up,
    );

    this.normalLine.position.copy(origin);
    this.normalLine.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0), plane.normal,
    );

    // Plane patch: PlaneGeometry is in XY with +Z normal; align local Z to plane.normal.
    this.quad.position.copy(origin);
    this.quad.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), plane.normal,
    );
    this.quadMat.color.setHex(plane.onFace ? COLOR_QUAD_FACE : COLOR_QUAD_GROUND);

    if (!this.visible) {
      this.group.visible = true;
      this.visible = true;
    }
  }

  hide(): void {
    if (this.visible) {
      this.group.visible = false;
      this.visible = false;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.rightLine.geometry.dispose();
    (this.rightLine.material as THREE.Material).dispose();
    this.upLine.geometry.dispose();
    (this.upLine.material as THREE.Material).dispose();
    this.normalLine.geometry.dispose();
    (this.normalLine.material as THREE.Material).dispose();
    this.quad.geometry.dispose();
    this.quadMat.dispose();
  }
}
