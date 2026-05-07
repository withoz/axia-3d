/**
 * Regression tests for StepIgesImporter (ADR-035 P20.7).
 *
 * 5 tests covering:
 * 1. Singleton pattern (getInstance / resetInstance)
 * 2. Extension dispatch (step/stp/iges/igs accepted, others rejected)
 * 3. Graceful fallback when opencascade.js is not installed
 * 4. Loading callback hooks fire during ensureLoaded()
 * 5. Cached instance reused across multiple importFile calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StepIgesImporter } from './StepIgesImporter';

describe('StepIgesImporter (ADR-035 P20.7)', () => {
  beforeEach(() => {
    StepIgesImporter.resetInstance();
  });

  it('returns singleton across getInstance() calls', () => {
    const a = StepIgesImporter.getInstance();
    const b = StepIgesImporter.getInstance();
    expect(a).toBe(b);
  });

  it('rejects unsupported extensions with clear error', async () => {
    const importer = StepIgesImporter.getInstance();
    const file = new File(['dummy'], 'foo.obj', { type: 'application/octet-stream' });
    await expect(importer.importFile(file)).rejects.toThrow(/STEP\/IGES/);
  });

  it('graceful fallback when opencascade.js is not installed', async () => {
    const importer = StepIgesImporter.getInstance();
    const file = new File(['ISO-10303-21;'], 'cube.step', { type: 'application/step' });
    // opencascade.js is not in test deps → ensureLoaded should throw
    // a clear "not installed" error (P20.C #3).
    await expect(importer.importFile(file)).rejects.toThrow(/opencascade\.js|설치/);
  });

  it('loading callbacks fire during ensureLoaded()', async () => {
    const importer = StepIgesImporter.getInstance();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    importer.onLoadingStart = onStart;
    importer.onLoadingEnd = onEnd;

    try {
      await importer.ensureLoaded();
    } catch (_e) {
      // expected — opencascade.js not installed in test env
    }
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.stringContaining('STEP/IGES'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('isLoaded() reflects load state', async () => {
    const importer = StepIgesImporter.getInstance();
    expect(importer.isLoaded()).toBe(false);
    try {
      await importer.ensureLoaded();
    } catch (_e) {
      // expected in test env
    }
    // Still false since loading failed.
    expect(importer.isLoaded()).toBe(false);
  });

  it('resetInstance() releases the singleton', () => {
    const a = StepIgesImporter.getInstance();
    StepIgesImporter.resetInstance();
    const b = StepIgesImporter.getInstance();
    expect(a).not.toBe(b);
  });

  // ────────────────────────────────────────────────────────────────────
  // ADR-083 T-γ — _convertToThreeGroup tessellation + Mesh wiring
  // ────────────────────────────────────────────────────────────────────

  describe('ADR-083 T-γ — _convertToThreeGroup', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */

    function mockPnt(x: number, y: number, z: number) {
      return { X: () => x, Y: () => y, Z: () => z };
    }

    function mockTriangle(v1: number, v2: number, v3: number) {
      return { Value: (i: number) => (i === 1 ? v1 : i === 2 ? v2 : v3) };
    }

    function mockTriangulation(
      nodes: Array<[number, number, number]>,
      triangles: Array<[number, number, number]>,
    ) {
      return {
        NbNodes: () => nodes.length,
        NbTriangles: () => triangles.length,
        Node: (i: number) => mockPnt(...nodes[i - 1]),
        Triangle: (i: number) => mockTriangle(...triangles[i - 1]),
        HasNormals: () => false,
      };
    }

    function mockOcctWithFaces(faces: Array<{ tri: any | null }>) {
      const TopAbs_FACE = 4;
      const TopAbs_WIRE = 5;
      const TopAbs_SHAPE = 8;
      // Per-instance iterator state — face iter ↔ wire iter (promoteTrimLoops)
      // 가 같은 Explorer ctor 를 사용해도 독립 진행.
      const TopExp_Explorer_2 = function (this: any, _shape: any, kind: number) {
        const items = kind === TopAbs_FACE ? faces : [];
        let i = 0;
        Object.assign(this, {
          More: () => i < items.length,
          Current: () => items[i],
          Next: () => { i++; },
        });
      } as any;
      void TopAbs_WIRE;

      return {
        TopAbs_ShapeEnum: { TopAbs_FACE, TopAbs_SHAPE },
        TopExp_Explorer_2,
        TopLoc_Location_1: function (this: any) { /* identity */ } as any,
        BRepMesh_IncrementalMesh_2: function (this: any) { /* in-place no-op */ } as any,
        BRep_Tool: {
          Triangulation: (face: any) => {
            if (face.tri === null) return { IsNull: () => true, get: () => null };
            return { IsNull: () => false, get: () => face.tri };
          },
          Surface_2: () => ({ IsNull: () => true, get: () => null }),
        },
        BRepTools: {
          UVBounds_1: (
            _f: any,
            u1: { current: number },
            u2: { current: number },
            v1: { current: number },
            v2: { current: number },
          ) => {
            u1.current = 0; u2.current = 1; v1.current = 0; v2.current = 1;
            return true;
          },
        },
      };
    }

    it('shape null → empty group + warning (graceful failure)', () => {
      const importer = StepIgesImporter.getInstance();
      const result = (importer as any)._convertToThreeGroup(
        {} /* occt */,
        null /* shape */,
        'step',
        'foo.step',
      );
      expect(result.group.children.length).toBe(0);
      expect(result.tessellationWarnings.some((w: string) => w.includes('shape null'))).toBe(true);
    });

    it('happy path — single face → THREE.Group with face-0 (front + back mesh)', () => {
      const importer = StepIgesImporter.getInstance();
      const tri = mockTriangulation(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[1, 2, 3]],
      );
      const occt = mockOcctWithFaces([{ tri }]);

      const result = (importer as any)._convertToThreeGroup(
        occt,
        {} /* shape */,
        'step',
        'cube.step',
      );
      expect(result.group.children.length).toBe(1);  // 1 face group
      const faceGroup = result.group.children[0];
      expect(faceGroup.name).toBe('face-0');
      expect(faceGroup.userData.faceIndex).toBe(0);
      // front + back mesh
      expect(faceGroup.children.length).toBe(2);
      expect(faceGroup.children[0].name).toBe('face-0-front');
      expect(faceGroup.children[1].name).toBe('face-0-back');
      // Mock 에서 promoteSurface 가 Unsupported 반환 (DynamicType 없음) →
      // tessellation 자체는 성공하지만 face[N].surface warning 1개. mesh
      // 생성 자체는 영향 없음 (P21.7 graceful).
      const meshErrors = result.tessellationWarnings.filter((w: string) => w.includes('mesh 생성'));
      expect(meshErrors.length).toBe(0);
    });

    it('multi-face — 2 faces → group with face-0 + face-1 (W-δ stable index)', () => {
      const importer = StepIgesImporter.getInstance();
      const tri1 = mockTriangulation([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 2, 3]]);
      const tri2 = mockTriangulation([[0, 0, 1], [1, 0, 1], [0, 1, 1]], [[1, 2, 3]]);
      const occt = mockOcctWithFaces([{ tri: tri1 }, { tri: tri2 }]);

      const result = (importer as any)._convertToThreeGroup(
        occt,
        {} /* shape */,
        'step',
        'multi.step',
      );
      expect(result.group.children.length).toBe(2);
      expect(result.group.children[0].name).toBe('face-0');
      expect(result.group.children[1].name).toBe('face-1');
    });

    it('group name reflects format + filename', () => {
      const importer = StepIgesImporter.getInstance();
      const occt = mockOcctWithFaces([]);  // 0 faces
      const result = (importer as any)._convertToThreeGroup(
        occt, {}, 'iges', 'part.iges',
      );
      expect(result.group.name).toBe('IGES: part.iges');
    });

    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  it('iges extension dispatches to importer (not to default branch)', async () => {
    const importer = StepIgesImporter.getInstance();
    const file = new File(['dummy iges'], 'part.iges', { type: 'application/iges' });
    // Should attempt to load OCCT (and fail, since not installed) — not
    // throw "unsupported extension".
    await expect(importer.importFile(file)).rejects.toThrow(/opencascade\.js|설치/);
  });

  it('detected format matches extension (step vs iges)', async () => {
    // Indirect verification — graceful failure path still classifies
    // ext correctly before the OCCT call.
    const importer = StepIgesImporter.getInstance();
    const stepFile = new File(['x'], 'a.step', { type: 'text/plain' });
    const igesFile = new File(['x'], 'b.igs', { type: 'text/plain' });
    // Both should reach the OCCT load step (and fail there), confirming
    // ext gate accepted them.
    await expect(importer.importFile(stepFile)).rejects.toThrow(/opencascade\.js|설치/);
    await expect(importer.importFile(igesFile)).rejects.toThrow(/opencascade\.js|설치/);
  });
});
