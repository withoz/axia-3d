/**
 * ADR-039 P24.5 회귀 테스트 — Hover 시각 적용 (Viewport).
 *
 * `setHoveredOwner` 가 face hover 시 colorAttribute 를 in-place tint,
 * hover 해제 시 원본 복원하는지 검증.
 *
 * Edge hover 의 시각 적용은 별도 PR (overlay LineSegments 추가 필요) —
 * 본 commit 은 state 저장만 검증.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

/**
 * Test 용 mini Viewport — 실제 Viewport 클래스의 hover 관련 부분만
 * 추출. 진짜 Viewport 는 WebGL renderer 가 필요하므로 단위 테스트 어려움.
 *
 * 검증 대상:
 *   - setHoveredOwner (state 저장 + tint apply / restore)
 *   - getHoveredOwner
 *   - face hover tint 의 colorAttribute 변경
 *   - hover 해제 시 원본 복원
 */
class HoverViewportStub {
  faceMap: Uint32Array = new Uint32Array(0);
  indexBuffer: Uint32Array = new Uint32Array(0);
  colorAttribute: THREE.BufferAttribute | null = null;

  private _hoveredOwner: { kind: 'edge' | 'face'; id: number } | null = null;
  private _hoverFaceColorCache: Map<number, Float32Array> = new Map();

  setHoveredOwner(target: { kind: 'edge' | 'face'; id: number } | null): void {
    if (this._hoveredOwner?.kind === 'face') {
      this._restoreFaceHoverTint(this._hoveredOwner.id);
    }
    this._hoveredOwner = target;
    if (target?.kind === 'face') {
      this._applyFaceHoverTint(target.id);
    }
  }

  getHoveredOwner() {
    return this._hoveredOwner;
  }

  private _applyFaceHoverTint(faceId: number): void {
    if (!this.colorAttribute || this.faceMap.length === 0
        || this.indexBuffer.length === 0) return;
    const colorArr = this.colorAttribute.array as Float32Array;
    const idxArr = this.indexBuffer;
    const verts = new Set<number>();
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (this.faceMap[tri] === faceId) {
        verts.add(idxArr[tri * 3]);
        verts.add(idxArr[tri * 3 + 1]);
        verts.add(idxArr[tri * 3 + 2]);
      }
    }
    if (verts.size === 0) return;
    const saved = new Float32Array(verts.size * 4);
    let i = 0;
    for (const v of verts) {
      const r = colorArr[v * 3], g = colorArr[v * 3 + 1], b = colorArr[v * 3 + 2];
      saved[i*4] = v; saved[i*4+1] = r; saved[i*4+2] = g; saved[i*4+3] = b;
      colorArr[v*3]   = Math.min(1, r * 0.7 + 0.4);
      colorArr[v*3+1] = Math.min(1, g * 0.7 + 0.4);
      colorArr[v*3+2] = Math.min(1, b * 0.7 + 0.6);
      i++;
    }
    this._hoverFaceColorCache.set(faceId, saved);
    this.colorAttribute.needsUpdate = true;
  }

  private _restoreFaceHoverTint(faceId: number): void {
    const saved = this._hoverFaceColorCache.get(faceId);
    if (!saved || !this.colorAttribute) return;
    const colorArr = this.colorAttribute.array as Float32Array;
    const n = saved.length / 4;
    for (let k = 0; k < n; k++) {
      const v = saved[k*4];
      colorArr[v*3]   = saved[k*4+1];
      colorArr[v*3+1] = saved[k*4+2];
      colorArr[v*3+2] = saved[k*4+3];
    }
    this._hoverFaceColorCache.delete(faceId);
    this.colorAttribute.needsUpdate = true;
  }
}

