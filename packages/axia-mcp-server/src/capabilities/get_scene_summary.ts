// Tier 0 — get_scene_summary: high-level scene snapshot for AI first-look.
import { z } from 'zod';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({}).strict();

const OutputSchema = z.object({
  xia_count: z.number().int().nonnegative(),
  face_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  free_edge_count: z.number().int().nonnegative(),
  constraint_count: z.number().int().nonnegative(),
  engine_version: z.string(),
  schema_version: z.string(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const getSceneSummaryCapability: CapabilityHandler<Input, Output> = {
  name: 'get_scene_summary',
  tier: 0,
  description:
    'Return a high-level scene snapshot — entity counts + engine/schema ' +
    "versions. Cheap; safe to call repeatedly. Useful as an AI agent's " +
    'first call to understand what is in the scene before issuing edits.',
  inputSchema: InputSchema,
  handler: ({ engine }) => {
    const raw = engine.sceneSummary();
    let parsed: Output;
    try {
      parsed = OutputSchema.parse(JSON.parse(raw));
    } catch (e) {
      throw new Error(
        `Engine returned malformed sceneSummary JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return parsed;
  },
};
