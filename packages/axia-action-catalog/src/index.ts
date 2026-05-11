// ADR-045 D1 — ActionCatalog public API.
//
// Single import surface for both web/ and packages/axia-mcp-server/.

export type {
  Tier,
  Surface,
  ActionAliases,
  ActionDef,
  LookupResult,
} from './types.js';

export {
  ALL_ACTIONS,
  CATALOG_SIZE,
  getActionById,
  getActionByBridgeAlias,
  getActionByWasmAlias,
  getActionByMcpAlias,
  lookup,
  listActionIds,
  actionsByTier,
} from './catalog.js';
