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
import * as THREE from 'three';
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

  // ────────────────────────────────────────────────────────────────────
  // ADR-085 P-β — onStage callback (Drift #5 progress visibility)
  // ────────────────────────────────────────────────────────────────────

  describe('ADR-085 P-β — onStage progress callback', () => {
    it('engine_load stage fires during ensureLoaded() (sync with onLoadingStart)', async () => {
      const importer = StepIgesImporter.getInstance();
      const onStageSpy = vi.fn();
      const onLoadingStartSpy = vi.fn();
      importer.onStage = onStageSpy;
      importer.onLoadingStart = onLoadingStartSpy;

      try {
        await importer.ensureLoaded();
      } catch (_e) {
        // expected — opencascade.js not installed in test env
      }

      // engine_load stage 가 onLoadingStart 와 동시에 fire (backward compat)
      expect(onStageSpy).toHaveBeenCalled();
      const engineLoadCalls = onStageSpy.mock.calls.filter(
        (call) => call[0] === 'engine_load',
      );
      expect(engineLoadCalls.length).toBe(1);
      expect(engineLoadCalls[0][1]).toContain('STEP/IGES');
      // Backward compat: existing onLoadingStart 도 여전히 fire
      expect(onLoadingStartSpy).toHaveBeenCalledTimes(1);
    });

    it('onStage callback signature accepts 3 stages', () => {
      // Type-level check — runtime sanity
      const importer = StepIgesImporter.getInstance();
      const validStages: Array<'engine_load' | 'parse' | 'tessellate'> = [
        'engine_load',
        'parse',
        'tessellate',
      ];
      importer.onStage = (stage, msg) => {
        expect(validStages).toContain(stage);
        expect(typeof msg).toBe('string');
      };
      // Manually invoke to verify shape
      importer.onStage('engine_load', '엔진 로딩 중...');
      importer.onStage('parse', '파일 분석 중...');
      importer.onStage('tessellate', 'Mesh 생성 중...');
    });

    it('onStage backward compat: omitting it doesn\'t break ensureLoaded', async () => {
      const importer = StepIgesImporter.getInstance();
      // onStage 미지정 — undefined optional
      importer.onStage = undefined;
      let threw = false;
      try {
        await importer.ensureLoaded();
      } catch (_e) {
        threw = true;
      }
      // 기존 graceful failure path 가 그대로 작동 (NOT_INSTALLED throw)
      expect(threw).toBe(true);
    });
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

    it('ADR-126 β: single face → merged geometry (faces-front + faces-back) + side-table', () => {
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
      // ADR-126 β: 2 Mesh (faces-front + faces-back), NOT per-face Group.
      expect(result.group.children.length).toBe(2);
      const frontMesh = result.group.children.find((c: any) => c.name === 'faces-front');
      const backMesh = result.group.children.find((c: any) => c.name === 'faces-back');
      expect(frontMesh).toBeDefined();
      expect(backMesh).toBeDefined();
      // Side-table on parent group (ADR-126 §B L-126-3).
      const metadata = result.group.userData.faceMetadata as Map<number, any>;
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.size).toBe(1);
      const meta = metadata.get(0);
      expect(meta).toBeDefined();
      expect(meta.faceIndex).toBe(0);
      expect(meta.vertStart).toBe(0);
      expect(meta.vertCount).toBe(3);  // 3 verts for triangle
      expect(meta.indexCount).toBe(3);  // 1 triangle = 3 indices
      // Mock 에서 promoteSurface 가 Unsupported 반환 (DynamicType 없음) →
      // tessellation 자체는 성공하지만 face[N].surface warning 1개. mesh
      // 생성 자체는 영향 없음 (P21.7 graceful).
      const meshErrors = result.tessellationWarnings.filter((w: string) => w.includes('mesh 생성'));
      expect(meshErrors.length).toBe(0);
    });

    it('ADR-126 β: multi-face — 2 faces in merged geometry + side-table (W-δ stable index)', () => {
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
      // Still 2 children (faces-front + faces-back) regardless of N face.
      expect(result.group.children.length).toBe(2);
      // Side-table has 2 entries indexed by W-δ stable index 0/1.
      const metadata = result.group.userData.faceMetadata as Map<number, any>;
      expect(metadata.size).toBe(2);
      expect(metadata.get(0)).toBeDefined();
      expect(metadata.get(1)).toBeDefined();
      // Second face's vertStart should be after first face's verts.
      expect(metadata.get(0).vertStart).toBe(0);
      expect(metadata.get(0).vertCount).toBe(3);
      expect(metadata.get(1).vertStart).toBe(3);
      expect(metadata.get(1).vertCount).toBe(3);
    });

    it('group name reflects format + filename', () => {
      const importer = StepIgesImporter.getInstance();
      const occt = mockOcctWithFaces([]);  // 0 faces
      const result = (importer as any)._convertToThreeGroup(
        occt, {}, 'iges', 'part.iges',
      );
      expect(result.group.name).toBe('IGES: part.iges');
    });

    // ────────────────────────────────────────────────────────────────
    // ADR-084 E-γ — edges sub-group wiring
    // ────────────────────────────────────────────────────────────────

    function mockPolygon3D(nodes: Array<[number, number, number]>) {
      return {
        NbNodes: () => nodes.length,
        Nodes: () => ({
          Lower: () => 1,
          Upper: () => nodes.length,
          Value: (i: number) => mockPnt(...nodes[i - 1]),
        }),
      };
    }

    /**
     * Build mock OCCT with both faces AND edges — extends mockOcctWithFaces
     * with Polygon3D dispatch for edges.
     */
    function mockOcctWithFacesAndEdges(
      faces: Array<{ tri: any | null }>,
      edges: Array<{ poly: any | null }>,
    ) {
      const occt = mockOcctWithFaces(faces);
      const TopAbs_FACE = 4;
      const TopAbs_EDGE = 6;
      const TopAbs_SHAPE = 8;

      // Override TopExp_Explorer_2 to dispatch on kind
      occt.TopExp_Explorer_2 = function (this: any, _shape: any, kind: number) {
        let items: any[] = [];
        if (kind === TopAbs_FACE) items = faces;
        else if (kind === TopAbs_EDGE) items = edges;
        let i = 0;
        Object.assign(this, {
          More: () => i < items.length,
          Current: () => items[i],
          Next: () => { i++; },
        });
      } as any;

      occt.TopAbs_ShapeEnum = { TopAbs_FACE, TopAbs_EDGE, TopAbs_SHAPE };

      // Add Polygon3D dispatch
      occt.BRep_Tool.Polygon3D = (edge: any) => {
        if (edge.poly === null) return { IsNull: () => true, get: () => null };
        return { IsNull: () => false, get: () => edge.poly };
      };

      return occt;
    }

    it('E-γ: face + edges → group has faces-front/back + edges sub-group (ADR-126 β)', () => {
      const importer = StepIgesImporter.getInstance();
      const tri = mockTriangulation(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[1, 2, 3]],
      );
      const occt = mockOcctWithFacesAndEdges(
        [{ tri }],
        [
          { poly: mockPolygon3D([[0, 0, 0], [1, 0, 0]]) },
          { poly: mockPolygon3D([[1, 0, 0], [0, 1, 0]]) },
          { poly: mockPolygon3D([[0, 1, 0], [0, 0, 0]]) },
        ],
      );

      const result = (importer as any)._convertToThreeGroup(
        occt, {}, 'step', 'tri.step',
      );
      // ADR-126 β: group has faces-front + faces-back + edges sub-group = 3 children.
      expect(result.group.children.length).toBe(3);
      const frontMesh = result.group.children.find((c: any) => c.name === 'faces-front');
      const backMesh = result.group.children.find((c: any) => c.name === 'faces-back');
      const edgesGroup = result.group.children.find((c: any) => c.name === 'edges');
      expect(frontMesh).toBeDefined();
      expect(backMesh).toBeDefined();
      expect(edgesGroup).toBeDefined();
      // Edges sub-group UNCHANGED (ADR-126 §B L-126-5) — 3 LineSegments.
      expect(edgesGroup.children.length).toBe(3);
      expect(edgesGroup.children[0].name).toBe('edge-0');
      expect(edgesGroup.children[1].name).toBe('edge-1');
      expect(edgesGroup.children[2].name).toBe('edge-2');
      expect(edgesGroup.children[0].userData.edgeIndex).toBe(0);
    });

    it('E-γ: zero edges → only faces-front/back, no edges sub-group (ADR-126 β)', () => {
      const importer = StepIgesImporter.getInstance();
      const tri = mockTriangulation(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[1, 2, 3]],
      );
      const occt = mockOcctWithFacesAndEdges([{ tri }], []);

      const result = (importer as any)._convertToThreeGroup(
        occt, {}, 'step', 'noedges.step',
      );
      // ADR-126 β: 2 children (faces-front + faces-back), no edges sub-group.
      expect(result.group.children.length).toBe(2);
      expect(result.group.children.find((c: any) => c.name === 'faces-front')).toBeDefined();
      expect(result.group.children.find((c: any) => c.name === 'faces-back')).toBeDefined();
      const edgesGroup = result.group.children.find((c: any) => c.name === 'edges');
      expect(edgesGroup).toBeUndefined();
    });

    it('E-γ: per-edge null Polygon3D → others continue (P21.7) [ADR-126 β edges unchanged]', () => {
      const importer = StepIgesImporter.getInstance();
      const tri = mockTriangulation(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[1, 2, 3]],
      );
      const occt = mockOcctWithFacesAndEdges(
        [{ tri }],
        [
          { poly: mockPolygon3D([[0, 0, 0], [1, 0, 0]]) },
          { poly: null },  // skipped
          { poly: mockPolygon3D([[0, 1, 0], [0, 0, 0]]) },
        ],
      );

      const result = (importer as any)._convertToThreeGroup(
        occt, {}, 'step', 'mixed.step',
      );
      const edgesGroup = result.group.children.find((c: any) => c.name === 'edges');
      expect(edgesGroup).toBeDefined();
      // 2 edges (edge[1] skipped due to null Polygon3D) — ADR-084 E-γ unchanged.
      expect(edgesGroup.children.length).toBe(2);
      expect(edgesGroup.children[0].userData.edgeIndex).toBe(0);
      expect(edgesGroup.children[1].userData.edgeIndex).toBe(2);  // W-δ stable index preserved
      expect(result.tessellationWarnings.some((w: string) => w.startsWith('edge[1]'))).toBe(true);
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

  // ────────────────────────────────────────────────────────────────────
  // ADR-086 O-δ — injectIntoAxia method (axia DCEL injection)
  // ────────────────────────────────────────────────────────────────────

  describe('ADR-086 O-δ — injectIntoAxia (ADR-126 β side-table refactor)', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */

    /**
     * ADR-126 β helper: build a Group with `userData.faceMetadata`
     * side-table populated for N faces. Replaces previous `makeFaceGroup`
     * which built per-face Group children (no longer used post-ADR-126).
     */
    function makeGroupWithMetadata(
      entries: Array<{ faceIndex: number; boundaryPolygon: Float32Array; surface?: any }>,
    ): THREE.Group {
      const g = new THREE.Group();
      const metadata = new Map<number, any>();
      let vertOffset = 0;
      for (const e of entries) {
        const vertCount = e.boundaryPolygon.length / 3;
        metadata.set(e.faceIndex, {
          faceIndex: e.faceIndex,
          boundaryPolygon: e.boundaryPolygon,
          surface: e.surface,
          vertStart: vertOffset,
          vertCount,
          indexStart: 0,
          indexCount: 0,
        });
        vertOffset += vertCount;
      }
      g.userData.faceMetadata = metadata;
      return g;
    }

    it('NoSurface dispatch — face without surface metadata calls injectExternalFaceNoSurface', () => {
      const importer = StepIgesImporter.getInstance();
      const calledWith: { positions: Float64Array | null }[] = [];
      const bridge = {
        injectExternalFaceNoSurface: (pts: Float64Array) => {
          calledWith.push({ positions: pts });
          return 42;  // synthetic FaceId
        },
      };

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const group = makeGroupWithMetadata([
        { faceIndex: 0, boundaryPolygon: positions /* no surface */ },
      ]);

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(1);
      expect(result.faceIndexToAxiaId.get(0)).toBe(42);
      expect(calledWith.length).toBe(1);
      // Float32Array → Float64Array conversion
      expect(calledWith[0].positions?.length).toBe(9);
    });

    it('Plane dispatch — face with Plane surface calls injectExternalFacePlane', () => {
      const importer = StepIgesImporter.getInstance();
      const calledArgs: any = {};
      const bridge = {
        injectExternalFaceNoSurface: () => -1,
        injectExternalFacePlane: (
          pts: Float64Array,
          origin: [number, number, number],
          normal: [number, number, number],
          basisU: [number, number, number],
        ) => {
          calledArgs.pts = pts;
          calledArgs.origin = origin;
          calledArgs.normal = normal;
          calledArgs.basisU = basisU;
          return 99;
        },
      };

      const positions = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
      const surface = {
        kind: 'Plane',
        origin: [5, 5, 0],
        normal: [0, 0, 1],
      };
      const group = makeGroupWithMetadata([
        { faceIndex: 0, boundaryPolygon: positions, surface },
      ]);

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(1);
      expect(result.faceIndexToAxiaId.get(0)).toBe(99);
      expect(calledArgs.origin).toEqual([5, 5, 0]);
      expect(calledArgs.normal).toEqual([0, 0, 1]);
      // basis_u perpendicular to normal +Z → should be [1, 0, 0] (X axis)
      expect(calledArgs.basisU[0]).toBeCloseTo(1);
      expect(calledArgs.basisU[1]).toBeCloseTo(0);
      expect(calledArgs.basisU[2]).toBeCloseTo(0);
    });

    it('axiaFaceId stored in side-table FaceMetadata on success (ADR-126 β)', () => {
      const importer = StepIgesImporter.getInstance();
      const bridge = { injectExternalFaceNoSurface: () => 7 };
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const group = makeGroupWithMetadata([
        { faceIndex: 3, boundaryPolygon: positions },
      ]);

      importer.injectIntoAxia(bridge, group);
      // ADR-126 β: axiaFaceId stored in side-table entry, NOT per-face Group userData.
      const metadata = group.userData.faceMetadata as Map<number, any>;
      expect(metadata.get(3).axiaFaceId).toBe(7);
    });

    it('graceful — missing boundaryPolygon → skip face + warning', () => {
      const importer = StepIgesImporter.getInstance();
      const bridge = { injectExternalFaceNoSurface: () => 0 };
      // Build group with metadata entry but no boundaryPolygon.
      const group = new THREE.Group();
      const metadata = new Map<number, any>();
      metadata.set(0, {
        faceIndex: 0,
        boundaryPolygon: undefined,  // missing
        vertStart: 0, vertCount: 0, indexStart: 0, indexCount: 0,
      });
      group.userData.faceMetadata = metadata;

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(0);
      expect(result.warnings.some((w) => w.includes('boundaryPolygon'))).toBe(true);
    });

    it('graceful — bridge inject returns -1 → skip + warning', () => {
      const importer = StepIgesImporter.getInstance();
      const bridge = { injectExternalFaceNoSurface: () => -1 };
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const group = makeGroupWithMetadata([
        { faceIndex: 0, boundaryPolygon: positions },
      ]);

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(0);
      expect(result.warnings.some((w) => w.includes('returned -1'))).toBe(true);
    });

    it('graceful — bridge inject methods missing → skip + warning', () => {
      const importer = StepIgesImporter.getInstance();
      const bridge = {};  // no inject methods
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const group = makeGroupWithMetadata([
        { faceIndex: 0, boundaryPolygon: positions },
      ]);

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(0);
      expect(result.warnings.some((w) => w.includes('unavailable'))).toBe(true);
    });

    it('multi-face — all faces processed independently with stable index map', () => {
      const importer = StepIgesImporter.getInstance();
      const counter = { id: 100 };
      const bridge = {
        injectExternalFaceNoSurface: () => counter.id++,
      };

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const group = makeGroupWithMetadata([
        { faceIndex: 0, boundaryPolygon: positions },
        { faceIndex: 1, boundaryPolygon: positions },
        { faceIndex: 2, boundaryPolygon: positions },
      ]);

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(3);
      expect(result.faceIndexToAxiaId.get(0)).toBe(100);
      expect(result.faceIndexToAxiaId.get(1)).toBe(101);
      expect(result.faceIndexToAxiaId.get(2)).toBe(102);
    });

    it('ADR-126 β: edges sub-group as child does NOT contribute faces (side-table is SSOT)', () => {
      const importer = StepIgesImporter.getInstance();
      let callCount = 0;
      const bridge = {
        injectExternalFaceNoSurface: () => {
          callCount++;
          return 1;
        },
      };

      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const group = makeGroupWithMetadata([
        { faceIndex: 0, boundaryPolygon: positions },
      ]);
      // Add edges sub-group as a child — should NOT affect inject (side-table is SSOT).
      const edgesGroup = new THREE.Group();
      edgesGroup.name = 'edges';
      group.add(edgesGroup);

      importer.injectIntoAxia(bridge, group);
      expect(callCount).toBe(1);  // Only the 1 face in side-table is processed.
    });

    it('ADR-126 β: missing faceMetadata side-table → graceful warning', () => {
      const importer = StepIgesImporter.getInstance();
      const bridge = { injectExternalFaceNoSurface: () => 1 };
      // Group with no faceMetadata (legacy / non-ADR-126 group).
      const group = new THREE.Group();

      const result = importer.injectIntoAxia(bridge, group);
      expect(result.faceIndexToAxiaId.size).toBe(0);
      expect(
        result.warnings.some((w) => w.includes('faceMetadata')),
      ).toBe(true);
    });

    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});
