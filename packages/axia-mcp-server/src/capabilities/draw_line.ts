// Tier 1 — draw_line: straight line between two points on a draw plane.
//
// ADR-087 K-ζ + ADR-050 migration (2026-05-12) — lines are now created
// as form-layer Shapes by default (`draw_line_as_shape`).
import { z } from 'zod';
import { Vec3, ShapeId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  start: Vec3.describe('Start point [x,y,z] in mm'),
  end: Vec3.describe('End point [x,y,z] in mm'),
  plane_normal: Vec3.describe(
    'Working plane normal — used for snap / cardinal-plane projection. ' +
      'Default = world +Z. The line itself does not have to lie on this plane.',
  ).default([0, 0, 1]),
});

const OutputSchema = z.object({ shape_id: ShapeId });

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const drawLineCapability: CapabilityHandler<Input, Output> = {
  name: 'draw_line',
  tier: 1,
  description:
    'Draw a straight line segment from `start` to `end`. Returns the new ' +
    "form-layer Shape's owner ID. ADR-019 P4: an edge added on an existing " +
    'face whose endpoints lie on the same boundary loop will auto-split ' +
    'that face. Use `promote_shape_to_xia` to attach a material (ADR-050).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const [x0, y0, z0] = input.start;
    const [x1, y1, z1] = input.end;
    const [nx, ny, nz] = input.plane_normal;
    const shape_id = engine.draw_line_as_shape(x0, y0, z0, x1, y1, z1, nx, ny, nz);
    return { shape_id };
  },
};
