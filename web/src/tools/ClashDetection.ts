/**
 * ClashDetection — 선택된 그룹/XIA 간의 기하학적 간섭(충돌) 감지.
 *
 * 건축 BIM 기본 기능 — "기둥이 빔을 뚫고 있는가?", "벽과 덕트가 겹치는가?"
 *
 * MVP 알고리즘 (AABB overlap):
 *   1. 각 그룹/XIA의 월드 AABB 계산
 *   2. 모든 쌍 AABB 겹침 테스트 (N*(N-1)/2 쌍)
 *   3. 겹치는 쌍 목록 반환 + 하이라이트
 *   4. Clash 영역을 빨간 박스로 시각화
 *
 * 한계:
 *   · AABB는 conservative — 실제 geometry가 안 겹쳐도 bbox가 겹치면 감지됨
 *   · 정확한 face-level intersection은 Phase 2 (mesh-mesh triangulate overlap)
 *   · 현재는 선택된 객체만 대상 (전체 씬 일괄은 추후 "BIM 감사")
 */

import * as THREE from 'three';
import type { Viewport } from '../viewport/Viewport';

export interface ClashResult {
  groupIdA: number;
  groupIdB: number;
  overlap: THREE.Box3;
  volume_mm3: number;
}

export class ClashDetection {
  private viewport: Viewport;
  private markers: THREE.Object3D[] = [];

  constructor(viewport: Viewport) {
    this.viewport = viewport;
  }

  /**
   * 전체 그룹을 순회해 AABB 간섭 확인. 그룹 정의 없으면 개별 mesh 간 체크.
   */
  detect(): ClashResult[] {
    // 씬의 모든 최상위 Group 수집 (현재 엔진의 그룹 시스템은 face 기반이라
    //   Three.js Object3D 수준의 그룹은 별도. MVP로는 meshGroup의 모든
    //   mesh를 각각 "객체"로 간주).
    const objects: { box: THREE.Box3; id: number; mesh: THREE.Mesh }[] = [];
    let nextId = 1;
    this.viewport.meshGroup?.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData.noPick) return;
      // projected-shadow / solar-heatmap removed 2026-05-16 (shadow → ADR-106)
      obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox;
      if (!bb) return;
      const worldBox = bb.clone().applyMatrix4(obj.matrixWorld);
      objects.push({ box: worldBox, id: nextId++, mesh: obj });
    });

    const results: ClashResult[] = [];
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        const a = objects[i];
        const b = objects[j];
        if (a.box.intersectsBox(b.box)) {
          const overlap = a.box.clone().intersect(b.box);
          const size = overlap.getSize(new THREE.Vector3());
          const vol = size.x * size.y * size.z;
          if (vol > 1) {  // 1mm³ 이상만 의미 있는 clash로 간주
            results.push({
              groupIdA: a.id,
              groupIdB: b.id,
              overlap,
              volume_mm3: vol,
            });
          }
        }
      }
    }

    this.visualize(results);
    return results;
  }

  clear(): void {
    for (const m of this.markers) {
      this.viewport.scene.remove(m);
      if (m instanceof THREE.Mesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
    this.markers = [];
  }

  private visualize(results: ClashResult[]): void {
    this.clear();
    for (const r of results) {
      const size = r.overlap.getSize(new THREE.Vector3());
      const center = r.overlap.getCenter(new THREE.Vector3());
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff3030,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(center);
      mesh.userData.noPick = true;
      mesh.renderOrder = 500;

      // Add wireframe outline for visibility.
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      edges.position.copy(center);
      edges.renderOrder = 501;

      this.viewport.scene.add(mesh);
      this.viewport.scene.add(edges);
      this.markers.push(mesh, edges);
    }
  }
}
