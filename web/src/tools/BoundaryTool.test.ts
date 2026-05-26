/**
 * BoundaryTool test — ADR-148 β-4 verification.
 *
 * Tests the TS UI tool integration of `bridge.boundaryFromPoint`:
 *   1. Click → bridge dispatch + syncMesh + Toast.success
 *   2. Engine throw → Toast.error with humanized Korean message
 *   3. humanizeBoundaryError translates all 4 BoundaryError variants
 *
 * Cross-link:
 *   - ADR-148 §2.4 (BoundaryError 4 variants Toast 한국어 매핑)
 *   - LOCKED #44 (Complete Meaning per Merge)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { BoundaryTool, humanizeBoundaryError } from './BoundaryTool';
import type { ToolContext } from './ITool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function mockCtx(): ToolContext {
  return {
    bridge: {
      boundaryFromPoint: vi.fn(() => 42),
    } as any,
    syncMesh: vi.fn(),
  } as unknown as ToolContext;
}

describe('BoundaryTool (ADR-148 β-4)', () => {
  let ctx: ToolContext;
  let tool: BoundaryTool;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = mockCtx();
    tool = new BoundaryTool(ctx);
  });

  describe('click dispatch', () => {
    it('click at valid point dispatches to bridge.boundaryFromPoint with Z=0 plane', async () => {
      const { Toast } = await import('../ui/Toast');
      const point = new THREE.Vector3(5, 5, 0);
      tool.onMouseDown({} as MouseEvent, point);

      expect(ctx.bridge.boundaryFromPoint).toHaveBeenCalledWith(
        5, 5, 0,  // point xyz
        0, 0, 1,  // normal (Z-up canonical, LOCKED #63)
        0,        // plane dist
        1000,     // DEFAULT_SEARCH_RADIUS_MM
      );
      expect(ctx.syncMesh).toHaveBeenCalledTimes(1);
      expect(Toast.success).toHaveBeenCalledWith('Boundary 면이 생성되었습니다');
      expect(Toast.error).not.toHaveBeenCalled();
    });

    it('null point shows warning and does not dispatch', async () => {
      const { Toast } = await import('../ui/Toast');
      tool.onMouseDown({} as MouseEvent, null);

      expect(ctx.bridge.boundaryFromPoint).not.toHaveBeenCalled();
      expect(ctx.syncMesh).not.toHaveBeenCalled();
      expect(Toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('유효한 평면 위 위치를 클릭'),
      );
    });

    it('engine throw → Toast.error with humanized Korean message (NoEnclosingCycle)', async () => {
      const { Toast } = await import('../ui/Toast');
      (ctx.bridge.boundaryFromPoint as any) = vi.fn(() => {
        throw new Error('boundaryFromPoint: NoEnclosingCycle');
      });
      const point = new THREE.Vector3(15, 5, 0);
      tool.onMouseDown({} as MouseEvent, point);

      expect(Toast.error).toHaveBeenCalledWith(
        expect.stringContaining('이 영역을 둘러싼 boundary 가 없습니다'),
      );
      expect(ctx.syncMesh).not.toHaveBeenCalled();
    });
  });

  describe('humanizeBoundaryError translations', () => {
    it('PointNotOnPlane includes distance value', () => {
      const msg = humanizeBoundaryError(
        'boundaryFromPoint: PointNotOnPlane (distance 10.000mm)',
      );
      expect(msg).toContain('10.000');
      expect(msg).toContain('평면 위가 아닙니다');
    });

    it('NoOrphanEdgesInRadius includes radius value', () => {
      const msg = humanizeBoundaryError(
        'boundaryFromPoint: NoOrphanEdgesInRadius (radius 1000.0mm)',
      );
      expect(msg).toContain('1000.0');
      expect(msg).toContain('boundary 후보가 없습니다');
    });

    it('NoEnclosingCycle returns canonical Korean message', () => {
      const msg = humanizeBoundaryError('boundaryFromPoint: NoEnclosingCycle');
      expect(msg).toBe('이 영역을 둘러싼 boundary 가 없습니다');
    });

    it('CycleAlreadyFaced returns canonical Korean message', () => {
      const msg = humanizeBoundaryError(
        'boundaryFromPoint: CycleAlreadyFaced (face 7)',
      );
      expect(msg).toContain('이미 면이 있습니다');
    });
  });

  describe('lifecycle', () => {
    it('isBusy always returns false (single-click tool)', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('onActivate shows info Toast', async () => {
      const { Toast } = await import('../ui/Toast');
      tool.onActivate();
      expect(Toast.info).toHaveBeenCalledWith(
        expect.stringContaining('Boundary 도구'),
      );
    });
  });
});
