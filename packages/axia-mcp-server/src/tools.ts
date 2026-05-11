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
import { isVisibleInToolsList, type CapabilityPolicy } from './policy.js';
import type { AuditSink } from './audit.js';

export interface ToolsWiringOptions {
  engine: EngineInstance;
  /** ADR-042 P27 — full capability policy (replaces tier-only config). */
  policy: CapabilityPolicy;
  auditSink: AuditSink;
  client: string;
  versions: { schema_version: string; engine_version: string };
}

/**
 * P27.4 — `tools/list` filter: a capability appears iff `evaluatePolicy()`
 * would allow it. ALLOW promotes capabilities above their tier; DENY
 * removes them. Defense in depth: dispatcher re-checks at call time.
 */
function visibleCapabilities(policy: CapabilityPolicy) {
  return ALL_CAPABILITY_HANDLERS.filter((h) => isVisibleInToolsList(h.name, policy));
}

export function wireTools(server: Server, opts: ToolsWiringOptions): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: visibleCapabilities(opts.policy).map((h) => ({
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
        policy: opts.policy,
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
