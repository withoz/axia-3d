// Tier 0 — get_face_info: read-only face metadata.
import { z } from 'zod';
import { FaceId, VertexId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  face_id: FaceId,
});

const OutputSchema = z.object({
  face_id: FaceId,
  /** Surface area in mm². 0 may indicate invalid face. */
  area: z.number().nonnegative(),
  /** True if face is a wall of a closed solid. False for open sheets. */
  in_volume: z.boolean(),
  /** Inner loop count = number of holes in the face (multi-loop, ADR-006). */
  inner_loop_count: z.number().int().nonnegative(),
  /** Vertex IDs in CCW order of the outer loop (one revolution). */
  vertices: z.array(VertexId),
  /** Surface kind code (0=plain, 1=Plane, ... 8=NURBSSurface). */
  surface_kind: z.number().int(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const getFaceInfoCapability: CapabilityHandler<Input, Output> = {
  name: 'get_face_info',
  tier: 0,
  description:
    'Return face metadata: area (mm²), in_volume flag, inner loop count, ' +
    'vertex IDs, and surface kind. Read-only — useful for AI to plan an ' +
    'edit (e.g. "is this face suitable for push_pull?").',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const verts = Array.from(engine.getFaceVertices(input.face_id));
    return {
      face_id: input.face_id,
      area: engine.faceArea(input.face_id),
      in_volume: engine.isFaceInVolume(input.face_id),
      inner_loop_count: engine.faceInnerLoopCount(input.face_id),
      vertices: verts,
      surface_kind: engine.faceSurfaceKind(input.face_id),
    };
  },
};
