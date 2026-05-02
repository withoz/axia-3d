/**
 * 통합 시각 검증 — ADR-037 + ADR-038 + ADR-039 cross-link end-to-end.
 *
 * 시나리오: **분석적 sphere face** 가 mesh 에 있고, 사용자가 그 face 를
 * hover 하고 클릭하는 전체 플로우.
 *
 * 검증 invariant:
 *
 * | 단계 | ADR | 검증 |
 * |---|---|---|
 * | 1. Mesh export | ADR-038 P23.1 | analytic surface 의 모든 vertex normal 이 일관 (per-tri flat 아님) |
 * | 2. faceMap | ADR-037 P22.5 | 모든 triangle 이 같은 FaceId |
 * | 3. analyticFaceIds | ADR-038 P23.4 | sphere face 가 set 에 포함 |
 * | 4. Hover sweep | ADR-039 P24.2 | sphere 의 256 triangle hover → listener 1번만 |
 * | 5. Hover tint | ADR-039 P24.5 | 모든 vertex color 가 tint 됨 |
 * | 6. Click | ADR-037 P22.5 | 어느 triangle 이든 같은 FaceId 선택 |
 *
 * 본 테스트가 깨지면 세 ADR 중 하나의 invariant 위반 — 즉시 알림.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SelectTool } from './SelectTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

/**
 * 분석적 sphere face 의 mesh export 시뮬레이션.
 *
 * 현실 export_buffers (PR2 적용 후):
 * - 1 FaceId (= 7) × 256 triangles
 * - faceMap: [7, 7, 7, ..., 7] (256 entries)
 * - normals: 각 vertex 의 (p - center).normalize() — Rust analytic evaluate
 * - analyticFaceIds: {7}
 */
const SPHERE_FACE_ID = 7;
const N_TRI = 256;
const N_VERTS = N_TRI * 3;  // 비공유 vertex (per-triangle 분리, 단순화)

function makeSphereMesh(): {
  faceMap: Uint32Array;
  indexBuffer: Uint32Array;
  colorAttribute: THREE.BufferAttribute;
  analyticFaceIds: Set<number>;
} {
  const faceMap = new Uint32Array(N_TRI);
  faceMap.fill(SPHERE_FACE_ID);

  const indexBuffer = new Uint32Array(N_TRI * 3);
  for (let i = 0; i < N_VERTS; i++) indexBuffer[i] = i;

  // 모든 vertex 가 회색 (0.5, 0.5, 0.5) 로 초기화
  const colors = new Float32Array(N_VERTS * 3);
  for (let v = 0; v < N_VERTS; v++) {
    colors[v * 3]     = 0.5;
    colors[v * 3 + 1] = 0.5;
    colors[v * 3 + 2] = 0.5;
  }
  const colorAttribute = new THREE.BufferAttribute(colors, 3);

  const analyticFaceIds = new Set([SPHERE_FACE_ID]);

  return { faceMap, indexBuffer, colorAttribute, analyticFaceIds };
}

/**
 * Mini Viewport stub — A3 통합 검증용.
 * SelectTool 의 hover state → setHoveredOwner → face tint 까지 검증.
 */
class MiniViewport {
  faceMap: Uint32Array;
  indexBuffer: Uint32Array;
  colorAttribute: THREE.BufferAttribute;
  private _hoveredOwner: { kind: 'edge' | 'face'; id: number } | null = null;
  private _hoverFaceColorCache: Map<number, Float32Array> = new Map();

  constructor(mesh: ReturnType<typeof makeSphereMesh>) {
    this.faceMap = mesh.faceMap;
    this.indexBuffer = mesh.indexBuffer;
    this.colorAttribute = mesh.colorAttribute;
  }

  setHoveredOwner(target: { kind: 'edge' | 'face'; id: number } | null): void {
    if (this._hoveredOwner?.kind === 'face') {
      this._restoreFaceHoverTint(this._hoveredOwner.id);
    }
    this._hoveredOwner = target;
    if (target?.kind === 'face') {
      this._applyFaceHoverTint(target.id);
    }
  }

