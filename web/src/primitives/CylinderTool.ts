/**
 * CylinderTool — Cylinder creation using unified primitive UX
 * 3-click flow: Click #1 (anchor) → Sizing1 (radius) → Click #2 → Sizing2 (height) → Click #3 (complete)
 */

import { ToolContext } from '../tools/ITool';
import { BasePrimitiveTool } from './BasePrimitiveTool';
import { debugLog } from '../utils/debug';

export class CylinderTool extends BasePrimitiveTool {
  readonly name = 'cylinder';

  constructor(ctx: ToolContext) {
    super(ctx, 'cylinder');
  }

  /**
   * Commit: Create cylinder via WASM and sync mesh to viewport
   */
  protected commit(): void {
    if (!this.session.isComplete()) {
      const { radius, height } = this.session.params;
      console.warn(
        `[Cylinder] ❌ Incomplete params: radius=${radius?.toFixed(2) ?? 'undefined'}, height=${height?.toFixed(2) ?? 'undefined'}`
      );
      return;
    }

    const { radius, height } = this.session.params;
    const anchor = this.session.anchor!;

    debugLog(
      `[Cylinder] Creating cylinder: radius=${radius.toFixed(2)}, height=${height.toFixed(2)}, center=${anchor.toArray()}`
    );

    try {
      // Call WASM to create cylinder primitive (returns base face ID for Push/Pull)
      const baseFaceId = this.ctx.bridge.create_cylinder(
        anchor.x,
        anchor.y,
        anchor.z,
        radius,
        height,
        16  // segments
      );

      if (baseFaceId < 0) {
        console.error('[Cylinder] ✗ WASM creation returned error');
        return;
      }

      // Synchronize WASM mesh to Three.js viewport
      this.ctx.syncMesh();

      // Auto-group + auto-select the new primitive
      this.autoGroupAndSelect(baseFaceId, 'Cylinder');

      debugLog(`[Cylinder] ✓ Created: baseFaceId=${baseFaceId}, ready for Push/Pull`);
    } catch (err) {
      console.error('[Cylinder] ✗ Creation failed:', err);
    }

    // Cleanup and reset
    this.cleanup();
  }
}