describe('ADR-039 P24.5 — Hover 시각 적용 (Viewport)', () => {
  let vp: HoverViewportStub;
  let originalColors: Float32Array;

  beforeEach(() => {
    vp = new HoverViewportStub();
    // 6 vertex (2 triangles, faceId 7), 색은 모두 0.5 (회색)
    originalColors = new Float32Array([
      0.5, 0.5, 0.5,  // v0
      0.5, 0.5, 0.5,  // v1
      0.5, 0.5, 0.5,  // v2
      0.5, 0.5, 0.5,  // v3
      0.5, 0.5, 0.5,  // v4
      0.5, 0.5, 0.5,  // v5
    ]);
    vp.colorAttribute = new THREE.BufferAttribute(originalColors, 3);
    vp.indexBuffer = new Uint32Array([0, 1, 2, 3, 4, 5]);
    vp.faceMap = new Uint32Array([7, 7]);  // 2 triangles, faceId 7
  });

  it('초기 상태: hovered = null', () => {
    expect(vp.getHoveredOwner()).toBeNull();
  });

  it('Face hover → state 저장 + colorAttribute tint 적용', () => {
    vp.setHoveredOwner({ kind: 'face', id: 7 });

    // State
    expect(vp.getHoveredOwner()).toEqual({ kind: 'face', id: 7 });

    // Color tint 적용 — face 7 의 6 vertex 모두 변경
    const arr = vp.colorAttribute!.array as Float32Array;
    const expectedR = Math.min(1, 0.5 * 0.7 + 0.4);
    const expectedG = Math.min(1, 0.5 * 0.7 + 0.4);
    const expectedB = Math.min(1, 0.5 * 0.7 + 0.6);
    for (let v = 0; v < 6; v++) {
      expect(arr[v * 3]).toBeCloseTo(expectedR, 6);
      expect(arr[v * 3 + 1]).toBeCloseTo(expectedG, 6);
      expect(arr[v * 3 + 2]).toBeCloseTo(expectedB, 6);
    }
    expect(vp.colorAttribute!.needsUpdate).toBe(true);
  });

  it('Face hover 해제 (null) → 원본 복원', () => {
    vp.setHoveredOwner({ kind: 'face', id: 7 });
    vp.setHoveredOwner(null);

    expect(vp.getHoveredOwner()).toBeNull();
    const arr = vp.colorAttribute!.array as Float32Array;
    for (let v = 0; v < 6; v++) {
      expect(arr[v * 3]).toBeCloseTo(0.5, 6);
      expect(arr[v * 3 + 1]).toBeCloseTo(0.5, 6);
      expect(arr[v * 3 + 2]).toBeCloseTo(0.5, 6);
    }
  });

  it('Face A → Face B 전환: A 복원 + B tint 적용', () => {
    // setup: face 7 + face 11
    vp.faceMap = new Uint32Array([7, 11]);
    vp.indexBuffer = new Uint32Array([0, 1, 2, 3, 4, 5]);

    vp.setHoveredOwner({ kind: 'face', id: 7 });
    // face 7 의 verts (0,1,2) tint 적용됨

    vp.setHoveredOwner({ kind: 'face', id: 11 });
    expect(vp.getHoveredOwner()).toEqual({ kind: 'face', id: 11 });

    const arr = vp.colorAttribute!.array as Float32Array;
    const tintR = Math.min(1, 0.5 * 0.7 + 0.4);
    // face 7 (verts 0,1,2): 원본 복원
    for (let v = 0; v <= 2; v++) {
      expect(arr[v * 3]).toBeCloseTo(0.5, 6);
    }
    // face 11 (verts 3,4,5): tint 적용
    for (let v = 3; v <= 5; v++) {
      expect(arr[v * 3]).toBeCloseTo(tintR, 6);
    }
  });

  it('Edge hover → state 저장 (시각은 별도 PR, 본 commit 은 색 변경 안 함)', () => {
    vp.setHoveredOwner({ kind: 'edge', id: 99 });

    expect(vp.getHoveredOwner()).toEqual({ kind: 'edge', id: 99 });

    // colorAttribute 는 변동 없음 (edge hover 는 face tint 와 무관)
    const arr = vp.colorAttribute!.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      expect(arr[i]).toBeCloseTo(0.5, 6);
    }
  });

  it('Edge → Face 전환: edge state clear + face tint 적용', () => {
    vp.setHoveredOwner({ kind: 'edge', id: 99 });
    vp.setHoveredOwner({ kind: 'face', id: 7 });

    expect(vp.getHoveredOwner()).toEqual({ kind: 'face', id: 7 });
    const arr = vp.colorAttribute!.array as Float32Array;
    const tintR = Math.min(1, 0.5 * 0.7 + 0.4);
    expect(arr[0]).toBeCloseTo(tintR, 6);
  });

  it('Empty colorAttribute → no-op (graceful)', () => {
    const empty = new HoverViewportStub();
    empty.faceMap = new Uint32Array([7]);
    empty.indexBuffer = new Uint32Array([0, 1, 2]);
    // colorAttribute = null
    empty.setHoveredOwner({ kind: 'face', id: 7 });
    expect(empty.getHoveredOwner()).toEqual({ kind: 'face', id: 7 });
    // No crash
  });

  it('Empty faceMap → tint apply 안 함 (graceful)', () => {
    const empty = new HoverViewportStub();
    empty.faceMap = new Uint32Array(0);
    empty.indexBuffer = new Uint32Array(0);
    empty.colorAttribute = vp.colorAttribute;
    empty.setHoveredOwner({ kind: 'face', id: 7 });
    // No-op — original colors 유지
    const arr = empty.colorAttribute!.array as Float32Array;
    expect(arr[0]).toBeCloseTo(0.5, 6);
  });

  it('faceId mismatch → tint apply 안 함', () => {
    vp.setHoveredOwner({ kind: 'face', id: 999 });  // 존재하지 않는 face
    const arr = vp.colorAttribute!.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      expect(arr[i]).toBeCloseTo(0.5, 6);
    }
  });

  it('null → null (no-op)', () => {
    vp.setHoveredOwner(null);
    expect(vp.getHoveredOwner()).toBeNull();
    // No crash
  });
});
