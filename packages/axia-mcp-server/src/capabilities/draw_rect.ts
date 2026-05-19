// Tier 1 — draw_rect: parametric rectangle on an arbitrary plane.
// ADR-087 K-ζ + ADR-050 P-5c — legacy `engine.draw_rect` removed;
// now calls `engine.draw_rect_as_shape`. Output field `xia_id` preserved
// for backward compatibility (returns ShapeId.raw()).
import { z } from 'zod';
import { Vec3, XiaId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  center: Vec3.describe('Rect center [x,y,z] in mm'),
  normal: Vec3.describe(
    'Plane normal direction. Default = world Z (+up). Cardinal-plane snap is auto-applied.',
  )
    .default([0, 0, 1]),
  up: Vec3.describe(
    "In-plane 'up' axis perpendicular to normal. Default = +X for the Z-up plane.",
  ).default([1, 0, 0]),
  width: z.number().positive().describe('Width along the up axis (mm)'),
  height: z
    .number()
    .positive()
    .describe('Height along (normal × up) axis (mm)'),
});

const OutputSchema = z.object({
  xia_id: XiaId,
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const drawRectCapability: CapabilityHandler<Input, Output> = {
  name: 'draw_rect',
  tier: 1,
  description:
    'Draw a planar rectangle of given width × height at center, oriented by ' +
    '(normal, up). Returns the owner ID of the newly created form-layer ' +
    'Shape (ADR-050 P-5c). The output field is named `xia_id` for backward ' +
    'compatibility; the value is a ShapeId. Promotion to a property-layer ' +
    'Xia requires explicit material assignment (ADR-049 §4 Q1). Coordinates ' +
    'on a cardinal plane within 1e-3 mm are snapped exactly (ADR-026 P12).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const [cx, cy, cz] = input.center;
    const [nx, ny, nz] = input.normal;
    const [ux, uy, uz] = input.up;
    // ADR-087 K-ζ — legacy `draw_rect` removed; use `_as_shape` variant.
    // Returns ShapeId.raw() as f64, -1.0 on error.
    const raw = engine.draw_rect_as_shape(
      cx, cy, cz, nx, ny, nz, ux, uy, uz, input.width, input.height,
    );
    if (raw < 0) {
      throw new Error('draw_rect_as_shape failed (engine returned -1)');
    }
    return { xia_id: raw };
  },
};
