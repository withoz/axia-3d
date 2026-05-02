// Tier 2 — push_pull: extrude or inset a face along its normal.
import { z } from 'zod';
import { FaceId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  face_id: FaceId,
  distance: z
    .number()
    .describe(
      'Signed distance in mm. Positive = extrude along front normal (Pull), ' +
        'negative = inset (Push). Coplanar wall merging is automatic (ADR-005).',
    ),
});

const OutputSchema = z.object({
  success: z.boolean(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const pushPullCapability: CapabilityHandler<Input, Output> = {
  name: 'push_pull',
  tier: 2,
  description:
    'Extrude (positive) or inset (negative) a face by `distance` mm along its ' +
    'front normal. Maintains ADR-007 face-orientation invariants and merges ' +
    'coplanar adjacent walls automatically.',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const success = engine.push_pull(input.face_id, input.distance);
    return { success };
  },
};
