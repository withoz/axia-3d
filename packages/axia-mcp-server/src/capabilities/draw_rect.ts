// Tier 1 — draw_rect: parametric rectangle on an arbitrary plane.
//
// Returns the ShapeId (form-layer owner) created by the engine.
//
// ADR-087 K-ζ + ADR-050 P-5e-α migration (2026-05-12) — the legacy
// XiaId-returning `engine.draw_rect` was removed; rectangles are now
// created as form-layer Shapes by default (`draw_rect_as_shape`).
// To promote a Shape to a Xia (property-layer with material), use a
// separate `promote_shape_to_xia` capability (future Tier 2 entry).
import { z } from 'zod';
import { Vec3, ShapeId } from '../schema.js';
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
  shape_id: ShapeId,
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const drawRectCapability: CapabilityHandler<Input, Output> = {
  name: 'draw_rect',
  tier: 1,
  description:
    'Draw a planar rectangle of given width × height at center, oriented by ' +
    "(normal, up). Returns the new form-layer Shape's owner ID. Coordinates " +
    'that lie on a cardinal plane to within 1e-3 mm are snapped exactly to ' +
    'that plane (ADR-026 P12). Use `promote_shape_to_xia` to attach a ' +
    'material and gain property-layer (Xia) status (ADR-050).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const [cx, cy, cz] = input.center;
    const [nx, ny, nz] = input.normal;
    const [ux, uy, uz] = input.up;
    const shape_id = engine.draw_rect_as_shape(
      cx, cy, cz, nx, ny, nz, ux, uy, uz, input.width, input.height,
    );
    return { shape_id };
  },
};
