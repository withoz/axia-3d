import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DxfExporter } from './DxfExporter';

// The mock BufferGeometry lacks getAttribute/getIndex that DxfExporter calls.
// Patch them onto the prototype so every instance gets them.
(THREE.BufferGeometry.prototype as any).getAttribute = function (name: string) {
  return this.attributes[name] ?? null;
};
(THREE.BufferGeometry.prototype as any).getIndex = function () {
  return this.index;
};

// The mock's setIndex stores the raw value, but DxfExporter expects { array }.
// Override setIndex to wrap plain arrays into an object with .array.
const origSetIndex = THREE.BufferGeometry.prototype.setIndex;
THREE.BufferGeometry.prototype.setIndex = function (index: any): THREE.BufferGeometry {
  if (Array.isArray(index)) {
    this.index = { array: new Uint16Array(index) } as any;
  } else {
    origSetIndex.call(this, index);
  }
  return this;
};

/** Helper: build a single-triangle indexed Mesh */
function makeTriangleMesh(name = 'test-mesh'): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), 3),
  );
  geo.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

/** Helper: build LineSegments with one segment */
function makeLineSegments(name = 'test-lines'): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 5, 5, 5]), 3),
  );
  const lines = new THREE.LineSegments(geo);
  lines.name = name;
  return lines;
}

describe('DxfExporter', () => {
  let exporter: DxfExporter;

  beforeEach(() => {
    exporter = new DxfExporter();
  });

  it('exportScene with empty scene returns valid DXF with header and footer', () => {
    const scene = new THREE.Scene();
    const dxf = exporter.exportScene(scene);

    expect(typeof dxf).toBe('string');
    expect(dxf.length).toBeGreaterThan(0);
    // Must contain DXF structural markers
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENDSEC');
    expect(dxf).toContain('EOF');
  });

  it('exportScene with a mesh produces 3DFACE entities', () => {
    const scene = new THREE.Scene();
    scene.add(makeTriangleMesh());

    const dxf = exporter.exportScene(scene);

    // DxfWriter writes "FACE" entity type for addFace calls
    expect(dxf).toContain('FACE');
  });

  it('exportScene with LineSegments produces LINE entities', () => {
    const scene = new THREE.Scene();
    scene.add(makeLineSegments());

    const dxf = exporter.exportScene(scene);

    expect(dxf).toContain('LINE');
  });

  it('DXF output contains SECTION/ENDSEC/EOF markers', () => {
    const scene = new THREE.Scene();
    scene.add(makeTriangleMesh());
    scene.add(makeLineSegments());

    const dxf = exporter.exportScene(scene);

    // Standard DXF structure
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENDSEC');
    expect(dxf).toContain('EOF');
  });

  it('mesh layer name comes from mesh.name', () => {
    const scene = new THREE.Scene();
    scene.add(makeTriangleMesh('custom-layer'));

    const dxf = exporter.exportScene(scene);

    expect(dxf).toContain('custom-layer');
  });

  it('handles non-indexed geometry (no index buffer)', () => {
    const geo = new THREE.BufferGeometry();
    // 3 vertices = 1 triangle, no index
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0]), 3),
    );
    const mesh = new THREE.Mesh(geo);
    mesh.name = 'no-index';

    const scene = new THREE.Scene();
    scene.add(mesh);

    const dxf = exporter.exportScene(scene);

    expect(dxf).toContain('FACE');
    expect(dxf).toContain('no-index');
  });

  it('precision option affects coordinate rounding', () => {
    const scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([1.23456, 2.34567, 3.45678, 4, 5, 6, 7, 8, 9]),
        3,
      ),
    );
    geo.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geo);
    mesh.name = 'precision-test';
    scene.add(mesh);

    // precision=0 rounds to integers
    const exporter0 = new DxfExporter();
    const dxf0 = exporter0.exportScene(scene, { precision: 0 });
    // Should not contain the original fractional digits
    expect(dxf0).not.toContain('1.23456');

    // precision=5 keeps more digits
    const exporter5 = new DxfExporter();
    const dxf5 = exporter5.exportScene(scene, { precision: 5 });
    expect(dxf5).toContain('1.23456');
  });

  it('nested meshes inside groups are traversed', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.add(makeTriangleMesh('nested-mesh'));
    scene.add(group);

    const dxf = exporter.exportScene(scene);

    expect(dxf).toContain('FACE');
    expect(dxf).toContain('nested-mesh');
  });
});
