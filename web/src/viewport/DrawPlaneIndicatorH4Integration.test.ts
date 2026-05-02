// H4 fix integration test — verifies that DrawPlaneIndicator does NOT
// interfere with line rendering after the depthWrite:false fix.
//
// Scenario: simulates the user's reported bug — draw lines, then
// activate rect tool (which shows DrawPlaneIndicator). Both should
// coexist without depth-buffer corruption.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DrawPlaneIndicator } from './DrawPlaneIndicator';

interface MaterialWithDepth {
  transparent: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  opacity: number;
}

function flatPlane() {
  return {
    normal: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    onFace: false,
  };
}

describe('H4 integration — line rendering survives DrawPlaneIndicator overlay', () => {
  let scene: THREE.Scene;
  let meshGroup: THREE.Group;
  let lineSegs: THREE.LineSegments;
  let indicator: DrawPlaneIndicator;

  beforeEach(() => {
    scene = new THREE.Scene();

    // Simulate Viewport.meshGroup with standalone-edges (5-line polygon)
    meshGroup = new THREE.Group();
    meshGroup.name = 'mesh-group';
    scene.add(meshGroup);

    const linePoints = new Float32Array([
      0, 0, 0, 100, 0, 0, // segment 1
      100, 0, 0, 100, 0, 100, // segment 2
      100, 0, 100, 0, 0, 100, // segment 3
      0, 0, 100, 0, 0, 0, // segment 4 (loop close)
    ]);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePoints, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x333366 });
    lineSegs = new THREE.LineSegments(lineGeo, lineMat);
    lineSegs.name = 'standalone-edges';
    lineSegs.renderOrder = 1;
    meshGroup.add(lineSegs);

    // Activate DrawPlaneIndicator (= rect tool activated)
    indicator = new DrawPlaneIndicator(scene);
  });

  it('lines remain in scene graph after indicator is shown', () => {
    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());

    // Lines must still be present in meshGroup
    const found = meshGroup.children.find((c) => c.name === 'standalone-edges');
    expect(found).toBe(lineSegs);
  });

  it('indicator overlay materials all have depthWrite=false (anti-pattern fix)', () => {
    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());

    // Indicator group is added to scene (NOT meshGroup), so search scene
    const indicatorGroup = scene.children.find(
      (c) => c instanceof THREE.Group && c !== meshGroup,
    ) as THREE.Group | undefined;
    expect(indicatorGroup).toBeTruthy();

    // Every Mesh / Line child must have depthWrite=false
    const overlays = indicatorGroup!.children.filter(
      (c) => c instanceof THREE.Mesh || c instanceof THREE.Line,
    );
    expect(overlays.length).toBeGreaterThanOrEqual(4); // 1 quad + 3 axes

    for (const obj of overlays) {
      const mat = (obj as THREE.Mesh | THREE.Line).material as MaterialWithDepth;
      expect(mat.depthWrite, `${obj.type} must not write depth`).toBe(false);
      expect(mat.transparent, `${obj.type} must be transparent`).toBe(true);
      expect(mat.depthTest, `${obj.type} must skip depth test`).toBe(false);
    }
  });

  it('line material is NOT modified when indicator activates', () => {
    const lineMat = lineSegs.material as MaterialWithDepth;
    const before = {
      depthWrite: lineMat.depthWrite,
      depthTest: lineMat.depthTest,
      transparent: lineMat.transparent,
    };

    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());

    // Lines should be untouched
    expect(lineMat.depthWrite).toBe(before.depthWrite);
    expect(lineMat.depthTest).toBe(before.depthTest);
    expect(lineMat.transparent).toBe(before.transparent);
  });

  it('renderOrder layering: lines (1) BEFORE indicator (2000+)', () => {
    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());

    expect(lineSegs.renderOrder).toBe(1);

    const indicatorGroup = scene.children.find(
      (c) => c instanceof THREE.Group && c !== meshGroup,
    ) as THREE.Group;
    expect(indicatorGroup.renderOrder).toBeGreaterThanOrEqual(2000);

    // Each axis renderOrder should be >= group's
    for (const child of indicatorGroup.children) {
      if (child instanceof THREE.Line) {
        expect(child.renderOrder).toBeGreaterThanOrEqual(2000);
      }
    }
  });

  it('hide() then show() cycle preserves line state', () => {
    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());
    indicator.hide();
    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());

    // Line still present, untouched
    const found = meshGroup.children.find((c) => c.name === 'standalone-edges');
    expect(found).toBe(lineSegs);
  });

  it('dispose() cleans up indicator without affecting lines', () => {
    indicator.show(new THREE.Vector3(50, 0, 50), flatPlane());
    indicator.dispose();

    // Indicator gone
    const indicatorGroup = scene.children.find(
      (c) => c instanceof THREE.Group && c !== meshGroup,
    );
    expect(indicatorGroup).toBeUndefined();

    // Lines preserved
    expect(meshGroup.children.find((c) => c.name === 'standalone-edges')).toBe(lineSegs);
  });
});
