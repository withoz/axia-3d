/**
 * SphereTool — Sphere creation using unified primitive UX
 * 2-click flow: Click #1 (anchor) → Sizing1 (radius) → Click #2 (complete)
 */

import { ToolContext } from '../tools/ITool';
import { BasePrimitiveTool } from './BasePrimitiveTool';
import { debugLog } from '../utils/debug';

export class SphereTool extends BasePrimitiveTool {
  readonly name = 'sphere';

  constructor(ctx: ToolContext) {
    super(ctx, 'sphere');
  }

  /**
   * Commit: Create sphere via WASM and sync mesh to viewport
   */
  protected commit(): void {
    if (!this.session.isComplete()) {
      console.warn('[Sphere] Incomplete params, cannot commit');
      return;
    }

    const { radius } = this.session.params;
    const anchor = this.session.anchor!;

    debugLog(`[Sphere] Creating sphere: radius=${radius.toFixed(2)}, center=${anchor.toArray()}`);

    try {
      // Call WASM to create sphere primitive (returns a face ID for Push/Pull)
      //
      // ── α (사용자 결재 2026-05-17): default tessellation 감소 ──
      // 이전 16×16 = 256 faces → syncMesh ~95ms (메타-원칙 #11 Click
      // budget 33ms 초과). 새 12×12 = 144 faces → syncMesh ~50ms.
      // smooth-group hide 자연 정합으로 시각 quality 손실 minimal
      // (사용자 canonical 원칙 "단순/신속/정확" 정합).
      const U_SEGMENTS = 12;
      const V_SEGMENTS = 12;
      const faceId = this.ctx.bridge.create_sphere(
        anchor.x,
        anchor.y,
        anchor.z,
        radius,
        U_SEGMENTS,
        V_SEGMENTS,
      );

      if (faceId < 0) {
        console.error('[Sphere] ✗ WASM creation returned error');
        return;
      }

      // ── β (사용자 결재 2026-05-17): Lazy syncMesh via RAF ──
      // syncMesh 가 primitive 생성 시간 의 88% (sphere 16×16: 26ms create
      // vs 192ms sync). RAF 으로 deferred → tool commit 의 user-perceived
      // latency 즉시 응답. viewport 시각 update 는 다음 frame (~16ms 후).
      // 메타-원칙 #11 Latency Budget 정합: Click 33ms budget 통과.
      requestAnimationFrame(() => {
        this.ctx.syncMesh();
      });

      // Auto-group + auto-select the new primitive
      this.autoGroupAndSelect(faceId, 'Sphere');

      debugLog(`[Sphere] ✓ Created: faceId=${faceId}, ready for Push/Pull (lazy sync)`);
    } catch (err) {
      console.error('[Sphere] ✗ Creation failed:', err);
    }

    // Cleanup and reset
    this.cleanup();
  }
}
