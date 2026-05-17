/**
 * TorusTool — Torus creation using unified primitive UX
 * 3-click flow: Click #1 (anchor) → Sizing1 (major radius) → Click #2
 *   → Sizing2 (minor radius) → Click #3 (complete)
 *
 * ADR-115 β-3 + ADR-116 ζ — Path B kernel-native primitive tool.
 * Default activated via SpherePathBSettings / ConePathBSettings pattern.
 * `create_torus` WASM endpoint always routes to Path B (kernel-native
 * from day 1 — no Path A baseline).
 *
 * **Param semantic mapping**:
 * - `params.radius` (sizing1) = torus major_radius (distance from torus
 *   center to tube center)
 * - `params.height` (sizing2) = torus minor_radius (tube radius)
 *
 * Names reused from PrimitiveSession (radius/height) for code consistency
 * — semantic intent is major/minor radius for torus.
 */

import { ToolContext } from '../tools/ITool';
import { BasePrimitiveTool } from './BasePrimitiveTool';
import { debugLog } from '../utils/debug';

export class TorusTool extends BasePrimitiveTool {
  readonly name = 'torus';

  constructor(ctx: ToolContext) {
    super(ctx, 'torus');
  }

  /**
   * Commit: Create torus via WASM and sync mesh to viewport.
   *
   * ADR-115 β-3 Path B canonical (1 face / 1 edge / 1 vert).
   * minor_radius must be < major_radius (self-intersecting torus
   * rejected by engine).
   */
  protected commit(): void {
    if (!this.session.isComplete()) {
      const { radius, height } = this.session.params;
      console.warn(
        `[Torus] ❌ Incomplete params: major=${radius?.toFixed(2) ?? 'undefined'}, minor=${height?.toFixed(2) ?? 'undefined'}`
      );
      return;
    }

    const { radius: majorRadius, height: minorRadius } = this.session.params;
    const anchor = this.session.anchor!;

    // Engine rejects minor >= major (self-intersecting torus). Clamp on
    // tool side with friendly toast / warning. ADR-115 engine bail wording
    // 답습.
    if (minorRadius >= majorRadius) {
      console.warn(
        `[Torus] ❌ minor_radius (${minorRadius.toFixed(2)}) must be < major_radius (${majorRadius.toFixed(2)}) — self-intersecting torus not supported`
      );
      return;
    }

    debugLog(
      `[Torus] Creating torus: major=${majorRadius.toFixed(2)}, minor=${minorRadius.toFixed(2)}, center=${anchor.toArray()}`
    );

    try {
      // Call WASM create_torus (Path B kernel-native, returns single face ID).
      const bridgeAny = this.ctx.bridge as unknown as {
        create_torus?: (cx: number, cy: number, cz: number, major: number, minor: number) => number;
      };
      if (!bridgeAny.create_torus) {
        console.error('[Torus] ✗ bridge.create_torus not available');
        return;
      }
      const torusFaceId = bridgeAny.create_torus(
        anchor.x,
        anchor.y,
        anchor.z,
        majorRadius,
        minorRadius,
      );

      if (torusFaceId < 0) {
        console.error('[Torus] ✗ WASM creation returned error');
        return;
      }

      // Synchronize WASM mesh to Three.js viewport.
      this.ctx.syncMesh();

      // Auto-group + auto-select the new primitive.
      this.autoGroupAndSelect(torusFaceId, 'Torus');

      debugLog(`[Torus] ✓ Created: faceId=${torusFaceId} (Path B kernel-native)`);
    } catch (err) {
      console.error('[Torus] ✗ Creation failed:', err);
    }

    // Cleanup and reset
    this.cleanup();
  }
}
