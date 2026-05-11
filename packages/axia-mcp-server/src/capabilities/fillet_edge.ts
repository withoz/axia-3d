// Tier 2 — fillet_edge: round a sharp edge with a circular arc.
import { z } from 'zod';
import { EdgeId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  edge_id: EdgeId,
  radius: z
    .number()
    .positive()
    .describe('Fillet radius in mm. Must fit within both incident faces.'),
  segments: z
    .number()
    .int()
    .min(1)
    .max(64)
    .default(8)
    .describe(
      'Tessellation segments along the arc. Higher = smoother render but ' +
        'more triangles. Engine clamps to [1, 64].',
    ),
});

const OutputSchema = z.object({
  /** New face count returned by engine — 0 indicates failure. */
  result_face_count: z.number().int().nonnegative(),
  ok: z.boolean(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const filletEdgeCapability: CapabilityHandler<Input, Output> = {
  name: 'fillet_edge',
  tier: 2,
  description:
    'Round (fillet) a sharp manifold edge with a circular arc of `radius` ' +
    'mm. The two incident faces gain a new arc-strip face. Fails on ' +
    'non-manifold edges (valence != 2). For 3-way corner singularities ' +
    'use chamfer_vertex_3way (ADR-024 P10).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const count = engine.filletEdge(input.edge_id, input.radius, input.segments);
    return {
      result_face_count: count,
      ok: count > 0,
    };
  },
};
