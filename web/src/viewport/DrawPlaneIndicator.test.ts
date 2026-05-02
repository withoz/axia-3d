import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DrawPlaneIndicator } from './DrawPlaneIndicator';

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function flatPlane() {
  return {
    normal: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    onFace: false,
  };
}

function facePlane() {
  return {
    normal: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(0, 0, -1),
    onFace: true,
  };
}

describe('DrawPlaneIndicator', () => {
  let scene: THREE.Scene;
  let ind: DrawPlaneIndicator;

  beforeEach(() => {
    scene = makeScene();
    ind = new DrawPlaneIndicator(scene);
  });

  it('attaches a single group to the scene on construction', () => {
    // one Group added; 3 axes + 1 quad are children of it
    expect(scene.children.length).toBe(1);
  });

  it('starts hidden', () => {
    expect(ind.isVisible()).toBe(false);
  });

  it('show() makes it visible', () => {
    ind.show(new THREE.Vector3(10, 20, 30), flatPlane());
    expect(ind.isVisible()).toBe(true);
  });

  it('hide() toggles visibility off', () => {
    ind.show(new THREE.Vector3(), flatPlane());
    ind.hide();
    expect(ind.isVisible()).toBe(false);
  });

  it('show twice is idempotent (stays visible)', () => {
    ind.show(new THREE.Vector3(), flatPlane());
    ind.show(new THREE.Vector3(1, 0, 0), facePlane());
    expect(ind.isVisible()).toBe(true);
  });

  it('dispose() removes the group from the scene', () => {
    ind.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('accepts both ground and face planes without error', () => {
    expect(() => {
      ind.show(new THREE.Vector3(0, 0, 0), flatPlane());
      ind.show(new THREE.Vector3(5, 5, 5), facePlane());
    }).not.toThrow();
  });

  // H4 fix regression (2026-05-02). Without depthWrite:false on overlay
  // materials, transparent overlay 가 자기 depth 를 buffer 에 써서 SSAO
  // post-pass 와 다음 frame 에서 의도치 않게 다른 객체를 가림. 사용자
  // 보고 "rect 활성 시 라인 사라짐" 의 후보 원인.
  describe('depthWrite invariant (H4 fix)', () => {
    it('quad material has depthWrite=false', () => {
      ind.show(new THREE.Vector3(0, 0, 0), flatPlane());
      const group = scene.children[0] as THREE.Group;
      const quad = group.children.find((c) => c instanceof THREE.Mesh) as
        | THREE.Mesh
        | undefined;
      expect(quad).toBeTruthy();
      const mat = quad!.material as THREE.MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.depthTest).toBe(false);
    });

    it('axes materials all have depthWrite=false', () => {
      ind.show(new THREE.Vector3(0, 0, 0), flatPlane());
      const group = scene.children[0] as THREE.Group;
      const axes = group.children.filter((c) => c instanceof THREE.Line);
      expect(axes.length).toBe(3); // R / G / B axes
      for (const axis of axes) {
        const mat = (axis as THREE.Line).material as THREE.LineBasicMaterial;
        expect(mat.depthWrite, 'axis line must not write depth').toBe(false);
        expect(mat.transparent).toBe(true);
        expect(mat.depthTest).toBe(false);
      }
    });
  });
});
