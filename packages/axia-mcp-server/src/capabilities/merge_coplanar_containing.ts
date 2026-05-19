// Tier 2 — merge_coplanar_containing: ADR-006 C1 Phase F.
//
// ADR-101 LOCKED #40 / 메타-원칙 #15 의 canonical boundary op —
// headless 경로에서 큰 face 안의 작은 coplanar face 를 hole loop 로
// 명시 promote. UI tool path 의 ADR-021 P7 same-batch component-merge
// 와 의미 등가 (다만 명시적 호출 채널).
//
// 새 capability 추가 = 새 ADR (ADR-041 P26.1) → ADR-101 H-β.
import { z } from 'zod';
import { FaceId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  outer_face_id: FaceId.describe(
    'Owner ID of the outer face that will absorb the inner face as a hole.',
  ),
  inner_face_id: FaceId.describe(
    'Owner ID of the inner face. Must be coplanar with outer and lie ' +
      'entirely inside outer\'s boundary loop. Must NOT share an edge ' +
      '(use boolean_subtract or fillet_edge for adjacent merges).',
  ),
  angle_tol_deg: z
    .number()
    .nonnegative()
    .max(45)
    .default(1.0)
    .describe(
      'Coplanarity tolerance in degrees (default 1.0°). Faces are accepted ' +
        'as coplanar when their normals differ by no more than this angle.',
    ),
});

const OutputSchema = z.object({
  new_face_id: FaceId.describe(
    'Owner ID of the new merged face. The inner_face becomes the new ' +
      'face\'s inner hole loop. Both input face IDs are invalidated after ' +
      'this operation.',
  ),
  inner_loop_count: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Number of inner hole loops on the merged face. Should be ≥ 1 ' +
        '(at least the just-promoted inner). May be > 1 if the outer ' +
        'already had hole loops.',
    ),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const mergeCoplanarContainingCapability: CapabilityHandler<Input, Output> = {
  name: 'merge_coplanar_containing',
  tier: 2,
  description:
    'ADR-006 C1 Phase F — Merge a coplanar inner face into an outer ' +
    "face as a hole loop. Required boundary op for headless 'rectangle " +
    "with hole' / 'disk with hole' workflows because ADR-021 P7 " +
    'component-merge fires only within a single draw batch (LOCKED #40 / ' +
    '메타-원칙 #15). Both input faces must be coplanar (within ' +
    '`angle_tol_deg`) and must NOT share an edge. The inner face must ' +
    "lie entirely inside outer's boundary. Returns the new merged face " +
    'ID plus its inner loop count for invariant verification (ADR-007).',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const raw = engine.mergeCoplanarContaining(
      input.outer_face_id,
      input.inner_face_id,
      input.angle_tol_deg,
    );
    if (raw < 0) {
      throw new Error(
        'mergeCoplanarContaining failed (engine returned -1). ' +
          'Common causes: faces not coplanar, inner not inside outer, ' +
          'or faces share an edge.',
      );
    }
    const inner_loop_count = engine.faceInnerLoopCount(raw);
    return { new_face_id: raw, inner_loop_count };
  },
};