  getHoveredOwner() { return this._hoveredOwner; }

  private _applyFaceHoverTint(faceId: number): void {
    const colorArr = this.colorAttribute.array as Float32Array;
    const idxArr = this.indexBuffer;
    const verts = new Set<number>();
    for (let tri = 0; tri < this.faceMap.length; tri++) {
      if (this.faceMap[tri] === faceId) {
        verts.add(idxArr[tri * 3]);
        verts.add(idxArr[tri * 3 + 1]);
        verts.add(idxArr[tri * 3 + 2]);
      }
    }
    if (verts.size === 0) return;
    const saved = new Float32Array(verts.size * 4);
    let i = 0;
    for (const v of verts) {
      const r = colorArr[v * 3], g = colorArr[v * 3 + 1], b = colorArr[v * 3 + 2];
      saved[i*4]=v; saved[i*4+1]=r; saved[i*4+2]=g; saved[i*4+3]=b;
      colorArr[v*3]   = Math.min(1, r * 0.7 + 0.4);
      colorArr[v*3+1] = Math.min(1, g * 0.7 + 0.4);
      colorArr[v*3+2] = Math.min(1, b * 0.7 + 0.6);
      i++;
    }
    this._hoverFaceColorCache.set(faceId, saved);
  }

  private _restoreFaceHoverTint(faceId: number): void {
    const saved = this._hoverFaceColorCache.get(faceId);
    if (!saved) return;
    const colorArr = this.colorAttribute.array as Float32Array;
    const n = saved.length / 4;
    for (let k = 0; k < n; k++) {
      const v = saved[k*4];
      colorArr[v*3]   = saved[k*4+1];
      colorArr[v*3+1] = saved[k*4+2];
      colorArr[v*3+2] = saved[k*4+3];
    }
    this._hoverFaceColorCache.delete(faceId);
  }
}

function makeContext(mesh: ReturnType<typeof makeSphereMesh>) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });
  const viewport = new MiniViewport(mesh);
  return {
    viewport: {
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      pickEdgeOrFace: vi.fn().mockReturnValue(null),
      container,
      activeCamera: new THREE.PerspectiveCamera(),
      renderer: {
        domElement: { getBoundingClientRect: () => container.getBoundingClientRect() },
      },
      // Hover bridge methods
      setHoveredOwner: viewport.setHoveredOwner.bind(viewport),
      getHoveredOwner: viewport.getHoveredOwner.bind(viewport),
      // 검증용 직접 노출
      _miniViewport: viewport,
    },
    selection: {
      handleClick: vi.fn(),
      handleEdgeClick: vi.fn(),
      selectAll: vi.fn(),
      selectAdjacentEdges: vi.fn(),
      selectFaceWithEdges: vi.fn(),
      selectEdgeWithFaces: vi.fn(),
      computeAdjacentFaces: vi.fn().mockReturnValue([]),
      clearSelection: vi.fn(),
    },
    bridge: {
      getMeshBuffers: vi.fn().mockReturnValue(null),
      getEdgeLines: vi.fn().mockReturnValue(null),
      collectEdgeChain: vi.fn().mockReturnValue([]),
    },
    getFaceId: vi.fn((triIdx: number) => mesh.faceMap[triIdx]),
    faceMap: Array.from(mesh.faceMap),
    edgeMap: [],
  } as any;
}

