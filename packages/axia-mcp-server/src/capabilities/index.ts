// Capability registry — single source of truth for which handlers are wired.
//
// Adding a capability:
//   1. Create src/capabilities/<name>.ts (CapabilityHandler shape)
//   2. Add it to ALL_CAPABILITY_HANDLERS below
//   3. Verify the name matches one in src/tiers.ts (otherwise unknown error)
//   4. Add e2e regression test under test/capabilities/

import { drawRectCapability } from './draw_rect.js';
import { drawCircleCapability } from './draw_circle.js';
import { drawLineCapability } from './draw_line.js';
import { pushPullCapability } from './push_pull.js';
import { exportAxiaCapability } from './export_axia.js';
import { listXiasCapability } from './list_xias.js';
import { getSceneSummaryCapability } from './get_scene_summary.js';
import { booleanSubtractCapability } from './boolean_subtract.js';
import { filletEdgeCapability } from './fillet_edge.js';
import { moveXiaCapability } from './move_xia.js';
import { listGroupsCapability } from './list_groups.js';
import { getFaceInfoCapability } from './get_face_info.js';
import { getEdgeInfoCapability } from './get_edge_info.js';
import type { CapabilityHandler } from './types.js';
import { isKnownCapability } from '../tiers.js';

export const ALL_CAPABILITY_HANDLERS: ReadonlyArray<CapabilityHandler<any, any>> = [
  // Tier 0 — read
  getSceneSummaryCapability,
  listXiasCapability,
  listGroupsCapability,
  getFaceInfoCapability,
  getEdgeInfoCapability,
  // Tier 1 — constructive
  drawRectCapability,
  drawCircleCapability,
  drawLineCapability,
  exportAxiaCapability,
  // Tier 2 — modificative
  pushPullCapability,
  booleanSubtractCapability,
  filletEdgeCapability,
  moveXiaCapability,
];

const REGISTRY = new Map<string, CapabilityHandler<any, any>>();
for (const cap of ALL_CAPABILITY_HANDLERS) {
  if (!isKnownCapability(cap.name)) {
    throw new Error(
      `Capability "${cap.name}" is registered as a handler but not declared ` +
        `in tiers.ts. Add it to the appropriate TIER_* array first.`,
    );
  }
  if (REGISTRY.has(cap.name)) {
    throw new Error(`Duplicate capability registration: "${cap.name}"`);
  }
  REGISTRY.set(cap.name, cap);
}

export function getCapabilityHandler(
  name: string,
): CapabilityHandler<any, any> | undefined {
  return REGISTRY.get(name);
}

export function listRegisteredCapabilities(): string[] {
  return [...REGISTRY.keys()];
}

export type { CapabilityHandler, CapabilityContext, EngineInstance, EngineModule } from './types.js';
