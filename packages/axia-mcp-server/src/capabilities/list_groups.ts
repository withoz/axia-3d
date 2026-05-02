// Tier 0 — list_groups: enumerate all groups in the scene.
import { z } from 'zod';
import { GroupId } from '../schema.js';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({}).strict();

const GroupSummary = z.object({
  group_id: GroupId,
  /** Engine-provided name (display label). */
  name: z.string().optional(),
  /** Owned face IDs (count) — full list omitted for brevity. */
  face_count: z.number().int().nonnegative().optional(),
  /** Optional parent group ID (nested groups). */
  parent: z.union([GroupId, z.null()]).optional(),
  /** Visibility / lock flags. */
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  is_component: z.boolean().optional(),
});

const OutputSchema = z.object({
  count: z.number().int().nonnegative(),
  groups: z.array(GroupSummary),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

interface RawGroup {
  id?: number;
  name?: string;
  faceCount?: number;
  faceIds?: number[];
  parent?: number | null;
  visible?: boolean;
  locked?: boolean;
  isComponent?: boolean;
}

export const listGroupsCapability: CapabilityHandler<Input, Output> = {
  name: 'list_groups',
  tier: 0,
  description:
    'List all groups (and components) in the scene. Returns id + name + ' +
    'face count + nesting parent + visibility/lock flags. Read-only.',
  inputSchema: InputSchema,
  handler: ({ engine }) => {
    let raw: unknown;
    try {
      raw = JSON.parse(engine.get_all_groups());
    } catch {
      return { count: 0, groups: [] };
    }
    const arr: RawGroup[] = Array.isArray(raw)
      ? (raw as RawGroup[])
      : Array.isArray((raw as { groups?: RawGroup[] }).groups)
        ? (raw as { groups: RawGroup[] }).groups
        : [];
    const groups = arr
      .filter((g) => typeof g.id === 'number')
      .map((g) => ({
        group_id: g.id!,
        name: g.name,
        face_count:
          typeof g.faceCount === 'number'
            ? g.faceCount
            : Array.isArray(g.faceIds)
              ? g.faceIds.length
              : undefined,
        parent: g.parent ?? null,
        visible: g.visible,
        locked: g.locked,
        is_component: g.isComponent,
      }));
    return { count: groups.length, groups };
  },
};
