// Tier 1 — draw_circle: parametric circle on an arbitrary plane.
//
// ADR-087 K-ζ + ADR-050 migration (2026-05-12) — circles are now created
// as form-layer Shapes by default (`draw_circle_as_shape`).
import { z } from 'zod';
import { Vec3, ShapeId } from '../schema.js';
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

const OutputSchema = z.object({ shape_id: ShapeId });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const drawCircleCapability: CapabilityHandler<Input, Output> = {
  name: 'draw_circle',
  tier: 1,
  description:
    'Draw a planar circle of given radius at center, oriented by normal. ' +
    "Returns the new form-layer Shape's owner ID. Underlying geometry is " +
    'an analytic circle (ADR-028); `segments` only affects render ' +
    'tessellation. Use `promote_shape_to_xia` to attach a material (ADR-050).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const [cx, cy, cz] = input.center;
    const [nx, ny, nz] = input.normal;
    const shape_id = engine.draw_circle_as_shape(
      cx, cy, cz,
      nx, ny, nz,
      input.radius,
      input.segments,
    );
    return { shape_id };
  },
};