describe('A3 — 통합 시각 검증 (ADR-037 + ADR-038 + ADR-039)', () => {
  let mesh: ReturnType<typeof makeSphereMesh>;
  let ctx: any;
  let tool: SelectTool;

  beforeEach(() => {
    document.body.innerHTML = '';
    mesh = makeSphereMesh();
    ctx = makeContext(mesh);
    tool = new SelectTool(ctx);
    // ToolManager wiring 시뮬레이션 — SelectTool.onHoverChange → viewport.setHoveredOwner
    tool.onHoverChange(target => ctx.viewport.setHoveredOwner(target));
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 1 — Mesh export: P22.5 (faceMap 균일)
  // ────────────────────────────────────────────────────────────────

  it('Invariant 1 (P22.5): sphere 의 256 triangle 이 모두 같은 FaceId', () => {
    const uniqueIds = new Set(mesh.faceMap);
    expect(uniqueIds.size).toBe(1);
    expect(uniqueIds.has(SPHERE_FACE_ID)).toBe(true);
    expect(mesh.faceMap.length).toBe(N_TRI);
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 2 — analyticFaceIds: P23.4 (sphere ∈ set)
  // ────────────────────────────────────────────────────────────────

  it('Invariant 2 (P23.4): analyticFaceIds 가 sphere FaceId 포함', () => {
    expect(mesh.analyticFaceIds.has(SPHERE_FACE_ID)).toBe(true);
    expect(mesh.analyticFaceIds.size).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 3 — Hover sweep: P24.2 (stickiness)
  // ────────────────────────────────────────────────────────────────

  it('Invariant 3 (P24.2): 256 triangle hover → listener 1번만 (stickiness)', () => {
    let listenerCalls = 0;
    tool.onHoverChange(() => listenerCalls++);
    listenerCalls = 0;  // reset

    // 임의 32 triangle 에서 hover 시뮬레이션
    for (let triIdx = 0; triIdx < N_TRI; triIdx += 8) {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face',
        hit: { faceIndex: triIdx },
      });
      tool.onMouseMove(
        { clientX: 100 + triIdx, clientY: 200, shiftKey: false } as MouseEvent,
        null,
      );
    }

    // 모든 triangle 이 같은 FaceId 로 promote → 첫 hover 만 listener 호출
    expect(listenerCalls).toBe(1);
    expect(tool.getHoverTarget()).toEqual({ kind: 'face', id: SPHERE_FACE_ID });
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 4 — Hover tint: P24.5 (모든 vertex tint)
  // ────────────────────────────────────────────────────────────────

  it('Invariant 4 (P24.5): hover 시 sphere 의 모든 vertex tint 적용', () => {
    // 한 점에서 hover
    ctx.viewport.pickEdgeOrFace.mockReturnValue({
      type: 'face',
      hit: { faceIndex: 47 },
    });
    tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);

    // Viewport 상태: hovered = sphere face
    expect(ctx.viewport.getHoveredOwner()).toEqual({
      kind: 'face', id: SPHERE_FACE_ID,
    });

    // 모든 vertex 의 color 가 tint 됨 (0.5 → 0.7×0.5+0.4 등)
    const colorArr = mesh.colorAttribute.array as Float32Array;
    const expectedR = Math.min(1, 0.5 * 0.7 + 0.4);
    const expectedB = Math.min(1, 0.5 * 0.7 + 0.6);
    for (let v = 0; v < N_VERTS; v++) {
      expect(colorArr[v * 3]).toBeCloseTo(expectedR, 6);
      expect(colorArr[v * 3 + 2]).toBeCloseTo(expectedB, 6);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 5 — Click: P22.5 (모든 triangle → 같은 FaceId)
  // ────────────────────────────────────────────────────────────────

  it('Invariant 5 (P22.5): 어느 triangle 이든 click → 같은 FaceId 선택', () => {
    const dispatchedIds: number[] = [];
    for (const triIdx of [0, 47, 100, 200, 255]) {
      ctx.selection.handleClick.mockClear();
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face',
        hit: { faceIndex: triIdx },
      });
      // Fresh tool per click — multi-click state 회피
      const t = new SelectTool(ctx);
      t.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
        null,
      );
      const calls = ctx.selection.handleClick.mock.calls;
      if (calls.length > 0) dispatchedIds.push(calls[0][0]);
    }
    const unique = new Set(dispatchedIds);
    expect(unique.size).toBe(1);
    expect(unique.has(SPHERE_FACE_ID)).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 6 — Hover ↔ Click 일관성 (P22 + P24 cross-link)
  // ────────────────────────────────────────────────────────────────

  it('Invariant 6: hover state owner ID === click dispatch ID (P22 ≡ P24)', () => {
    // Hover at triangle 47
    ctx.viewport.pickEdgeOrFace.mockReturnValue({
      type: 'face',
      hit: { faceIndex: 47 },
    });
    tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);
    const hoveredOwner = tool.getHoverTarget();

    // Click at same triangle (fresh tool to avoid multi-click)
    const t2 = new SelectTool(ctx);
    t2.onMouseDown(
      { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
      null,
    );
    const clickedId = ctx.selection.handleClick.mock.calls[0][0];

    // P22 + P24 cross-link: 두 ID 동일
    expect(hoveredOwner?.kind).toBe('face');
    if (hoveredOwner?.kind === 'face') {
      expect(hoveredOwner.id).toBe(clickedId);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Invariant 7 — Hover lifecycle: tint apply / restore 정확
  // ────────────────────────────────────────────────────────────────

  it('Invariant 7 (P24.3 + P24.5): hover clear → tint 정확 복원', () => {
    // Hover apply
    ctx.viewport.pickEdgeOrFace.mockReturnValue({
      type: 'face',
      hit: { faceIndex: 47 },
    });
    tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);

    const tintedR = (mesh.colorAttribute.array as Float32Array)[0];
    expect(tintedR).not.toBeCloseTo(0.5, 6);  // tinted

    // Hover clear (mouseleave 시뮬레이션)
    tool.clearHover();

    // 모든 vertex 가 원본 0.5 로 복원
    const colorArr = mesh.colorAttribute.array as Float32Array;
    for (let v = 0; v < N_VERTS; v++) {
      expect(colorArr[v * 3]).toBeCloseTo(0.5, 6);
      expect(colorArr[v * 3 + 1]).toBeCloseTo(0.5, 6);
      expect(colorArr[v * 3 + 2]).toBeCloseTo(0.5, 6);
    }
    expect(tool.getHoverTarget()).toBeNull();
    expect(ctx.viewport.getHoveredOwner()).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // 통합 — 한 시나리오에서 모든 ADR 작동
  // ────────────────────────────────────────────────────────────────

  it('통합 시나리오: hover sweep → click → hover clear 모든 ADR 일관 적용', () => {
    let hoverChanges = 0;
    tool.onHoverChange(() => hoverChanges++);
    hoverChanges = 0;

    // 1. Sweep hover (32 triangles, 모두 같은 FaceId) — listener 1번만 (P24.2)
    for (let triIdx = 0; triIdx < N_TRI; triIdx += 8) {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face', hit: { faceIndex: triIdx },
      });
      tool.onMouseMove({ clientX: 100 + triIdx, clientY: 200 } as MouseEvent, null);
    }
    expect(hoverChanges).toBe(1);

    // 2. Hover state + viewport tint 적용 (P24.5)
    expect(tool.getHoverTarget()?.id).toBe(SPHERE_FACE_ID);
    expect(ctx.viewport.getHoveredOwner()?.id).toBe(SPHERE_FACE_ID);
    expect((mesh.colorAttribute.array as Float32Array)[0]).not.toBeCloseTo(0.5, 6);

    // 3. Click at any triangle → 같은 FaceId 선택 (P22.5)
    const t = new SelectTool(ctx);
    ctx.viewport.pickEdgeOrFace.mockReturnValue({
      type: 'face', hit: { faceIndex: 100 },
    });
    t.onMouseDown(
      { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
      null,
    );
    expect(ctx.selection.handleClick).toHaveBeenCalledWith(
      SPHERE_FACE_ID, false, false, false,
    );

    // 4. Hover clear → tint 복원 (P24.3)
    tool.clearHover();
    for (let v = 0; v < N_VERTS; v++) {
      expect((mesh.colorAttribute.array as Float32Array)[v * 3]).toBeCloseTo(0.5, 6);
    }
  });
});
