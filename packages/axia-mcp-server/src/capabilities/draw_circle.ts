// Tier 1 — draw_circle: parametric circle on an arbitrary plane.
// ADR-087 K-ζ + ADR-050 P-5c — legacy `engine.draw_circle` removed;
// now calls `engine.draw_circle_as_shape`. Output field `xia_id` preserved
// for backward compatibility (returns ShapeId.raw()).
import { z } from 'zod';
import { Vec3, XiaId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  center: Vec3.describe('Circle center [x,y,z] in mm'),
  normal: Vec3.describe('Plane normal direction. Default = +Z (Z-up plane).')
    .default([0, 0, 1]),
  radius: z.number().positive().describe('Radius (mm)'),
  segments: z
    .number()
    .int()
    .min(3)
    .max(256)
    .default(64)
    .describe(
      'Polyline tessellation count for the rendered hull. The underlying ' +
        'curve stays analytic (ADR-028); higher = smoother render only.',
    ),
});

const OutputSchema = z.object({ xia_id: XiaId });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const drawCircleCapability: CapabilityHandler<Input, Output> = {
  name: 'draw_circle',
  tier: 1,
  description:
    'Draw a planar circle of given radius at center, oriented by normal. ' +
    'Returns the owner ID of the newly created form-layer Shape (ADR-050 ' +
    'P-5c). Output field `xia_id` preserved for backward compatibility; ' +
    'value is a ShapeId. Underlying geometry is analytic (ADR-028); ' +
    '`segments` only affects render tessellation.',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const [cx, cy, cz] = input.center;
    const [nx, ny, nz] = input.normal;
    // ADR-087 K-ζ — legacy `draw_circle` removed; use `_as_shape` variant.
    const raw = engine.draw_circle_as_shape(
      cx, cy, cz,
      nx, ny, nz,
      input.radius,
      input.segments,
    );
    if (raw < 0) {
      throw new Error('draw_circle_as_shape failed (engine returned -1)');
    }
    return { xia_id: raw };
  },
};
