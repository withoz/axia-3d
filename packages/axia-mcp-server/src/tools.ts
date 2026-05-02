// MCP `tools/list` + `tools/call` wiring.
//
// Converts the capability registry to JSON Schema for tools/list, and
// routes tools/call through the dispatcher with full tier authorization
// + audit + input validation.

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from './zod_to_json_schema.js';
import { dispatch } from './dispatcher.js';
import {
  ALL_CAPABILITY_HANDLERS,
  type EngineInstance,
} from './capabilities/index.js';
import type { TierConfig } from './tiers.js';
import type { AuditSink } from './audit.js';

export interface ToolsWiringOptions {
  engine: EngineInstance;
  config: TierConfig;
  auditSink: AuditSink;
  client: string;
  versions: { schema_version: string; engine_version: string };
}

/**
 * Filter handlers by config — capabilities whose tier is not enabled are
 * excluded from `tools/list` so AI agents do not even see them.
 * Enforcement is still done at dispatch time (defense in depth).
 */
function visibleCapabilities(config: TierConfig) {
  return ALL_CAPABILITY_HANDLERS.filter((h) => config.enabled_tiers.includes(h.tier));
}

export function wireTools(server: Server, opts: ToolsWiringOptions): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: visibleCapabilities(opts.config).map((h) => ({
        name: h.name,
        description: h.description,
        inputSchema: zodToJsonSchema(h.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    try {
      const result = await dispatch(name, rawArgs ?? {}, {
        engine: opts.engine,
        config: opts.config,
        auditSink: opts.auditSink,
        client: opts.client,
        versions: opts.versions,
      });
      const response: CallToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.output, null, 2),
          },
        ],
      };
      return response;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const response: CallToolResult = {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error in "${name}": ${msg}`,
          },
        ],
      };
      return response;
    }
  });
}
