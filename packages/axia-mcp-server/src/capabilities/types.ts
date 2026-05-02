// Capability handler shape — used by all src/capabilities/*.ts files.
import type { z } from 'zod';
import type { Tier } from '../tiers.js';

/**
 * The subset of AxiaEngine instance methods that MCP capabilities call.
 * Kept as an interface so test mocks can implement only what they need.
 *
 * Method names match the WASM bindings exactly (snake_case from Rust).
 */
export interface EngineInstance {
  draw_rect(
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    ux: number,
    uy: number,
    uz: number,
    width: number,
    height: number,
  ): number;
  push_pull(face_id_raw: number, dist: number): boolean;
  exportSnapshotStrict(): Uint8Array;
}

/** Engine module — has constructor + module-level functions. */
export interface EngineModule {
  schema_version(): string;
  engine_version(): string;
  AxiaEngine: new () => EngineInstance;
}

export interface CapabilityContext {
  engine: EngineInstance;
  client: string;
}

/**
 * CapabilityHandler — `inputSchema` must be a Zod schema whose `_output`
 * matches `TInput`. We use `z.ZodTypeAny` (not `z.ZodType<TInput>`) because
 * Zod's `.default()` introduces input/output asymmetry that `z.ZodType`
 * cannot express. The dispatcher always parses through the schema before
 * calling `handler`, so `TInput` is the post-parse (output) shape.
 */
export interface CapabilityHandler<TInput = unknown, TOutput = unknown> {
  name: string;
  tier: Tier;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (ctx: CapabilityContext, input: TInput) => Promise<TOutput> | TOutput;
}
