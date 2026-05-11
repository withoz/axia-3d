# ADR-008: Face Operation Axioms

**Status**: Accepted (2026-04-24)
**Supersedes**: Implicit behaviour rules before Phase 1 refactor
**Related**: ADR-003 (Geometric validity guards), ADR-007 (Face orientation policy)

---

## Context

AXiA 3D is a hybrid CAD/modelling engine that reconciles two mental models users bring:

- **Vector drawing** ("I drew a line, a rectangle, etc. — the face just appears")
- **CAD solid** ("this face is a boundary of a 3D volume, I need strict topology")

User (project owner) formalised the governing rules on 2026-04-24 during a
debugging session where RECT-drawn and LINE-drawn geometry diverged in
behaviour. This ADR captures those rules so every future feature
(merge, erase, split, boolean, push/pull, etc.) can be tested against a
single source of truth.

---

## Axioms

### Axiom 1 — Face is a Byproduct
> A face is the **byproduct of a closed LINE loop**.
>
> Faces are never first-class independent entities. They appear automatically
> when a collection of edges forms a coplanar closed cycle, and they
> disappear when the cycle is broken.

**Implication**: Every tool that "creates a face" must ultimately go through
the LINE pipeline (draw_line → loop detection → synthesize_face). There is
no separate face-creation path.

### Axiom 2 — RECT = 4 LINEs
> RECT is a **keyboard shortcut for drawing 4 LINEs** that happen to close
> a loop. It has no additional semantics.
>
> Similarly, CIRCLE = N LINEs, POLYGON = N LINEs, ARC = sampled LINEs.

**Implication**: `exec_draw_rect` must call `exec_draw_line` 4 times
(via re-entrant transaction). All vertex dedup, edge sharing, crossing
detection that LINE does must be identical for RECT.

### Axiom 3 — Normal Follows Drawing Plane
> A face's normal is determined by the **drawing plane at creation time**:
> - Floor (XZ ground) → `+Y`
> - Wall → wall's normal
> - Arbitrary tilted plane → plane's normal
>
> Once created, the normal stays put (no auto-flip).

### Axiom 4 — Surface vs Solid (Observed, Not Constrained)
> A face is classified — **as a consequence of topology**:
> - **Surface face**: free-standing face, not a boundary of any closed solid
> - **Solid face**: boundary of a closed 3D volume (the volume has matching
>   pair faces on the opposite side)
>
> This is **observed**, not enforced. The system never prevents an
> operation because it would change the classification.

**Implication**: `is_surface_face()` / `is_solid_face()` are queries for
UI feedback (like Toast notifications), never gates.

### Axiom 5 — Edge Erase Rules

| Case | Result |
|------|--------|
| Surface ↔ Surface **bounded-empty** (closed edge-loop around empty area) | **Face expansion** (re-synthesis) — existing face grows to swallow the empty region |
| Surface ↔ Surface face | **Merge** — two faces become one |
| Surface ↔ Solid face | **Merge** allowed; the solid **degrades** to surfaces (de-solidify) |
| Solid ↔ Solid face | **Conditional merge** — depends on coplanarity and shared boundary |
| Solid ↔ bounded-empty | **Invalid state** — should never arise (indicates a bug elsewhere) |

### Axiom 6 — Re-synthesis Rule
> After erase, if a closed coplanar edge loop is newly formed,
> **a face is automatically synthesised** — provided the enclosed region
> does not belong to an existing solid volume.

**Implication**: erase is not just "delete the edge". It triggers loop
rescan on affected vertices; any new closed loop spawns a face.

### Axiom 7 — Face Interaction
- LINE crossing a face interior → face **splits** at the line
- RECT overlapping an existing face → overlap region becomes a **sub-face**,
  producing 3+ sub-faces total (SketchUp style)
- Adjacent RECTs (sharing an edge segment) → **DCEL edge shared** (single
  topology edge with both faces on either side)
- RECT drawn across LINE → LINE edges split at crossings; faces synthesized
  where new closed loops form

### Axiom 8 — Undo Atomicity
> One user-triggered tool invocation = **one undo frame**.
>
> RECT's internal 4× LINE calls, Circle's N× LINE calls, and any cascaded
> face-split or face-synthesis all collapse into a single Ctrl+Z unit.

