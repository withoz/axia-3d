import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { OffsetTool } from './OffsetTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function mockToolContext() {
  return {
    bridge: {
      offsetFace: vi.fn().mockReturnValue({ ok: true, innerFace: 10 }),
      offsetEdge: vi.fn().mockReturnValue({ ok: true, newEdge: 20 }),
      offsetEdgeOnHost: vi.fn().mockReturnValue({
        ok: true, newEdge: 30, newV0: 100, newV1: 101,
      }),
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      getFaceNormal: vi.fn().mockReturnValue(new Float32Array([0, 1, 0])),
      getEdgeLines: vi.fn().mockReturnValue(null),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      renderer: {
        domElement: {
          style: { cursor: '' },
          getBoundingClientRect: () => ({
            left: 0, top: 0, width: 800, height: 600,
          }),
        },
      },
    },
    selection: {
      handleClick: vi.fn(),
      clearSelection: vi.fn(),
      getSelectedEdges: vi.fn().mockReturnValue([]),
    },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('10.0 mm') },
    getFaceId: vi.fn().mockReturnValue(-1),
    getSelectedFaces: vi.fn().mockReturnValue([]),
    getGroundPoint: vi.fn().mockReturnValue(null),
    extractFaceBoundary: vi.fn().mockReturnValue([]),
    pickBox: null,
    edgeMap: null,
  } as any;
}

