// ADR-041 P26.3/P26.8 — owner ID enforcement regression
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OwnerId, FaceId, EdgeId, XiaId, Vec3, OWNER_ID_SENTINEL } from '../src/schema.js';

describe('ADR-041 P26.3 — owner ID schema invariants', () => {
  it('mcp_owner_ids_only_no_raw_indices — accepts u32 ids', () => {
    expect(OwnerId.parse(0)).toBe(0);
    expect(OwnerId.parse(42)).toBe(42);
    expect(OwnerId.parse(0xffff_ffff)).toBe(0xffff_ffff);
  });

  it('rejects negative IDs (no signed indices)', () => {
    expect(() => OwnerId.parse(-1)).toThrow();
  });

  it('rejects floats (no fractional indices)', () => {
    expect(() => OwnerId.parse(1.5)).toThrow();
  });

  it('rejects values exceeding u32', () => {
    expect(() => OwnerId.parse(0x1_0000_0000)).toThrow();
  });

  it('aliases (FaceId/EdgeId/XiaId) all share the OwnerId contract', () => {
    expect(FaceId.parse(7)).toBe(7);
    expect(EdgeId.parse(7)).toBe(7);
    expect(XiaId.parse(7)).toBe(7);
    expect(() => FaceId.parse(-1)).toThrow();
    expect(() => EdgeId.parse(-1)).toThrow();
  });

  it('OwnerId description carries semantic sentinel for surface scan', () => {
    // The test `mcp_owner_ids_only_no_raw_indices` (Stage 3) will scan
    // capability schemas for any int field whose description does NOT
    // contain this sentinel — that flags raw-index leakage.
    const desc = (OwnerId._def as { description?: string }).description ?? '';
    expect(desc).toContain(OWNER_ID_SENTINEL);
  });

  it('Vec3 accepts [x,y,z] in mm, rejects wrong arity', () => {
    expect(Vec3.parse([0, 0, 0])).toEqual([0, 0, 0]);
    expect(Vec3.parse([1.5, -2.3, 0])).toEqual([1.5, -2.3, 0]);
    expect(() => Vec3.parse([0, 0])).toThrow();
    expect(() => Vec3.parse([0, 0, 0, 0])).toThrow();
  });

  it('Vec3 rejects non-numeric coords', () => {
    expect(() => (Vec3 as unknown as z.ZodTypeAny).parse(['0', 0, 0])).toThrow();
  });
});

describe('ADR-041 P26.3 — defense against accidental raw-index exposure', () => {
  it('a hand-rolled `z.number().int()` in a capability schema is detectable', () => {
    // Pretend a capability author writes this (anti-pattern):
    const sloppy = z.object({
      face_idx: z.number().int(), // ← raw index leak
      vertex_id: OwnerId,
    });
    // The schema-drift sentinel test (in capability tests, Stage 3) must
    // walk such schemas and fail when an int field lacks the OwnerId
    // sentinel. Here we just sanity-check that hand-rolled int does NOT
    // carry the sentinel — proving the sentinel discriminates.
    const sloppyShape = (
      sloppy._def as unknown as { shape: () => Record<string, z.ZodTypeAny> }
    ).shape();
    const faceIdxDesc =
      (sloppyShape.face_idx!._def as { description?: string }).description ?? '';
    expect(faceIdxDesc).not.toContain(OWNER_ID_SENTINEL);
    const vertexIdDesc =
      (sloppyShape.vertex_id!._def as { description?: string }).description ?? '';
    expect(vertexIdDesc).toContain(OWNER_ID_SENTINEL);
  });
});
