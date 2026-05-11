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
      const faceId = this.ctx.bridge.create_sphere(
        anchor.x,
        anchor.y,
        anchor.z,
        radius,
        16, // u_segments
        16  // v_segments
      );

      if (faceId < 0) {
        console.error('[Sphere] ✗ WASM creation returned error');
        return;
      }

      // Synchronize WASM mesh to Three.js viewport
      this.ctx.syncMesh();

      // Auto-group + auto-select the new primitive
      this.autoGroupAndSelect(faceId, 'Sphere');

      debugLog(`[Sphere] ✓ Created: faceId=${faceId}, ready for Push/Pull`);
    } catch (err) {
      console.error('[Sphere] ✗ Creation failed:', err);
    }

    // Cleanup and reset
    this.cleanup();
  }
}