describe('OffsetTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: OffsetTool;

  beforeEach(async () => {
    // Reset module-level Toast mock so calls don't bleed across tests.
    const { Toast } = await import('../ui/Toast');
    (Toast.info as ReturnType<typeof vi.fn>).mockClear();
    (Toast.warning as ReturnType<typeof vi.fn>).mockClear();
    (Toast.error as ReturnType<typeof vi.fn>).mockClear();
    (Toast.success as ReturnType<typeof vi.fn>).mockClear();
    ctx = mockToolContext();
    tool = new OffsetTool(ctx);
  });

  describe('name', () => {
    it('is "offset"', () => {
      expect(tool.name).toBe('offset');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onActivate', () => {
    it('sets cursor to none', () => {
      tool.onActivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).toBe('none');
    });
  });

  describe('onDeactivate', () => {
    it('restores cursor and resets state', () => {
      tool.onActivate();
      tool.onDeactivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).toBe('');
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseDown - phase 0 (object selection)', () => {
    it('does nothing when no face or edge hit', () => {
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
    });

    it('selects face and enters phase 1', () => {
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 2,
        point: new THREE.Vector3(10, 0, 10),
      });
      ctx.getFaceId.mockReturnValue(5);

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false);
    });

    it('falls back to selected face', () => {
      ctx.viewport.pick.mockReturnValue(null);
      ctx.getSelectedFaces.mockReturnValue([3]);
      ctx.bridge.facesCentroid.mockReturnValue(new THREE.Vector3(0, 0, 0));

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('onKeyDown', () => {
    it('Escape cancels', () => {
      // Enter phase 1
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(1);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when idle', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('applyVCBValue', () => {
    it('stores distance when in phase 0', () => {
      tool.applyVCBValue(25);
      // Should not throw, stores for later use
      expect(tool.isBusy()).toBe(false);
    });

    it('applies face offset when in phase 1 with face selected', () => {
      // Select face
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(3);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);

      // Apply VCB
      tool.applyVCBValue(50);
      expect(ctx.bridge.offsetFace).toHaveBeenCalledWith(3, 50);
      expect(ctx.syncMesh).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('resets all state', () => {
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(1);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);

      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('does nothing in phase 0 without pickBox', () => {
      tool.onMouseMove({ clientX: 200, clientY: 200 } as MouseEvent, null);
      // Should not throw
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // ADR-080 V-α — Dimension dispatch on activation
  // ════════════════════════════════════════════════════════════════════
  describe('ADR-080 V-α dimension dispatch', () => {
    it('mixed selection (edges + faces) → reject + clearSelection + Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([5]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);

      tool.onActivate();

      expect(Toast.warning).toHaveBeenCalledTimes(1);
      const args = (Toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(args[0]).toMatch(/(선과 면|혼합|mixed)/i);
      expect(ctx.selection.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('edge-only selection → enters edge dim mode (no Toast fires on activate after V-β-α-bridge)', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10, 11]);

      tool.onActivate();

      // V-α showed an upfront placeholder Toast. V-β-α-bridge actually
      // performs the offset on VCB-apply, so no upfront Toast.
      expect(Toast.info).not.toHaveBeenCalled();
      expect(ctx.bridge.offsetFace).not.toHaveBeenCalled();
      expect(ctx.bridge.offsetEdge).not.toHaveBeenCalled();
      // No Rust call yet — that happens at applyVCBValue.
      expect(ctx.bridge.offsetEdgeOnHost).not.toHaveBeenCalled();
    });

    it('face-only selection → existing path (no Toast, no clearSelection)', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([5]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);

      tool.onActivate();

      expect(Toast.warning).not.toHaveBeenCalled();
      expect(Toast.info).not.toHaveBeenCalled();
      expect(ctx.selection.clearSelection).not.toHaveBeenCalled();
    });

    it('empty selection → no toast, awaits face pick (legacy path)', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);

      tool.onActivate();

      expect(Toast.warning).not.toHaveBeenCalled();
      expect(Toast.info).not.toHaveBeenCalled();
      // Phase 0 stays — onMouseDown still picks face when invoked.
      expect(tool.isBusy()).toBe(false);
    });

    it('edge mode applyVCBValue → calls offsetEdgeOnHost (V-β-α-bridge)', async () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      tool.onActivate();
      vi.clearAllMocks();
      ctx.bridge.offsetEdgeOnHost.mockReturnValue({
        ok: true, newEdge: 30, newV0: 100, newV1: 101,
      });

      tool.applyVCBValue(50);

      expect(ctx.bridge.offsetEdgeOnHost).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.offsetEdgeOnHost).toHaveBeenCalledWith(10, 50);
      expect(ctx.bridge.offsetFace).not.toHaveBeenCalled();
      expect(ctx.bridge.offsetEdge).not.toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false);
    });

    it('edge mode onMouseDown → blocked + Toast hint, no face pick', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      tool.onActivate();
      vi.clearAllMocks();
      // Even if pick would succeed, edge mode blocks face dispatch.
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(7);

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);

      // V-β-α-bridge: edge mode click hints at VCB usage (no Rust call).
      expect(Toast.info).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.offsetFace).not.toHaveBeenCalled();
      expect(ctx.bridge.offsetEdgeOnHost).not.toHaveBeenCalled();
      expect(ctx.selection.handleClick).not.toHaveBeenCalled();
    });

    // ────────────────────────────────────────────────────────────────
    // ADR-080 V-β-α-bridge — applyEdgeOffset reason dispatch
    // ────────────────────────────────────────────────────────────────

    it('edge mode applyVCB with unsupported_surface → forward-defer Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      ctx.bridge.offsetEdgeOnHost.mockReturnValue({
        ok: false, reason: 'unsupported_surface', kind: 'Cylinder',
      });
      tool.onActivate();
      vi.clearAllMocks();

      tool.applyVCBValue(50);

      expect(ctx.bridge.offsetEdgeOnHost).toHaveBeenCalledWith(10, 50);
      expect(Toast.warning).toHaveBeenCalledTimes(1);
      const msg = (Toast.warning as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg).toMatch(/Cylinder|V-β-γ/);
      expect(ctx.syncMesh).not.toHaveBeenCalled();
    });

    it('edge mode applyVCB with no_incident_face → V-δ Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      ctx.bridge.offsetEdgeOnHost.mockReturnValue({
        ok: false, reason: 'no_incident_face',
      });
      tool.onActivate();
      vi.clearAllMocks();

      tool.applyVCBValue(50);

      expect(Toast.warning).toHaveBeenCalledTimes(1);
      const msg = (Toast.warning as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg).toMatch(/자유 와이어|V-δ|V-delta/);
    });

    it('edge mode applyVCB with multi_loop → ADR-016 Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      ctx.bridge.offsetEdgeOnHost.mockReturnValue({
        ok: false, reason: 'multi_loop',
      });
      tool.onActivate();
      vi.clearAllMocks();

      tool.applyVCBValue(50);

      expect(Toast.warning).toHaveBeenCalledTimes(1);
      const msg = (Toast.warning as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg).toMatch(/multi-loop|hole|ADR-016/);
    });

    it('edge mode applyVCB with arc_plane_mismatch (V-β-β) → arc 평면 Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      ctx.bridge.offsetEdgeOnHost.mockReturnValue({
        ok: false, reason: 'arc_plane_mismatch',
      });
      tool.onActivate();
      vi.clearAllMocks();

      tool.applyVCBValue(50);

      expect(Toast.warning).toHaveBeenCalledTimes(1);
      const msg = (Toast.warning as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg).toMatch(/arc 평면|평면이 호스트/);
    });

    it('edge mode applyVCB with radius_collapse (V-β-β) → 반지름 축소 Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10]);
      ctx.bridge.offsetEdgeOnHost.mockReturnValue({
        ok: false, reason: 'radius_collapse', currentRadius: 0.5, newRadius: -0.1,
      });
      tool.onActivate();
      vi.clearAllMocks();

      tool.applyVCBValue(50);

      expect(Toast.warning).toHaveBeenCalledTimes(1);
      const msg = (Toast.warning as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg).toMatch(/반지름|방향 반전/);
    });

    it('edge mode applyVCB partial success → success + warning Toasts', async () => {
      const { Toast } = await import('../ui/Toast');
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([1, 2, 3]);
      ctx.bridge.offsetEdgeOnHost.mockImplementation((id: number) => {
        if (id === 1) return { ok: true, newEdge: 100, newV0: 1, newV1: 2 };
        if (id === 2) return { ok: false, reason: 'unsupported_curve', kind: 'Arc' };
        return { ok: false, reason: 'no_incident_face' };
      });
      tool.onActivate();
      vi.clearAllMocks();

      tool.applyVCBValue(50);

      expect(ctx.bridge.offsetEdgeOnHost).toHaveBeenCalledTimes(3);
      expect(Toast.success).toHaveBeenCalledTimes(1);
      const successMsg = (Toast.success as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(successMsg).toMatch(/1개 성공.*2개 실패/);
      expect(Toast.warning).toHaveBeenCalledTimes(1);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('face mode applyVCBValue still routes to offsetFace (legacy path intact)', async () => {
      // Pick a face first (Phase 0 → 1).
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(3);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);

      tool.applyVCBValue(50);

      // Existing face-offset call must fire.
      expect(ctx.bridge.offsetFace).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.offsetFace).toHaveBeenCalledWith(3, 50);
    });
  });
});
