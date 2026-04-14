import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { PrimitivePreviewManager } from './PrimitivePreviewManager';
import { PrimitiveSession } from './PrimitiveSession';

describe('PrimitivePreviewManager', () => {
  let scene: THREE.Scene;
  let session: PrimitiveSession;
  let manager: PrimitivePreviewManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    vi.spyOn(scene, 'add');
    vi.spyOn(scene, 'remove');

    session = new PrimitiveSession('cylinder');
    manager = new PrimitivePreviewManager(scene, session);
  });

  describe('construction', () => {
    it('creates without error', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('updatePreview - sizing1 (radius circle)', () => {
    it('adds radius circle to scene when radius > 0 and anchor set', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      session.setParam('radius', 50); // sets radius

      manager.updatePreview(session.params, 'sizing1');
      expect(scene.add).toHaveBeenCalled();
      expect(session.preview.radiusCircle).toBeDefined();
    });

    it('does not add circle when radius is 0', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      manager.updatePreview({ radius: 0, height: 0 }, 'sizing1');
      expect(session.preview.radiusCircle).toBeUndefined();
    });

    it('does not add circle when no anchor', () => {
      manager.updatePreview({ radius: 50, height: 0 }, 'sizing1');
      // anchor is null, should not add
    });

    it('replaces old circle on update', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      session.setParam('radius', 50);
      manager.updatePreview(session.params, 'sizing1');

      const firstCircle = session.preview.radiusCircle;
      expect(firstCircle).toBeDefined();

      session.setParam('radius', 80);
      manager.updatePreview(session.params, 'sizing1');

      // Old circle removed, new one added
      expect(scene.remove).toHaveBeenCalled();
    });
  });

  describe('updatePreview - sizing2 (height axis)', () => {
    it('shows both radius circle and height axis in sizing2', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      session.setParam('radius', 50); // radius
      // Advance to sizing2
      session.nextState();
      session.setParam('height', 100); // height

      manager.updatePreview(session.params, 'sizing2');

      expect(session.preview.radiusCircle).toBeDefined();
      expect(session.preview.heightAxis).toBeDefined();
    });

    it('does not show height axis when height is 0', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      manager.updatePreview({ radius: 50, height: 0 }, 'sizing2');
      expect(session.preview.heightAxis).toBeUndefined();
    });
  });

  describe('updatePreview - idle/done clears all', () => {
    it('clears circle and axis on idle state', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      session.setParam('radius', 50);
      manager.updatePreview(session.params, 'sizing1');
      expect(session.preview.radiusCircle).toBeDefined();

      manager.updatePreview(session.params, 'idle');
      expect(session.preview.radiusCircle).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('cleans up all geometries', () => {
      session.setAnchor(new THREE.Vector3(0, 0, 0));
      session.setParam('radius', 50);
      manager.updatePreview(session.params, 'sizing1');

      expect(() => manager.dispose()).not.toThrow();
      expect(session.preview.radiusCircle).toBeUndefined();
    });

    it('does not throw when nothing to dispose', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
