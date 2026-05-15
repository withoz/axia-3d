import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PrimitiveSession } from './PrimitiveSession';

describe('PrimitiveSession', () => {
  describe('constructor', () => {
    it('creates sphere session', () => {
      const session = new PrimitiveSession('sphere');
      expect(session.primitiveType).toBe('sphere');
      expect(session.state).toBe('idle');
    });

    it('creates cylinder session', () => {
      const session = new PrimitiveSession('cylinder');
      expect(session.primitiveType).toBe('cylinder');
    });

    it('creates cone session', () => {
      const session = new PrimitiveSession('cone');
      expect(session.primitiveType).toBe('cone');
    });

    it('initializes with zero params', () => {
      const session = new PrimitiveSession('sphere');
      expect(session.params.radius).toBe(0);
      expect(session.params.height).toBe(0);
    });

    it('defaults axis to world up (ADR-103-δ: +Z)', () => {
      const session = new PrimitiveSession('sphere');
      expect(session.axis.z).toBe(1);
      expect(session.axis.x).toBe(0);
      expect(session.axis.y).toBe(0);
    });
  });

  describe('setAnchor', () => {
    it('sets anchor point', () => {
      const session = new PrimitiveSession('sphere');
      session.setAnchor(new THREE.Vector3(10, 20, 30));
      expect(session.anchor!.x).toBe(10);
      expect(session.anchor!.y).toBe(20);
      expect(session.anchor!.z).toBe(30);
    });

    it('clones the input point', () => {
      const session = new PrimitiveSession('sphere');
      const pt = new THREE.Vector3(10, 0, 0);
      session.setAnchor(pt);
      pt.x = 99;
      expect(session.anchor!.x).toBe(10); // not modified
    });

    it('sets custom axis when provided', () => {
      const session = new PrimitiveSession('cylinder');
      session.setAnchor(new THREE.Vector3(), new THREE.Vector3(0, 0, 2));
      expect(session.axis.z).toBeCloseTo(1); // normalized
    });
  });

  describe('setParam', () => {
    it('updates parameter value', () => {
      const session = new PrimitiveSession('sphere');
      session.setParam('radius', 100);
      expect(session.params.radius).toBe(100);
    });

    it('notifies onParamsChange callback', () => {
      const session = new PrimitiveSession('sphere');
      const cb = vi.fn();
      session.onParamsChange = cb;
      session.setParam('radius', 50);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ radius: 50 }));
    });

    it('does not notify when value unchanged', () => {
      const session = new PrimitiveSession('sphere');
      session.params.radius = 50;
      const cb = vi.fn();
      session.onParamsChange = cb;
      session.setParam('radius', 50);
      expect(cb).not.toHaveBeenCalled();
    });

    it('ignores when inputLock is true', () => {
      const session = new PrimitiveSession('sphere');
      session.inputLock = true;
      session.setParam('radius', 100);
      expect(session.params.radius).toBe(0);
    });
  });

  describe('setParams', () => {
    it('updates multiple params at once', () => {
      const session = new PrimitiveSession('cylinder');
      session.setParams({ radius: 50, height: 200 });
      expect(session.params.radius).toBe(50);
      expect(session.params.height).toBe(200);
    });

    it('ignores when inputLock is true', () => {
      const session = new PrimitiveSession('cylinder');
      session.inputLock = true;
      session.setParams({ radius: 50 });
      expect(session.params.radius).toBe(0);
    });
  });

  describe('nextState / prevState', () => {
    it('advances state: idle → sizing1 → sizing2 → done', () => {
      const session = new PrimitiveSession('cylinder');
      expect(session.state).toBe('idle');

      session.nextState();
      expect(session.state).toBe('sizing1');

      session.nextState();
      expect(session.state).toBe('sizing2');

      session.nextState();
      expect(session.state).toBe('done');
    });

    it('does not advance past done', () => {
      const session = new PrimitiveSession('sphere');
      session.nextState(); // sizing1
      session.nextState(); // sizing2
      session.nextState(); // done
      session.nextState(); // should stay done
      expect(session.state).toBe('done');
    });

    it('prevState goes backwards', () => {
      const session = new PrimitiveSession('sphere');
      session.nextState(); // sizing1
      session.nextState(); // sizing2
      session.prevState(); // back to sizing1
      expect(session.state).toBe('sizing1');
    });

    it('prevState does not go before idle', () => {
      const session = new PrimitiveSession('sphere');
      session.prevState();
      expect(session.state).toBe('idle');
    });

    it('notifies onStateChange callback', () => {
      const session = new PrimitiveSession('sphere');
      const cb = vi.fn();
      session.onStateChange = cb;
      session.nextState();
      expect(cb).toHaveBeenCalledWith('sizing1');
    });
  });

  describe('requiresSizing2', () => {
    it('sphere does not require sizing2', () => {
      const session = new PrimitiveSession('sphere');
      expect(session.requiresSizing2()).toBe(false);
    });

    it('cylinder requires sizing2', () => {
      const session = new PrimitiveSession('cylinder');
      expect(session.requiresSizing2()).toBe(true);
    });

    it('cone requires sizing2', () => {
      const session = new PrimitiveSession('cone');
      expect(session.requiresSizing2()).toBe(true);
    });
  });

  describe('isComplete', () => {
    it('sphere is complete with anchor + radius > 0', () => {
      const session = new PrimitiveSession('sphere');
      session.setAnchor(new THREE.Vector3());
      session.params.radius = 100;
      expect(session.isComplete()).toBe(true);
    });

    it('sphere is incomplete without anchor', () => {
      const session = new PrimitiveSession('sphere');
      session.params.radius = 100;
      expect(session.isComplete()).toBe(false);
    });

    it('sphere is incomplete with zero radius', () => {
      const session = new PrimitiveSession('sphere');
      session.setAnchor(new THREE.Vector3());
      expect(session.isComplete()).toBe(false);
    });

    it('cylinder needs height > 0', () => {
      const session = new PrimitiveSession('cylinder');
      session.setAnchor(new THREE.Vector3());
      session.params.radius = 50;
      expect(session.isComplete()).toBe(false);
      session.params.height = 200;
      expect(session.isComplete()).toBe(true);
    });
  });

  describe('getActiveSizingParam', () => {
    it('returns radius for sizing1', () => {
      const session = new PrimitiveSession('sphere');
      session.nextState(); // sizing1
      expect(session.getActiveSizingParam()).toBe('radius');
    });

    it('returns height for sizing2', () => {
      const session = new PrimitiveSession('cylinder');
      session.nextState(); // sizing1
      session.nextState(); // sizing2
      expect(session.getActiveSizingParam()).toBe('height');
    });

    it('returns null for idle', () => {
      const session = new PrimitiveSession('sphere');
      expect(session.getActiveSizingParam()).toBeNull();
    });

    it('returns null for done', () => {
      const session = new PrimitiveSession('sphere');
      session.nextState(); session.nextState(); session.nextState();
      expect(session.getActiveSizingParam()).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      const session = new PrimitiveSession('cylinder');
      session.setAnchor(new THREE.Vector3(10, 20, 30));
      session.params.radius = 100;
      session.params.height = 200;
      session.nextState();
      session.inputLock = true;

      session.reset();

      expect(session.state).toBe('idle');
      expect(session.anchor).toBeNull();
      expect(session.params.radius).toBe(0);
      expect(session.params.height).toBe(0);
      expect(session.inputLock).toBe(false);
    });
  });

  describe('dispose', () => {
    it('disposes preview geometry and resets', () => {
      const session = new PrimitiveSession('sphere');
      const mockGeo = { dispose: vi.fn() };
      const mockMat = { dispose: vi.fn() };
      session.preview.radiusCircle = { geometry: mockGeo, material: mockMat } as any;

      session.dispose();

      expect(mockGeo.dispose).toHaveBeenCalled();
      expect(mockMat.dispose).toHaveBeenCalled();
      expect(session.state).toBe('idle');
    });
  });
});
