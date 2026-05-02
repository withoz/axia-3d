// Tier 2 — move_xia: translate all geometry of an XIA by (dx, dy, dz).
//
// Implementation: collect unique vertex IDs from XIA's owned faces, then
// `translateVerts` in one Rust call. ADR-007 face-orientation invariants
// preserved (translation is rigid).
import { z } from 'zod';
import { Vec3, XiaId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  xia_id: XiaId,
  delta: Vec3.describe('Translation vector [dx, dy, dz] in mm.'),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  vertex_count: z.number().int().nonnegative(),
  /** Some XIA may be empty (no faces) — moving it is a no-op. */
  is_no_op: z.boolean(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const moveXiaCapability: CapabilityHandler<Input, Output> = {
  name: 'move_xia',
  tier: 2,
  description:
    'Translate all geometry of an XIA (Object) by [dx, dy, dz] mm. ' +
    'Preserves topology, materials, and ADR-007 winding invariants. ' +
    'For face-only or edge-only translation use translate_verts (low-level).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const faceIds = engine.getXiaFaceIds(input.xia_id);
    if (faceIds.length === 0) {
      return { ok: true, vertex_count: 0, is_no_op: true };
    }
    const vertSet = new Set<number>();
    for (let i = 0; i < faceIds.length; i++) {
      const verts = engine.getFaceVertices(faceIds[i]!);
      for (let j = 0; j < verts.length; j++) {
        vertSet.add(verts[j]!);
      }
    }
    if (vertSet.size === 0) {
      return { ok: true, vertex_count: 0, is_no_op: true };
    }
    const vertArr = new Uint32Array([...vertSet]);
    const [dx, dy, dz] = input.delta;
    const ok = engine.translateVerts(vertArr, dx, dy, dz);
    return {
      ok,
      vertex_count: vertSet.size,
      is_no_op: false,
    };
  },
};
