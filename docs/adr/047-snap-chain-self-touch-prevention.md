# ADR-047 — Snap Chain Self-Touch Prevention (P32)

**Status**: Accepted
**Date**: 2026-05-02
**Anchor ADRs**: ADR-019 (Line is Truth), ADR-021 (Closed Edge Loop Divides
Face), ADR-046 P31 (Pillar 2 — Precision Visibility)

## Context

While auditing snap behavior against another engine's bug report, the AxiA
SnapManager surface was found to lack any chain-awareness:

```
SnapManager.findSnap(mouseX, mouseY, camera, canvas, groundPoint?, faceHitPoint?)
```

No `chain` / `pending` / `excludeVertices` parameter. The active tool's
in-progress chain points are NOT communicated to the snap engine, so they
are valid endpoint-snap candidates like any other vertex.

This produces a silent failure mode in DrawLine polyline mode:

```
Click 1: P0 → P1   (chainStart, chainPoints = [P0])
Click 2: P1 → P2   (chainPoints = [P0, P1])
Click 3: P2 → P3   (chainPoints = [P0, P1, P2])
Mousemove near P1 → SnapManager pulls cursor onto P1
Click 4: → snaps to P1
                  → chain becomes [P0, P1, P2, P1, …]
                  → vertex P1 appears twice in the same chain
                  → face_split.rs:662 has_dup_a/has_dup_b → bail!
                  → user: "면이 안 만들어지는데?"
```

The engine *correctly* refuses self-intersecting boundaries (ADR-019/021
remain valid). The problem is at the **enforcement layer**: snap should
prevent the user from creating a self-touching chain in the first place.

## Decision

**P32 — Chain-Aware Snap Exclusion**

The active tool exposes its pending vertices via an optional ITool method
`getExcludedSnapPoints(): Vector3[]`. ToolManager calls this before each
`findSnap` and forwards the result via `SnapManager.setExcludePositions(...)`.
SnapManager filters endpoint and nearest-endpoint candidates within
ε = 1.5μm (LOCKED #5 spatial-hash dedup tolerance) of any excluded point.

### Semantics

| Mode | Snappable vertices |
|------|---------------------|
| Chain in progress (DrawLine) | all − `chainPoints[1..]` (chainStart kept) |
| Polygon pending | all − `pending[1..]` |
| No chain | all (default) |

Critical: **chainStart is never excluded** — snapping back to the start is
the user's primary close gesture (loopClose, highest priority).

### Why position-based, not VertId-based

SnapManager's vertex cache is `Vector3[]`, not vertex-IDed. Position-based
exclusion with 1.5μm tolerance matches the engine's own dedup tolerance
(LOCKED #5) and avoids surface-area churn (no vertex ID plumbing through
SnapManager / SnapVisual / ToolContext).

## P32 Invariants

1. **chainStart remains snappable** — close-loop gesture must work even
   while mid-waypoints are excluded.
2. **External vertices are never excluded** — only the active tool's
   pending chain affects exclusion.
3. **Cleared on chain end** — DrawLineTool returning to Idle/Armed empties
   `chainPoints` → `getExcludedSnapPoints()` returns `[]`.
4. **`findNearestEndpoint` honors exclusion** — the always-on inference
   fallback must not re-introduce the excluded vertices.
5. **No SnapManager.findSnap signature change** — exclusion is configured
   out-of-band via `setExcludePositions`. All 33+ existing callers untouched.
6. **Tolerance matches engine dedup** — `EXCLUDE_TOL_SQ = (1.5e-3)²` mm²
   (LOCKED #5 SSOT).

## P32 Regression Tests (절대 #[ignore] 금지)

`web/src/snap/SnapManager.exclude.test.ts`:
1. `chain_vertex_excluded_from_snap_during_polyline`
2. `chain_start_remains_snappable_for_close`
3. `external_vertex_not_excluded_by_active_chain`
4. `clearing_exclude_list_restores_snap`
5. `findNearestEndpoint_also_respects_exclude`
6. `snap_excluded_falls_back_to_grid_or_ground` — guards against the
   "snap broke at this vertex" failure mode where filtering the top
   candidate accidentally drops all lower-priority candidates too.

`web/src/tools/DrawLineTool.test.ts > getExcludedSnapPoints (ADR-047 P32)`:
1. returns empty when no chain is active
2. returns empty for a fresh chain with only chainStart
3. excludes mid-waypoints but NOT chainStart after multiple clicks
4. returns clones (mutating result must not affect chain state)

## Why this is not an ADR-019/021 amendment

ADR-019 P4 ("같은 face boundary 위 양 endpoint" implicit assumption) and
ADR-021 P7 ("닫힌 라인 → 면") policies are unchanged. The duplicate-vertex
`bail!` in `face_split.rs` is correct engine defense and stays.

This ADR adds an **enforcement layer** at the input boundary so users
can't reach the bail-out by accident. Engine-side defense remains as a
last-resort safety net (ADR-019/021 invariants intact).

## Implementation Files

- `web/src/snap/SnapManager.ts` — `setExcludePositions`, `isPositionExcluded`,
  endpoint and nearest-endpoint filter hooks
- `web/src/tools/ITool.ts` — optional `getExcludedSnapPoints?(): Vector3[]`
- `web/src/tools/DrawLineTool.ts` — implementation returning
  `chainPoints.slice(1)`
- `web/src/tools/ToolManagerRefactored.ts` — wires
  `activeTool.getExcludedSnapPoints?()` into `setExcludePositions` per
  `getSnappedPoint` call

## Future-proofing

### Adoption

Adopt `getExcludedSnapPoints` in any tool that maintains chain state:
- DrawPolygonTool (pending corners)
- DrawFreehandTool (sampled trail)
- DrawBezierTool (control points already committed)
- Future SketchSession multi-line tools

Each tool decides its own exclusion list — SnapManager is policy-agnostic.

### Engine error refinement (separate PR)

`crates/axia-geo/src/operations/face_split.rs` currently fails the
duplicate-vertex case with a generic `bail!("sub-face boundary has
duplicate vertex…")`. With the P32 input-layer guard in place this
codepath is now **unreachable in normal user flow** — but it remains the
last-resort safety net for programmatic callers (MCP, scripts, future
import paths).

Recommended follow-up: replace the generic bail with a typed
`MeshOpError::DuplicateVertexInBoundary { face_id, dup_vert }` so
TypeScript can render a friendly Toast ("자기 자신을 통과하는 chain 입니다
— 다른 vertex 를 클릭해주세요") instead of surfacing the engine string.

Out of P32's scope (this ADR is the input-layer fix). Tracked separately
to keep PRs single-purpose.

### Fallback semantics (regression test 6)

When the excluded vertex was the highest-priority candidate, snap MUST
fall through to lower-priority candidates (grid / onFace / nearest /
ground) rather than silently returning `null`. A null result at a
location where the user expects a snap target reads as "snap broke" —
worse UX than the original bug. Guarded by
`snap_excluded_falls_back_to_grid_or_ground`.

## Anchor to ADR-046 P31

Pillar 2 — *Precision Visibility*: snapping must be *predictable*. A snap
that pulls onto a vertex you're currently using to define the geometry
violates predictability ("왜 면이 안 만들어지지?" is a precision-visibility
failure dressed up as an engine error). P32 is the missing rule for the
pillar.
