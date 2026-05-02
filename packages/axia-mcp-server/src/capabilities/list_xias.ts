// Tier 0 — list_xias: enumerate all XiaIds with optional summary stats.
import { z } from 'zod';
import { XiaId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({
  /** When true, include per-xia stats (face_count, geometry_state, etc.). */
  include_stats: z.boolean().default(false).describe(
    'Include per-XIA stats (face_count, geometry_state). Slower for ' +
      'large scenes — enable only when needed for the next reasoning step.',
  ),
});

const XiaSummary = z.object({
  xia_id: XiaId,
  /** Optional — present only when `include_stats=true`. */
  stats: z.unknown().optional(),
});

const OutputSchema = z.object({
  count: z.number().int().nonnegative(),
  xias: z.array(XiaSummary),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const listXiasCapability: CapabilityHandler<Input, Output> = {
  name: 'list_xias',
  tier: 0,
  description:
    'List all XIA (Object) IDs in the current scene. Optionally include ' +
    'per-XIA stats (face count, geometry state). Read-only — never mutates.',
  inputSchema: InputSchema,
  handler: ({ engine }, input) => {
    const ids = Array.from(engine.allXiaIds());
    const xias = ids.map((id) => {
      const summary: { xia_id: number; stats?: unknown } = { xia_id: id };
      if (input.include_stats) {
        try {
          summary.stats = JSON.parse(engine.getXiaStats(id));
        } catch {
          summary.stats = { error: 'failed to parse stats JSON' };
        }
      }
      return summary;
    });
    return { count: ids.length, xias };
  },
};
