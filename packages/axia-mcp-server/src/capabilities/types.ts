// Capability handler shape — used by all src/capabilities/*.ts files.
import type { z } from 'zod';
import type { Tier } from '../tiers.js';

/**
 * The subset of AxiaEngine instance methods that MCP capabilities call.
 * Kept as an interface so test mocks can implement only what they need.
 *
 * Method names match the WASM bindings exactly (snake_case from Rust).
 *
 * ADR-087 K-ζ + ADR-050 migration (2026-05-13) — the legacy XiaId
 * producers (`draw_rect` / `draw_circle` / `draw_line`) and the legacy
 * `push_pull` were deleted from WASM. The three draws return form-layer
 * ShapeIds via the `_as_shape` variants; Push/Pull is now reached via
 * the surface-native `create_solid_extrude` (ADR-079 W-1-β). The MCP
 * capability *names* (`draw_rect`, `push_pull`, …) are unchanged for
 * UI / audit stability.
 */
export interface EngineInstance {
  /** ADR-050 P-5c — draw a rectangle as a form-layer Shape. Returns ShapeId. */
  draw_rect_as_shape(
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
  /** ADR-050 P-5c — draw a circle as a form-layer Shape. Returns ShapeId. */
  draw_circle_as_shape(
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    radius: number,
    segments: number,
  ): number;
  /** ADR-050 P-5c — draw a line as a form-layer Shape. Returns ShapeId. */
  draw_line_as_shape(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    nx: number,
    ny: number,
    nz: number,
  ): number;
  /** ADR-079 W-1-β — surface-native solid extrusion (replaces legacy push_pull). */
  create_solid_extrude(face_id_raw: number, dist: number): boolean;
  exportSnapshotStrict(): Uint8Array;
  /** ADR-041 P26.1 Tier 0 — list all XiaId in scene (sorted ascending). */
  allXiaIds(): Uint32Array;
  /** ADR-041 P26.1 Tier 0 — scene-level JSON summary. */
  sceneSummary(): string;
  /** Per-XIA stats JSON: { face_count, edge_count, geometry_state, ... }. */
  getXiaStats(xia_id: number): string;
  /** XIA's owned face IDs. */
  getXiaFaceIds(xia_id: number): Uint32Array;
  /** ADR-041 P26.1 Tier 2 — boolean op on two face groups, returns JSON. */
  boolean_op(facesA: Uint32Array, facesB: Uint32Array, op: string): string;
  /** ADR-041 P26.1 Tier 2 — fillet an edge, returns the new face count. */
  filletEdge(edgeIdRaw: number, radius: number, segments: number): number;
  /** Translate a vertex set by (dx, dy, dz). Used by move_xia. */
  translateVerts(vertIds: Uint32Array, dx: number, dy: number, dz: number): boolean;
  /** Vertex IDs touching a face. Used by move_xia. */
  getFaceVertices(faceIdRaw: number): Uint32Array;
  // ─── Tier 0 read additions ─────────────────────────────────────
  /** Face area in mm². */
  faceArea(faceIdRaw: number): number;
  /** True if face belongs to a closed solid (Volume). */
  isFaceInVolume(faceIdRaw: number): boolean;
  /** Number of inner loops (holes) on the face. */
  faceInnerLoopCount(faceIdRaw: number): number;
  /** Edge curve kind code (0=plain Line, 1=Line var, 2=Circle, 3=Arc,
   *  4=Bezier, 5=BSpline, 6=NURBS). */
  edgeCurveKind(edgeId: number): number;
  /** Surface kind code (0=none, 1=Plane, 2=Cylinder, ..., 8=NURBSSurface). */
  faceSurfaceKind(faceId: number): number;
  /** Tessellate an edge — first/last point are endpoints. */
  tessellateEdge(edgeId: number, chordTol: number): Float64Array;
  /** All groups JSON. */
  get_all_groups(): string;
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
