// Thin wrapper around `zod-to-json-schema` so the rest of the codebase
// imports through a single seam (lets us swap library versions without
// hunting through every capability file).

import type { z } from 'zod';
import { zodToJsonSchema as zodToJson } from 'zod-to-json-schema';

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // `target: 'jsonSchema7'` matches what MCP clients (Claude Desktop) expect.
  // `$refStrategy: 'none'` keeps the schema flat — easier for LLMs to read.
  return zodToJson(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}
