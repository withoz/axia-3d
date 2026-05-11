// Tier 0 — get_edge_info: read-only edge metadata.
import { z } from 'zod';
import { EdgeId, Vec3 } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  edge_id: EdgeId,
});

const OutputSchema = z.object({
  edge_id: EdgeId,
  /** Curve kind. 0 = plain (no analytic), 2 = Circle, 3 = Arc, etc. */
  curve_kind: z.number().int(),
  /** Edge endpoint A (world coordinates, mm). */
  start: Vec3,
  /** Edge endpoint B. */
  end: Vec3,
  /** True if edge has an attached AnalyticCurve (kind > 0). */
  has_analytic_curve: z.boolean(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const getEdgeInfoCapability: CapabilityHandler<Input, Output> = {
  name: 'get_edge_info',
  tier: 0,
  description:
    'Return edge metadata: curve kind, start/end points, analytic curve ' +
    'flag. AI can use curve_kind > 0 to know which edges are eligible ' +
    'for analytic-precision hover (ADR-040 P25).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const curve_kind = engine.edgeCurveKind(input.edge_id);
    // Sample at coarse tolerance — first and last points are endpoints
    // for any curve type.
    const flat = engine.tessellateEdge(input.edge_id, 1.0);
    if (flat.length < 6) {
      // Empty / invalid — return zeros + has_analytic_curve based on kind
      return {
        edge_id: input.edge_id,
        curve_kind,
        start: [0, 0, 0] as [number, number, number],
        end: [0, 0, 0] as [number, number, number],
        has_analytic_curve: curve_kind > 0,
      };
    }
    const start: [number, number, number] = [
      flat[0]!,
      flat[1]!,
      flat[2]!,
    ];
    const end: [number, number, number] = [
      flat[flat.length - 3]!,
      flat[flat.length - 2]!,
      flat[flat.length - 1]!,
    ];
    return {
      edge_id: input.edge_id,
      curve_kind,
      start,
      end,
      has_analytic_curve: curve_kind > 0,
    };
  },
};