**Implication**: Achieved via re-entrant transactions
(`transactions.is_recording()` detection in inner calls).

### Axiom 9 — Ctrl+M Merge Rules

| Faces selected | Topology | Result |
|----------------|----------|--------|
| 2+ | Coplanar + adjacent (share DCEL edge) | **merge** |
| 2+ | Coplanar + overlap | **union face** (polygon union) |
| 2+ | Non-coplanar | **forced polygon mesh merge** — emits a non-planar mesh region (violates Axiom below if not handled; see Phase D) |
| 1 | n/a | no-op |

---

## Implementation Phases

| Phase | Status | What | Commit |
|-------|--------|------|--------|
| A | ✅ Done | RECT/CIRCLE → 4× LINE, re-entrant transactions | c08954f |
| B-1 | ✅ Done | Endpoint-on-edge (collinear) split for RECT overlap | de093b7 |
| B-2 | ✅ Done | Erase re-synthesis (Axiom 6) — newly-freed edges scope | 3266553 |
| C | ✅ Done | De-solidify detection + Toast on solid→surface downgrade | b41bb57 |
| D | ✅ Done | Non-coplanar forced merge via soft-edge region (preserves ADR-007) | 5638c00 |
| E (B1) | ✅ Done | Inner RECT → sub-face + outer hole promotion | d71df4d |
| SU-P1 | ✅ Done | Offset tool UI: face-only (edge-offset UI 제거) | 3bbb741 |
| SU-P3 | ✅ Done | Face Operation Epoch — RECT의 4× post-process를 1×로 | 3bbb741 |
| SU-P5 | ✅ Done | Offset preview mesh-invariant (이미 충족 — Ghost만 변경) | n/a |
| SU-P6 | ✅ Done | Interior-RECT atomic classifier — B1 케이스 fast-path | c0812ea |
| SU-P2 | 🔴 Defer | Bounded offset — 인접 face에서 자동 중단 (SketchUp 동작) | — |
| SU-P4 | 🔴 Defer | Face AABB BVH 인덱스 — O(F) scan을 O(log F)로 | — |

---

## Test Coverage Sources

- `crates/axia-core/tests/two_rects_merge_user_flow.rs` — end-to-end scene
  API tests for adjacent/overlapping rects, snap drift recovery, RECT↔LINE
  equivalence.
- `crates/axia-geo/tests/line_vs_rect_edge_parity.rs` — flag/render parity
  between LINE-drawn and RECT-drawn edges.
- `crates/axia-geo/src/operations/geometric_merge.rs` — tests for the
  geometric merge fallback used when snap drift breaks DCEL sharing.

---

## Decision Record

### What we decided
1. Face is not a primary object. It's a consequence of topology.
2. All face-creating tools reduce to LINE + loop synthesis.
3. Solidness is classified, never enforced.
4. Erase is a loop-reshaping operation that triggers re-synthesis.
5. All rules are testable via explicit axioms.

### What we rejected
- **Independent face creation**: Keeping a parallel pipeline for RECT would
  let the two drift again (as observed in the 2026-04-24 debugging session).
- **Constraining merges**: Refusing to merge a surface with a solid
  ("to protect the solid") adds arbitrary friction and conflicts with
  ADR-007's "normals are observed, not constrained" philosophy.
- **Implicit flip on winding mismatch**: User's drawing intent wins (Q12).
  Explicit Shift+N flip is the only orientation-change mechanism.

### Future open questions
- ~~Non-coplanar merge (Axiom 9 last row)~~ — resolved in Phase D via
  soft-edge region: internal edges are hidden (HeFlags::SOFT) but each
  face stays planar. True non-planar face regions remain rejected by
  ADR-007. A future Phase E could add a dedicated "polygon mesh region"
  XIA type for when users want a single logical face over curved terrain.
- Surface face re-classification after Push/Pull: when push/pull creates
  a volume from a surface face, the new boundary faces become "solid".
  Currently inferred from topology; may benefit from explicit cache.

---

*Author*: AXiA development (user principles + Claude implementation) |
*Review*: next Phase B design session
