// Tier 1 — export_axia: serialize current scene to AXIA binary blob.
// Returns base64-encoded bytes (JSON-RPC cannot carry raw binary).
import { z } from 'zod';
import type { CapabilityHandler } from './types.js';

const InputSchema = z.object({}).strict();

const OutputSchema = z.object({
  format: z.literal('AXIA'),
  bytes_base64: z.string().describe('Base64-encoded AXIA snapshot bytes'),
  size_bytes: z.number().int().nonnegative(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const exportAxiaCapability: CapabilityHandler<Input, Output> = {
  name: 'export_axia',
  tier: 1,
  description:
    'Export the current scene to an AXIA-format binary blob (versioned, ' +
    'invariant-checked). Returns base64-encoded bytes. The first 4 bytes ' +
    'decode to the magic string "AXIA".',
  inputSchema: InputSchema,
  handler: ({ engine }) => {
    const bytes = engine.exportSnapshotStrict();
    // Buffer.from(Uint8Array) shares memory; .toString('base64') copies.
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      format: 'AXIA' as const,
      bytes_base64: buffer.toString('base64'),
      size_bytes: bytes.byteLength,
    };
  },
};
