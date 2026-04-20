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
});
