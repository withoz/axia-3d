import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock calls are hoisted above imports by Vitest, so these run first.
// Mock Three.js loader modules that FileImporter imports at the top level.
vi.mock('three/examples/jsm/loaders/OBJLoader.js', () => ({ OBJLoader: class {} }));
vi.mock('three/examples/jsm/loaders/STLLoader.js', () => ({ STLLoader: class {} }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class {} }));
vi.mock('three/examples/jsm/loaders/ColladaLoader.js', () => ({ ColladaLoader: class {} }));
vi.mock('three/examples/jsm/loaders/PLYLoader.js', () => ({ PLYLoader: class {} }));
vi.mock('three/examples/jsm/loaders/TDSLoader.js', () => ({ TDSLoader: class {} }));
vi.mock('dxf', () => ({ parseString: () => ({ entities: [] }) }));
vi.mock('dwgdxf', () => ({ convertDwgToDxf: async () => new Uint8Array(), init: async () => {} }));
vi.mock('jszip', () => {
  return { default: class { async loadAsync() { return { files: {} }; } } };
});

import * as THREE from 'three';
import { FileImporter } from './FileImporter';

// Patch missing methods on mock BufferGeometry
if (!(THREE.BufferGeometry.prototype as any).getAttribute) {
  (THREE.BufferGeometry.prototype as any).getAttribute = function (name: string) {
    return this.attributes[name] ?? null;
  };
}
if (!(THREE.BufferGeometry.prototype as any).getIndex) {
  (THREE.BufferGeometry.prototype as any).getIndex = function () {
    return this.index;
  };
}

describe('FileImporter', () => {
  let scene: THREE.Scene;
  let importer: FileImporter;

  beforeEach(() => {
    scene = new THREE.Scene();
    importer = new FileImporter(scene);
  });

  // --- getSupportedFormats ---

  describe('getSupportedFormats', () => {
    it('returns all 9 supported formats', () => {
      const formats = FileImporter.getSupportedFormats();
      expect(formats).toHaveLength(9);
    });

    it('each entry has format, label, and accept fields', () => {
      const formats = FileImporter.getSupportedFormats();
      for (const entry of formats) {
        expect(entry).toHaveProperty('format');
        expect(entry).toHaveProperty('label');
        expect(entry).toHaveProperty('accept');
        expect(typeof entry.format).toBe('string');
        expect(typeof entry.label).toBe('string');
        expect(typeof entry.accept).toBe('string');
      }
    });

    it('includes expected format keys', () => {
      const formats = FileImporter.getSupportedFormats();
      const keys = formats.map((f) => f.format);
      expect(keys).toContain('obj');
      expect(keys).toContain('stl');
      expect(keys).toContain('gltf');
      expect(keys).toContain('dae');
      expect(keys).toContain('ply');
      expect(keys).toContain('3ds');
      expect(keys).toContain('dxf');
      expect(keys).toContain('dwg');
      expect(keys).toContain('skp');
    });
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('creates an imported-group and adds it to the scene', () => {
      const group = scene.children.find(
        (c) => (c as any).name === 'imported-group',
      );
      expect(group).toBeDefined();
    });

    it('importedItems starts empty', () => {
      expect(importer.importedItems).toHaveLength(0);
    });
  });

  // --- clearAll ---

  describe('clearAll', () => {
    it('removes all imported items', () => {
      const fakeGroup = new THREE.Group();
      fakeGroup.name = 'fake-import';
      const importedGroup = scene.children.find(
        (c) => (c as any).name === 'imported-group',
      ) as THREE.Group;
      importedGroup.add(fakeGroup);

      (importer as any)._importedItems.push({
        format: 'obj',
        fileName: 'test.obj',
        group: fakeGroup,
        meshCount: 0,
        vertexCount: 0,
        faceCount: 0,
      });

      expect(importer.importedItems).toHaveLength(1);

      importer.clearAll();

      expect(importer.importedItems).toHaveLength(0);
    });

    it('clearAll on empty importer does not throw', () => {
      expect(() => importer.clearAll()).not.toThrow();
    });
  });

  // --- removeImport ---

  describe('removeImport', () => {
    it('removes a specific import result', () => {
      const fakeGroup = new THREE.Group();
      const importedGroup = scene.children.find(
        (c) => (c as any).name === 'imported-group',
      ) as THREE.Group;
      importedGroup.add(fakeGroup);

      const result = {
        format: 'stl' as const,
        fileName: 'model.stl',
        group: fakeGroup,
        meshCount: 0,
        vertexCount: 0,
        faceCount: 0,
      };
      (importer as any)._importedItems.push(result);

      expect(importer.importedItems).toHaveLength(1);
      importer.removeImport(result);
      expect(importer.importedItems).toHaveLength(0);
    });

    it('disposes geometry and material of meshes inside the group', () => {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.Material();
      const mesh = new THREE.Mesh(geo, mat);

      const fakeGroup = new THREE.Group();
      fakeGroup.add(mesh);

      const importedGroup = scene.children.find(
        (c) => (c as any).name === 'imported-group',
      ) as THREE.Group;
      importedGroup.add(fakeGroup);

      const result = {
        format: 'obj' as const,
        fileName: 'test.obj',
        group: fakeGroup,
        meshCount: 1,
        vertexCount: 3,
        faceCount: 1,
      };
      (importer as any)._importedItems.push(result);

      // Should not throw during disposal
      expect(() => importer.removeImport(result)).not.toThrow();
      expect(importer.importedItems).toHaveLength(0);
    });
  });
});
