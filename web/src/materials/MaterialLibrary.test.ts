import { describe, it, expect, beforeEach } from 'vitest';
import {
  MaterialLibrary,
  getMaterialLibrary,
  GeometryState,
  Material,
} from './MaterialLibrary';

describe('MaterialLibrary', () => {
  let lib: MaterialLibrary;

  beforeEach(() => {
    lib = new MaterialLibrary();
  });

  describe('getAll returns 12 built-in materials', () => {
    it('should have exactly 12 built-in materials', () => {
      const all = lib.getAll();
      expect(all).toHaveLength(12);
    });

    it('all materials should have builtIn = true', () => {
      const all = lib.getAll();
      all.forEach(mat => {
        expect(mat.builtIn).toBe(true);
      });
    });

    it('should have concrete material', () => {
      const concrete = lib.get('concrete');
      expect(concrete).toBeDefined();
      expect(concrete?.name).toBe('콘크리트');
      expect(concrete?.category).toBe('concrete');
    });

    it('should have steel material', () => {
      const steel = lib.get('steel');
      expect(steel).toBeDefined();
      expect(steel?.name).toBe('철강');
      expect(steel?.category).toBe('metal');
    });

    it('all materials should have valid visual properties', () => {
      const all = lib.getAll();
      all.forEach(mat => {
        expect(mat.visual.color).toBeDefined();
        expect(mat.visual.roughness).toBeGreaterThanOrEqual(0);
        expect(mat.visual.roughness).toBeLessThanOrEqual(1);
        expect(mat.visual.metalness).toBeGreaterThanOrEqual(0);
        expect(mat.visual.metalness).toBeLessThanOrEqual(1);
        expect(mat.visual.opacity).toBeGreaterThanOrEqual(0);
        expect(mat.visual.opacity).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('assignToFaces and unassignFromFaces', () => {
    it('assignToFaces should assign material to faces', () => {
      const result = lib.assignToFaces([1, 2, 3], 'steel');
      expect(result).toBe(true);

      expect(lib.getMaterialForFace(1)?.name).toBe('철강');
      expect(lib.getMaterialForFace(2)?.name).toBe('철강');
      expect(lib.getMaterialForFace(3)?.name).toBe('철강');
    });

    it('assignToFaces should return false for invalid material', () => {
      const result = lib.assignToFaces([1, 2], 'nonexistent');
      expect(result).toBe(false);
    });

    it('unassignFromFaces should remove material assignments', () => {
      lib.assignToFaces([1, 2, 3], 'concrete');
      lib.unassignFromFaces([1, 2]);

      expect(lib.getMaterialForFace(1)).toBeUndefined();
      expect(lib.getMaterialForFace(2)).toBeUndefined();
      expect(lib.getMaterialForFace(3)?.name).toBe('콘크리트');
    });

    it('should support reassigning face to different material', () => {
      lib.assignToFaces([5], 'wood');
      expect(lib.getMaterialForFace(5)?.name).toBe('목재');

      lib.assignToFaces([5], 'glass');
      expect(lib.getMaterialForFace(5)?.name).toBe('유리');
    });
  });

  describe('getCommonMaterial', () => {
    it('should return material if all faces have same material', () => {
      lib.assignToFaces([1, 2, 3], 'brick');
      const common = lib.getCommonMaterial([1, 2, 3]);
      expect(common?.name).toBe('벽돌');
    });

    it('should return undefined if faces have different materials', () => {
      lib.assignToFaces([1], 'brick');
      lib.assignToFaces([2], 'steel');
      const common = lib.getCommonMaterial([1, 2]);
      expect(common).toBeUndefined();
    });

    it('should return undefined for empty array', () => {
      const common = lib.getCommonMaterial([]);
      expect(common).toBeUndefined();
    });

    it('should return undefined if not all faces have material', () => {
      lib.assignToFaces([1, 2], 'aluminum');
      const common = lib.getCommonMaterial([1, 2, 3]);
      expect(common).toBeUndefined();
    });
  });

  describe('hasMaterial', () => {
    it('should return true if any face has material', () => {
      lib.assignToFaces([1, 2], 'stone');
      expect(lib.hasMaterial([1, 2, 3])).toBe(true);
    });

    it('should return false if no faces have material', () => {
      expect(lib.hasMaterial([1, 2, 3])).toBe(false);
    });

    it('should return true for single face with material', () => {
      lib.assignToFaces([5], 'gypsum');
      expect(lib.hasMaterial([5])).toBe(true);
    });
  });

  describe('computePhysics', () => {
    it('should calculate physics correctly for concrete', () => {
      const physics = lib.computePhysics(1000000000, 'concrete'); // 1 m³ = 1e9 mm³
      expect(physics).toBeDefined();
      expect(physics!.volumeM3).toBeCloseTo(1.0, 5);
      expect(physics!.density).toBe(2400); // kg/m³
      expect(physics!.mass).toBeCloseTo(2400, 2); // kg
      expect(physics!.weight).toBeCloseTo(2400 * 9.81, 2); // N
    });

    it('should calculate physics correctly for aluminum', () => {
      const physics = lib.computePhysics(1000000000, 'aluminum'); // 1 m³
      expect(physics).toBeDefined();
      expect(physics!.density).toBe(2700);
      expect(physics!.mass).toBeCloseTo(2700, 2);
    });

    it('should return null for invalid material', () => {
      const physics = lib.computePhysics(1000000000, 'invalid');
      expect(physics).toBeNull();
    });

    it('should convert volume units correctly', () => {
      // 0.001 m³ = 1,000,000 mm³
      const physics = lib.computePhysics(1000000, 'steel');
      expect(physics).toBeDefined();
      expect(physics!.volumeM3).toBeCloseTo(0.001, 9);
    });
  });

  describe('determineState', () => {
    it('should return Point for zero faces and zero edges', () => {
      const state = lib.determineState({ faceCount: 0, edgeCount: 0, isSolid: false, height: 0 }, []);
      expect(state).toBe(GeometryState.Point);
    });

    it('should return Edge for zero faces but with edges', () => {
      const state = lib.determineState({ faceCount: 0, edgeCount: 3, isSolid: false, height: 0 }, []);
      expect(state).toBe(GeometryState.Edge);
    });

    it('should return Edge for single edge', () => {
      const state = lib.determineState({ faceCount: 0, edgeCount: 1, isSolid: false, height: 0 }, []);
      expect(state).toBe(GeometryState.Edge);
    });

    it('should return Face for 2D geometry', () => {
      const state = lib.determineState({ faceCount: 1, edgeCount: 4, isSolid: false, height: 0 }, [1]);
      expect(state).toBe(GeometryState.Face);
    });

    it('should return Face for 2 faces', () => {
      const state = lib.determineState({ faceCount: 2, edgeCount: 5, isSolid: false, height: 0 }, [1, 2]);
      expect(state).toBe(GeometryState.Face);
    });

    it('should return Volume for 3+ faces', () => {
      const state = lib.determineState({ faceCount: 5, edgeCount: 8, isSolid: false, height: 100 }, [1, 2, 3, 4, 5]);
      expect(state).toBe(GeometryState.Volume);
    });

    it('should return Volume regardless of material (material is property, not state)', () => {
      lib.assignToFaces([1, 2, 3, 4, 5, 6], 'steel');
      const state = lib.determineState({ faceCount: 6, edgeCount: 12, isSolid: true, height: 100 }, [1, 2, 3, 4, 5, 6]);
      expect(state).toBe(GeometryState.Volume);
    });
  });

  describe('custom materials', () => {
    it('should add custom material', () => {
      const custom: Omit<Material, 'builtIn'> = { rustId: 1,
        id: 'copper',
        name: '구리',
        nameEn: 'Copper',
        category: 'metal',
        physical: { density: 8900, friction: 0.8, restitution: 0.3, specificGravity: 8.9, thermalConductivity: 385, fireRating: 'incombustible' },
        visual: { color: 0xb87333, roughness: 0.25, metalness: 0.9, opacity: 1.0 },
      };

      const mat = lib.addCustom(custom);
      expect(mat.builtIn).toBe(false);
      expect(lib.get('copper')).toBeDefined();
      expect(lib.get('copper')?.name).toBe('구리');
    });

    it('getCustom should return only custom materials', () => {
      lib.addCustom({ rustId: 2,
        id: 'custom1',
        name: 'Custom 1',
        nameEn: 'Custom 1',
        category: 'custom',
        physical: { density: 1000, friction: 0.5, restitution: 0.3, specificGravity: 1.0, thermalConductivity: 1, fireRating: 'incombustible' },
        visual: { color: 0xff0000, roughness: 0.5, metalness: 0, opacity: 1 },
      });

      const custom = lib.getCustom();
      expect(custom.length).toBe(1);
      custom.forEach(c => expect(c.builtIn).toBe(false));
    });

    it('removeCustom should delete custom material and unassign faces', () => {
      lib.addCustom({ rustId: 3,
        id: 'temp',
        name: 'Temporary',
        nameEn: 'Temporary',
        category: 'custom',
        physical: { density: 500, friction: 0.6, restitution: 0.15, specificGravity: 0.5, thermalConductivity: 0.5, fireRating: 'retardant' },
        visual: { color: 0x123456, roughness: 0.7, metalness: 0, opacity: 1 },
      });

      lib.assignToFaces([1, 2, 3], 'temp');
      expect(lib.getMaterialForFace(1)).toBeDefined();

      const success = lib.removeCustom('temp');
      expect(success).toBe(true);
      expect(lib.get('temp')).toBeUndefined();
      expect(lib.getMaterialForFace(1)).toBeUndefined();
    });

    it('removeCustom should fail for built-in materials', () => {
      const success = lib.removeCustom('concrete');
      expect(success).toBe(false);
      expect(lib.get('concrete')).toBeDefined();
    });
  });

  describe('getByCategory', () => {
    it('should return all metals', () => {
      const metals = lib.getByCategory('metal');
      const metalNames = metals.map(m => m.id);
      expect(metalNames).toContain('steel');
      expect(metalNames).toContain('aluminum');
    });

    it('should return all stone materials', () => {
      const stones = lib.getByCategory('stone');
      const stoneNames = stones.map(m => m.id);
      expect(stoneNames).toContain('brick');
      expect(stoneNames).toContain('stone');
    });
  });

  describe('onChange listener', () => {
    it('should notify listeners on assignment', () => {
      return new Promise<void>((resolve) => {
        let called = false;
        lib.onChange(() => {
          called = true;
        });

        lib.assignToFaces([1], 'steel');
        setTimeout(() => {
          expect(called).toBe(true);
          resolve();
        }, 0);
      });
    });

    it('should allow removing listener', () => {
      let count = 0;
      const unsubscribe = lib.onChange(() => {
        count++;
      });

      lib.assignToFaces([1], 'concrete');
      unsubscribe();
      lib.assignToFaces([2], 'wood');

      expect(count).toBe(1);
    });
  });

  describe('singleton pattern', () => {
    it('getMaterialLibrary should return same instance', () => {
      const lib1 = getMaterialLibrary();
      const lib2 = getMaterialLibrary();
      expect(lib1).toBe(lib2);
    });
  });

  describe('serialization', () => {
    it('toJSON should serialize assignments', () => {
      lib.assignToFaces([1, 2, 3], 'steel');
      const json = lib.toJSON();

      expect(json.assignments).toContainEqual([1, 'steel']);
      expect(json.assignments).toContainEqual([2, 'steel']);
      expect(json.assignments).toContainEqual([3, 'steel']);
    });

    it('fromJSON should restore assignments', () => {
      const json: { custom?: Material[]; assignments?: [number, string][] } = {
        custom: [],
        assignments: [[10, 'concrete'], [11, 'wood']],
      };

      const lib2 = new MaterialLibrary();
      lib2.fromJSON(json);

      expect(lib2.getMaterialForFace(10)?.name).toBe('콘크리트');
      expect(lib2.getMaterialForFace(11)?.name).toBe('목재');
    });

    it('custom material with texture survives JSON roundtrip', () => {
      // Data URL for 1×1 transparent PNG (well-formed, tiny)
      const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      lib.addCustom({
        id: 'custom-tex-1', rustId: 9001,
        name: '텍스처재질', nameEn: 'Textured',
        category: 'custom',
        physical: { density: 1000, friction: 0.5, restitution: 0.2, specificGravity: 1.0, thermalConductivity: 0.5, fireRating: 'incombustible' },
        visual: {
          color: 0xffffff, roughness: 0.5, metalness: 0.0, opacity: 1.0,
          texture: { dataUrl: tinyPng, projection: 'box', scale: 0.002, rotation: Math.PI / 4, label: 'test.png' },
        },
      });
      const json = JSON.parse(JSON.stringify(lib.toJSON())); // full JSON roundtrip
      const lib2 = new MaterialLibrary();
      lib2.fromJSON(json);
      const restored = lib2.get('custom-tex-1');
      expect(restored).toBeDefined();
      expect(restored!.visual.texture).toBeDefined();
      expect(restored!.visual.texture!.dataUrl).toBe(tinyPng);
      expect(restored!.visual.texture!.projection).toBe('box');
      expect(restored!.visual.texture!.scale).toBeCloseTo(0.002, 6);
      expect(restored!.visual.texture!.rotation).toBeCloseTo(Math.PI / 4, 4);
      expect(restored!.visual.texture!.label).toBe('test.png');
    });
  });
});
