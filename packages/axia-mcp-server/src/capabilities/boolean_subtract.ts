// Tier 2 — boolean_subtract: A \ B (mesh-level CSG).
import { z } from 'zod';
import { FaceId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  faces_a: z
    .array(FaceId)
    .min(1)
    .describe(
      'Face IDs forming the minuend (the solid we keep parts of). Owner ' +
        'IDs only — NOT raw triangle indices (ADR-041 P26.3).',
    ),
  faces_b: z
    .array(FaceId)
    .min(1)
    .describe('Face IDs forming the subtrahend (the solid carved away).'),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  result_faces: z.array(FaceId).optional(),
  total_verts: z.number().int().nonnegative().optional(),
  total_faces: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

interface EngineBooleanResult {
  ok?: boolean;
  resultFaces?: number[];
  totalVerts?: number;
  totalFaces?: number;
  error?: string;
}

export const booleanSubtractCapability: CapabilityHandler<Input, Output> = {
  name: 'boolean_subtract',
  tier: 2,
  description:
    'Compute A \\ B (subtract solid B from solid A). Both operand sets ' +
    'must be closed solids; faces with holes are rejected (ADR-006 Phase ' +
    'G constrained Delaunay limitation). Engine merges coplanar walls ' +
    'in the result automatically (ADR-005).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const facesA = new Uint32Array(input.faces_a);
    const facesB = new Uint32Array(input.faces_b);
    const raw = engine.boolean_op(facesA, facesB, 'subtract');
    let parsed: EngineBooleanResult;
    try {
      parsed = JSON.parse(raw) as EngineBooleanResult;
    } catch {
      return { ok: false, error: 'engine returned non-JSON' };
    }
    return {
      ok: parsed.ok ?? false,
      result_faces: parsed.resultFaces,
      total_verts: parsed.totalVerts,
      total_faces: parsed.totalFaces,
      error: parsed.error,
    };
  },
};
