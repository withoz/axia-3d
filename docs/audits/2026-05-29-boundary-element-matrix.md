# Boundary Element Type Matrix — ADR-169 β-1

**Date**: 2026-05-29
**Author**: WYKO + Claude
**Source**: ADR-169 §3.1 (β-1 deliverable, audit-first canonical 19번째)
**Phase 0 3-agent audit reference**:
- Part 1 (mesh.rs + face_split.rs + create_solid.rs, 130 bail!)
- Part 2 (operations/, 193 bail!)
- Part 3 (curves/ + surfaces/ + scene.rs, 124 bail!)
- 합계 447 bail!/ensure! 분류 매트릭스

---

## 1. Executive Summary

사용자 비전 L-169-2 의 **6 boundary element type** × 4-column gap analysis:

| Type | Status | Phase 1 Target | Phase 2 Target | Phase 3 Target |
|---|---|---|---|---|
| 1. Line | ✅ Partial | normalizeDrawInput | absorb_boundary_input | register(BoundaryElement::Line) |
| 2. Polyline edge | ⚠ Chain raster | normalizeDrawInput per-edge | absorb chain | register(BoundaryElement::Polyline) |
| 3. Arc / Circle edge | ⚠ Self-loop only | normalizeDrawInput | absorb self-loop boundary | register(BoundaryElement::Arc) |
| 4. Bezier / BSpline / NURBS edge | ❌ Excluded | normalizeDrawInput | absorb curve discretize | register(BoundaryElement::Bezier+BSpline+NURBS) |
| 5. Vertex | ⚠ Dedup only | normalizeDrawInput | absorb_vertex (vertex_at silent) | register(BoundaryElement::Vertex) |
| 6. Solid face edge | ❌ Missing | normalizeDrawInput (face ref) | absorb face_edge → BoundaryInput::Line | register(BoundaryElement::FaceEdgeRef) |

**핵심 finding**: 6 type 중 *완전 작동* = 0개. *부분 작동* = 3개 (Line/
Polyline/Arc-Circle). *미참여* = 3개 (Bezier-class/Vertex/Solid face edge).
**Phase 3 Edge Register canonical** 이 6 type 모두 first-class 로 통일.

---

## 2. Per-type detailed analysis

### Type 1 — Line

**현재 routine (today)**:
- Entry: `DrawLineTool.tryFaceSplit` (web/src/tools/DrawLineTool.ts:571)
- Bridge: `WasmBridge.splitFaceByLine` (web/src/bridge/WasmBridge.ts)
- Engine: `Mesh::split_face_by_line` (crates/axia-geo/src/operations/face_split.rs:265)

**Split-participate status**: ✅ 작동, 단 drift / dedup 에 취약

**관련 bail! sites (Phase 0 audit)**:
| File:Line | Error msg | Category | Trigger frequency |
|---|---|---|---|
| `face_split.rs:272` | `line_start must be finite` | A | rare (NaN) |
| `face_split.rs:277` | `line_end must be finite` | A | rare (NaN) |
| `face_split.rs:283` | `line length below EPSILON_LENGTH` | A | **★ HIGH** (mouse drag too small) |
| `face_split.rs:291` | `Face {} not found` | B | medium (stale FaceId) |
| `face_split.rs:418` | `Both split points resolved to same vertex` | A | **★ HIGH** (cardinal snap + drift, LOCKED #41 §A9.8) |
| `face_split.rs:1803` | `Point is X from face plane (max allowed: Y)` | B | **★ CRITICAL** (drift accumulation, 사용자 PR #248 trigger) |
| `mesh.rs:4641` | `Face {} not found` (split_face inner) | B | medium |
| `mesh.rs:4642` | `Cannot split face with same vertex` | A | medium |
| `mesh.rs:4671` | `v1 and v2 are adjacent or equal — degenerate split` | A | **★ CRITICAL** (사용자 시연 trigger 2026-05-29 morning #3) |
| `draw.rs:38` | `line length <ε` (engine-side) | A | high (Tool 호출 결과) |
| `draw.rs:55` | `start/end snap to same vertex` | A | high (LOCKED #5 collapse) |

**Tolerance sources**:
- LOCKED #5 spatial-hash 1.5μm dedup
- LOCKED #63 z=0 invariant (cardinal projection)
- LOCKED #67 ADR-166 plane lock
- LOCKED #69 ADR-168 face plane drift snap (CURRENT FIX for face_split.rs:1803)
- PR #248 TS-side pre-projection (hotfix layer)

**Gap analysis**:
1. **Tool layer fragmentation** — `DrawLineTool.tryFaceSplit` has hotfix-grade pre-projection (PR #248), but DrawLine on sketch plane (not face hit) has different routine. 4 entry points: face hit / sketch plane / ground plane / locked plane.
2. **Engine-side dedup ↔ split mismatch** — LOCKED #5 dedup runs at `add_face_with_holes` boundary, but `split_face` internal does its own vertex matching without spatial-hash consultation → `v1==v2` bail (mesh.rs:4671).
3. **Drift threshold inconsistency** — `face_split.rs:1803` uses face bbox diagonal as `max_plane_dist`, but ADR-168 drift snap (PLANE_SNAP_OFFSET 1e-4 mm) is stricter. Drift accumulated past PLANE_SNAP_OFFSET but within bbox diagonal → bail fires unexpectedly.

**Phase 1 target** (ADR-170): `normalizeDrawInput(rawPoint, { faceId? }) → NormalizedDrawInput` SSOT 가 4 entry point 통일.

**Phase 2 target** (ADR-171): `absorb_boundary_input(mesh, BoundaryInput::Line, face_id)` 가 drift + dedup + 10mm short-circuit 통합 → `face_split.rs:283/418/1803` + `mesh.rs:4671` 4 bail! 자연 흡수.

**Phase 3 target** (ADR-172): `Mesh::register_boundary_element(BoundaryElement::Line)` canonical entry. DrawLineTool.tryFaceSplit 폐기, register API 만 호출.

---

### Type 2 — Polyline edge

**현재 routine**:
- Entry: `DrawRectTool` / `DrawPolygonTool` (firstClick + N-th click)
- Bridge: `WasmBridge.drawRect` / `drawPolyline`
- Engine: `Mesh::add_face_with_holes` (single explicit op auto-face, ADR-139 Q2-a 보존)
- Chain split: `Mesh::split_face_by_chain` (face_split.rs:564) — RECT 내부 split 시 chain 으로 raster

**Split-participate status**: ⚠ Chain raster only. 개별 polyline edge 가
boundary element 로 *직접* 참여 안 함 — chain 으로 변환 후 처리.

**관련 bail! sites**:
| File:Line | Error msg | Category | Trigger |
|---|---|---|---|
| `face_split.rs:574` | `chain needs ≥2 vertices, got N` | A | high (sketch cancel) |
| `face_split.rs:579` | `Face not found` | B | medium |
| `face_split.rs:592` | `face boundary has <3 verts` | A | medium |
| `face_split.rs:645` | `chain endpoints collapsed to same loop vert` | A | high |
| `face_split.rs:650` | `intermediate chain vert on chosen loop` | B | medium (multi-seam) |
| `face_split.rs:663` | `chain endpoints on inner (hole) loop` | B | rare |
| `face_split.rs:674` | `edge between verts missing` | F | rare (caller bug) |
| `face_split.rs:707/708` | `face A/B has <3 verts — degenerate split` | A | medium |
| `face_split.rs:728` | `sub-face boundary has duplicate vertex — chain interacts with hole` | B | medium |
| `draw.rs:74/79` | `rectangle 0-w/0-h` | A | **★ HIGH** (drag preview repeat-fire) |
| `mesh.rs:2955` | `add_face_with_holes ≥3 vertices` | A | **★ HIGH** (polyline cancel) |

**Tolerance sources**:
- LOCKED #5 spatial-hash 1.5μm — chain vertex dedup
- LOCKED #7 ADR-026 P12 — cardinal SSOT (RECT 4 corner)
- LOCKED #41 ADR-101 — coplanar overlap auto-intersect (Sprint S1, default OFF per ADR-139)
- LOCKED #63 z=0 invariant

**Gap analysis**:
1. **Chain raster ≠ Edge register** — RECT 의 4 edge 가 각자 first-class
   boundary element 가 아니라 chain 전체로만 처리. Phase 3 Edge Register
   canonical 에서는 polyline = `BoundaryElement::Polyline { verts: Vec<DVec3> }`
   single API → 내부 자동 edge 분해.
2. **`split_face_by_chain` 의 endpoint dedup 정책** (face_split.rs:645) 가
   ADR-101 auto_intersect_coplanar default OFF 와 충돌 — chain 그릴 때마다
   `add_face_with_holes` 분기, intersection 자동 처리 안 됨.
3. **Hole boundary chain 미지원** (face_split.rs:650/663/728) — Phase 3
   에서 BoundaryElement::Polyline 의 hole interior 지원 명시 필요.

**Phase 1 target**: `normalizeDrawInput` 가 N corner 모두 동일 routine
통과 (cardinal force per-corner, face plane projection per-corner).

**Phase 2 target**: `absorb_boundary_input(mesh, BoundaryInput::Polyline,
face_id)` chain 입력 흡수.

**Phase 3 target**: `register_boundary_element(BoundaryElement::Polyline)`
canonical. RECT/Polygon 도구가 register API 만 호출.

---

### Type 3 — Arc / Circle edge

**현재 routine**:
- Entry: `DrawCircleTool` / `DrawArcTool`
- Bridge: `WasmBridge.drawCircleAsCurve` / `drawArcAsCurve` (kernel-native Path B per ADR-089)
- Engine: `Mesh::add_face_closed_curve` (mesh.rs:3032) — 1 anchor + 1 self-loop edge + `AnalyticCurve::Circle` / `AnalyticCurve::Arc`

**Split-participate status**: ⚠ Self-loop only. Circle 위에 line 그어
face split 시 self-loop 의 N segment 중 어디에 vertex 추가할지 routine
부재.

**관련 bail! sites**:
| File:Line | Error msg | Category | Trigger |
|---|---|---|---|
| `mesh.rs:3032` | `anchor vertex {} is inactive` | C | rare |
| `mesh.rs:3114` | `closed Arc curves deferred to future ADR` | B | medium (DrawArc closed) |
| `mesh.rs:3142` | `curve normal is degenerate` | A | medium (collinear control) |
| `mesh.rs:3308` | `sphere radius must be positive` | A | low (UI guard 통과 후) |
| `draw.rs:139` | `circle radius <ε` | A | **★ HIGH** (drag 0-radius) |
| `coplanar.rs:137` | `faces not coplanar` (Boolean overlap check) | B | high (different plane circles) |

**Tolerance sources**:
- LOCKED #5 spatial-hash 1.5μm — anchor vertex dedup
- LOCKED #7 ADR-026 P12 — cardinal SSOT (center coordinates)
- LOCKED #15 P22.5 owner-ID uniformity — ADR-088 curve_owner_id
- LOCKED #68 ADR-167 EPS_PLANE SSOT — circle plane normal
- LOCKED #69 ADR-168 face plane drift snap — circle face vertex projection
- ADR-089 closed-curve self-loop edge (Path B)

**Gap analysis**:
1. **Self-loop split routine 부재** — Circle 위 line 그어 split 시도 시,
   self-loop edge 를 N segment 로 raster 후 split_face_by_line 호출 →
   `face_split.rs:1803` drift bail 확률 큼 (curve tessellation 의 chord
   error 가 plane offset 으로 가산).
2. **Closed Arc deferred** (mesh.rs:3114) — Phase 3 BoundaryElement::Arc
   에서 명시 지원 (Arc + Circle 통합 처리).
3. **ADR-088 curve_owner_id** — owner ID 는 selection 통일 됐지만 split
   참여 시 N segment 중 어느 segment 가 cut intersection 인지 promote 필요.

**Phase 1 target**: `normalizeDrawInput` 가 Arc/Circle 입력 시 center +
normal + radius 정규화 (drift snap).

**Phase 2 target**: `absorb_boundary_input(mesh, BoundaryInput::Arc {
center, normal, radius, range }, face_id)` 의 chord error 흡수 layer.

**Phase 3 target**: `register_boundary_element(BoundaryElement::Arc {
center, normal, radius, range })` canonical. DrawCircle = range (0, 2π)
의 Arc.

---

### Type 4 — Bezier / BSpline / NURBS edge

**현재 routine**:
- Entry: `DrawBezierTool` / (BSpline/NURBS UI 미정착)
- Bridge: `WasmBridge.drawBezierAsCurve` / `drawClosedBezierAsCurve` (ADR-089 A-ω)
- Engine: `Mesh::add_face_closed_curve` (mesh.rs:3045 Bezier, 3062 BSpline, 3090 NURBS)

**Split-participate status**: ❌ Face split 미참여. NURBS edge 위에 line
그어 split 시도 시 *현재 미지원*.

**관련 bail! sites**:
| File:Line | Error msg | Category | Trigger |
|---|---|---|---|
| `mesh.rs:3045` | `Bezier needs ≥2 control points` | A | medium |
| `mesh.rs:3050` | `Bezier control points not closed` | B | high (DrawBezier open) |
| `mesh.rs:3062` | `BSpline needs ≥2 control points` | A | rare (UI 미정착) |
| `mesh.rs:3074` | `BSpline control points not closed` | B | rare |
| `mesh.rs:3090` | `NURBS needs ≥2 control points` | A | rare |
| `mesh.rs:3102` | `NURBS control points not closed` | B | rare |
| `mesh.rs:7198` | `Bezier needs ≥3 control points` (bezier_best_fit_normal) | A | medium |
| `mesh.rs:7215` | `Bezier control points are collinear` | A | medium |
| `curves/bezier.rs:37` | `evaluate needs ≥1 control point` | A | rare |
| `curves/bspline.rs:338-358` | validate (degree / count / knots) | F | KEEP (Piegl & Tiller) |
| `curves/nurbs.rs:279-307` | validate (degree / weights / knots) | F | KEEP (Piegl & Tiller) |

**Tolerance sources**:
- ADR-027 NURBS Kernel
- ADR-028 Edge curve attach
- ADR-089 Phase 2 closed-curve face (BSpline/NURBS 시민권)
- LOCKED #5 spatial-hash 1.5μm — anchor dedup
- LOCKED #69 ADR-168 face plane drift snap

**Gap analysis**:
1. **Curve-vs-line intersection 미구현** — NURBS edge 와 line 의
   intersection 점 계산 routine 부재. ADR-027 NURBS Kernel 의 SSI
   infrastructure 활용 가능하지만 split_face_by_line 까지 연결 안 됨.
2. **Curve subdivision 후 split** — Phase 3 register API 진입 시 chord
   tessellation → polyline 변환 → polyline split → analytic curve metadata
   sub-curve 로 update routine 필요.
3. **NURBS kernel validate `bail!` 보존 강제** (Part 3 audit finding) —
   curves/bspline.rs / nurbs.rs 의 validate 는 Piegl & Tiller precondition,
   silent-skip 절대 금지. Phase 1 normalizeDrawInput 가 *진입 전* 검증
   해서 validate 가 reachable 한 상태로만 entry 허용.

**Phase 1 target**: `normalizeDrawInput` 가 Bezier/BSpline/NURBS 입력
시 control points + knots + weights 정규화 + degree 검증.

**Phase 2 target**: `absorb_boundary_input(mesh, BoundaryInput::Bezier {
control_pts } | BSpline | NURBS, face_id)` chord tessellation + face
plane drift absorb.

**Phase 3 target**: `register_boundary_element(BoundaryElement::Bezier
| BSpline | NURBS)` canonical with sub-curve metadata propagation on
split.

---

### Type 5 — Vertex

**현재 routine**:
- Entry: `SnapManager.findSnap` (snap target vertex)
- Bridge: `WasmBridge.addVertex` (rare direct entry)
- Engine: `Mesh::add_vertex_with_snap` (spatial hash dedup, LOCKED #5)

**Split-participate status**: ⚠ Spatial hash dedup 작동, 단 vertex 가
*explicit boundary input* 으로 split 에 참여하지 못함.

**관련 bail! sites**:
| File:Line | Error msg | Category | Trigger |
|---|---|---|---|
| `face_split.rs:418` | `Both split points resolved to same vertex` | A | **★ HIGH** (snap collapse) |
| `face_split.rs:645` | `chain endpoints collapsed to same loop vert` | A | high |
| `face_split.rs:1747` | `loop is degenerate` (loop_basis) | A | medium |
| LOCKED #5 spatial-hash dedup at add_vertex_with_snap | — | (silent dedup, not bail) | high |
| ADR-088 curve_owner_id | — | (silent promote) | high |

**Tolerance sources**:
- LOCKED #5 spatial-hash 1.5μm (canonical)
- LOCKED #67 ADR-166 plane lock — vertex on locked plane
- LOCKED #69 ADR-168 face plane drift snap — vertex projected to face plane

**Gap analysis**:
1. **Vertex 는 silent dedup 만, explicit boundary input 아님** — axia-
   sketch pattern 2 (`vertex_at(pos)` silent) 의 *부분 구현*. Phase 3
   register API 에서 vertex = first-class boundary element 로 통일.
2. **Snap collapse → bail** (face_split.rs:418) — snap drift 가 dedup
   tolerance 통과해 다른 vertex 로 collapse → split 의 두 endpoint 가
   같은 vertex → bail. Phase 2 absorb 에서 silent skip 또는 vertex 위
   line 그리는 의도로 해석.
3. **Vertex valence != split contract** — Phase 3 BoundaryElement::Vertex
   추가 시 기존 face 의 boundary loop 에 vertex 만 insert (split 없이)
   하는 routine 정의 필요.

**Phase 1 target**: `normalizeDrawInput` 가 vertex snap 결과 = `Normalized
DrawInput.vertId: Option<VertId>` 으로 promote.

**Phase 2 target**: `absorb_boundary_input(mesh, BoundaryInput::Vertex {
pos } | { vert_id }, face_id)` 가 silent dedup 후 typed return.

**Phase 3 target**: `register_boundary_element(BoundaryElement::Vertex)`
canonical (insert-only, split 없음 — face loop 의 N+1 vertex).

---

### Type 6 — Solid face edge (사용자 선택 edge → Boundary input)

**현재 routine**:
- Entry: 사용자가 SelectTool 로 선택 → ContextMenu / Boundary tool
- Bridge: ❌ No canonical handoff
- Engine: ❌ No canonical entry

**Split-participate status**: ❌ Missing. 사용자가 입체면의 edge 를
선택해서 다른 face split 의 boundary input 으로 사용하려면 manual
copy-construct 필요.

**관련 bail! sites**: (없음 — routine 자체 부재)

**Tolerance sources** (해당 sources 가 *연결* 안 됨):
- LOCKED #15 P22.5 owner-ID uniformity — selection 통일
- ADR-088 curve_owner_id — Arc/Circle/Bezier owner
- ADR-101 Amendment 9 HARD flag — split-induced edge contract

**Gap analysis**:
1. **Edge → BoundaryInput handoff 부재** — 사용자가 선택한 EdgeId 를
   `BoundaryInput::Line { start, end }` 로 자동 변환하는 routine 없음.
   ADR-148 Boundary tool 의 click → boundary 와 동일 패턴으로 selected
   edge → boundary 변환 가능.
2. **Edge type 분기** — selected edge 가 Line / Arc / Circle / Bezier /
   NURBS 인지에 따라 `BoundaryInput::*` 분기 필요. ADR-028 Edge curve
   attach 의 `Edge.curve: Option<AnalyticCurve>` 활용.
3. **Sub-curve metadata propagation** — split 후 sub-edge 가 분할되면
   원본 EdgeId 의 owner_id (ADR-088) 가 sub-edges 에 inherit 되어야 —
   현재 split path 일부만 propagate (ADR-089 A-χ).

**Phase 1 target**: `normalizeDrawInput` 가 face edge 선택 input 도 처리
(SelectionManager → ToolContext → normalizeDrawInput).

**Phase 2 target**: `absorb_boundary_input(mesh, BoundaryInput::EdgeRef {
edge_id }, face_id)` 가 edge type 분기 + analytic curve subdivision.

**Phase 3 target**: `register_boundary_element(BoundaryElement::FaceEdge
Ref { edge_id })` canonical entry. Edge type 자동 분기 (Line/Arc/Bezier/
NURBS). Sub-curve metadata inherit policy (ADR-088 + ADR-089 A-χ 정합).

---

## 3. Cross-cut bail! sites (모든 6 type 통합 영향)

| File:Line | Error msg | Affected types | Phase 2 target |
|---|---|---|---|
| `face_split.rs:1803` | `Point is X from face plane (max Y)` | 1, 2, 3, 4, 6 | absorb_boundary_input Step 1 (drift snap) |
| `mesh.rs:4671` | `v1 and v2 adjacent or equal` | 1, 2, 3, 5 | absorb_boundary_input Step 2 (dedup-aware split decision) |
| `face_split.rs:283` | `line length <ε` | 1, 6 | absorb_boundary_input Step 3 (10mm short-circuit) |
| `face_split.rs:418` | `Both split points same vertex` | 1, 2, 5 | absorb_boundary_input Step 2 (vertex collapse silent skip) |
| `mesh.rs:2955` | `add_face_with_holes ≥3 verts` | 2 | absorb_boundary_input Step 3 (degenerate skip) |
| `coplanar.rs:137/146` | `faces not coplanar` | 1, 2, 3, 4, 6 (Boolean) | absorb_boundary_input Step 1 (face plane unification) |
| `draw.rs:38/55/74/79/139` | engine-side degenerate | 1, 2, 3 | Phase 1 Tool layer 가 진입 전 흡수 (engine 호출 자체 회피) |

**Phase 2 SSOT effect**: `absorb_boundary_input` 단일 entry 가 7+ bail
sites 자연 흡수. user-facing 시연 trigger ~95% 해소 예상.

---

## 4. Tolerance source SSOT 통합 매트릭스

| Tolerance source | Applies to types | Current location | Phase 2 SSOT |
|---|---|---|---|
| LOCKED #5 spatial-hash 1.5μm | 1, 2, 3, 4, 5 (all vertex) | scattered (add_vertex_with_snap) | absorb_boundary_input Step 2 |
| LOCKED #7 ADR-026 P12 cardinal | 1, 2, 3, 4 (all draw) | WasmBridge.drawRect / drawCircle / drawLine | Phase 1 normalizeDrawInput Step 1 |
| LOCKED #15 P22.5 owner-ID | 3, 4, 6 (Arc/Bezier/Edge) | SelectionManager + curve_owner_id | Phase 3 BoundaryElement metadata |
| LOCKED #67 ADR-166 plane lock | 1, 2, 3, 4 (active drawing) | ToolManager._planeLock | Phase 1 normalizeDrawInput Step 5 |
| LOCKED #68 ADR-167 EPS_PLANE | 1, 2, 3, 4, 6 (face plane queries) | axia-geo/src/plane.rs | absorb_boundary_input Step 1 (detection) |
| LOCKED #69 ADR-168 PLANE_SNAP | 1, 2, 3, 4, 6 (face plane correction) | axia-geo/src/operations/plane_snap.rs | absorb_boundary_input Step 1 (correction) |
| LOCKED #63 z=0 invariant | 1, 2, 3, 4 (cardinal draw) | ToolManager.get3DPoint | Phase 1 normalizeDrawInput Step 1 |

**핵심**: 모든 tolerance source 가 *이미 SSOT 형태로 존재*, Phase 1+2 가
*caller side* 에서 통합. Phase 3 가 *engine-side* canonical register API.

---

## 5. NURBS Kernel Carve-out (L-169-11 강제)

Phase 0 Part 3 audit finding canonical:
> "F-category 압도적 (91/124, 73%) — NURBS kernel 의 `bail!` 은 Piegl &
> Tiller 수학적 precondition. silent-skip 시 **silently wrong geometry**
> (incorrect basis, division-by-zero, infinite recursion in de Boor).
> 메타 finding: *silent-skip belongs at scene/CRUD layer, not kernel layer*"

**ADR-169 → Phase 1-4 영역 carve-out**:
- ✅ Phase 1 normalizeDrawInput (`Tool/`) — apply
- ✅ Phase 2 absorb_boundary_input (`operations/`) — apply
- ✅ Phase 3 register_boundary_element (`mesh.rs`) — apply
- ❌ Phase 1-4 **`crates/axia-geo/src/curves/`** — KEEP bail! (Piegl & Tiller)
- ❌ Phase 1-4 **`crates/axia-geo/src/surfaces/`** — KEEP bail! (Piegl & Tiller)
- ⚠ `surfaces/ssi/` — case-by-case (Newton convergence safety net 보존)

Phase 3 BoundaryElement::Bezier/BSpline/NURBS 의 *입력 validate* 는
Phase 1 normalizeDrawInput Step (degree ≥ 1, control points length,
knots monotonic) 에서 처리. validate 통과 후 NURBS kernel 호출 →
kernel bail! 절대 unreachable.

---

## 6. Summary table — 6 type × 4 column

| Type | Today | bail! sites | Tolerance SSOT | Phase 1-3 routine |
|---|---|---|---|---|
| 1. Line | ✅ Partial | 11 (★4 critical) | LOCKED #5/63/67/69 | normalizeDrawInput → absorb_boundary_input(Line) → register(Line) |
| 2. Polyline edge | ⚠ Chain raster | 11 (★3) | LOCKED #5/7/63 | per-corner normalizeDrawInput → absorb(Polyline) → register(Polyline) |
| 3. Arc/Circle | ⚠ Self-loop | 6 (★1) | LOCKED #5/7/15/68/69 + ADR-089 | normalizeDrawInput(curve) → absorb(Arc) → register(Arc) |
| 4. Bezier/BSpline/NURBS | ❌ Excluded | 11 (NURBS kernel KEEP) | ADR-027/028/089 | normalizeDrawInput(curve) → absorb(Bezier|BSpline|NURBS) → register(...) |
| 5. Vertex | ⚠ Silent dedup | 3 (★1) | LOCKED #5/67/69 + ADR-088 | normalizeDrawInput → absorb(Vertex) → register(Vertex insert-only) |
| 6. Solid face edge | ❌ Missing | 0 (routine 없음) | LOCKED #15/ADR-088 + ADR-101 A9 | normalizeDrawInput(EdgeRef) → absorb(EdgeRef→Line/Arc/Bezier) → register(FaceEdgeRef) |

**Phase 1 영향**: 6 type 모두 normalizeDrawInput SSOT 통과 (7 Draw 도구
+ SelectTool + Boundary tool)
**Phase 2 영향**: 6 type 모두 absorb_boundary_input SSOT 통과 (split_
face_by_line + split_face_by_chain + auto_intersect_coplanar + Boundary
tool boundary_from_point)
**Phase 3 영향**: 6 type 모두 register_boundary_element canonical entry
(engine-side single chokepoint, ADR-139 trigger 정책 보존)

---

## 7. Findings → Phase 1-4 scope confirmation

### 7.1 사용자 결재 (D-Then-C) 적합성 검증

| 결재 | 본 audit 적합? |
|---|---|
| (A) Tool-only | ❌ — Type 4 (NURBS) + Type 6 (FaceEdge) routine 자체 부재, Tool layer fix 만으로 80% 도달 불가 |
| (B) Tool + Engine | ⚠ — 6 type 중 5 type cover, 단 Edge Register canonical 없으면 ADR-139 trigger 정책 와 fragmented |
| **(C) Full** | ✅ — Phase 3 Edge Register 가 6 type 통일 anchor, 사용자 비전 정합 |

→ **(C) Full architectural unification** 채택 결재 정합 확인.

### 7.2 Phase 1-4 ADR scope 확정

- **ADR-170 Phase 1** — 6 type × Tool layer normalizeDrawInput
  (Tools.ts 7개 + SelectTool + ContextMenu Boundary)
- **ADR-171 Phase 2** — 6 type × Engine absorb_boundary_input
  (4 split entry + 1 BoundaryTool entry + face_plane SSOT)
- **ADR-172 Phase 3** — 6 type × DCEL register_boundary_element
  (Mesh::register API + BoundaryElement enum + 7 도구 migrate)
- **ADR-173 Phase 4** — 12 사용자 시연 scenario PASS + closure docs

### 7.3 회귀 자산 단조 증가 매트릭스 (재추정)

| Phase | 신규 회귀 (audit refined) | 절대 #[ignore] 금지 |
|---|---|---|
| Phase 1 ADR-170 | +50 (7 도구 × normalizeDrawInput × 6 boundary type partial) | 50/50 |
| Phase 2 ADR-171 | +70 (4 split entry × 6 type) | 70/70 |
| Phase 3 ADR-172 | +90 (Edge Register 6 type × CRUD + split intersect) | 90/90 |
| Phase 4 ADR-173 | +30 (12 시연 scenario × Playwright) | 30/30 |
| **합계** | **+240 회귀** | **240/240** |

(ADR-169 α §6 의 +200~300 추정과 정합, ±20 매트릭스 적용)

---

## 8. Related

### ADR cross-link
- ADR-021 P7 / ADR-025 P11 / ADR-101 (SUPERSEDED by ADR-139, 결과 invariant 보존)
- ADR-027/028/029/030 NURBS Kernel layers
- ADR-064/066 NURBS Boolean DCEL
- ADR-088 curve_owner_id
- ADR-089 Phase 2 closed-curve face (1 anchor + 1 self-loop)
- ADR-101 Amendment 9 HARD flag
- ADR-139 Boundary tool only + 메타-원칙 #16
- ADR-140 surface-aware getDrawPlane
- ADR-148 point-localized BoundaryTool
- ADR-149 T-junction sweep
- ADR-150 Coplanar face merge
- ADR-151 Connected stacked-inner
- ADR-166 plane lock
- ADR-167 EPS_PLANE SSOT
- ADR-168 face plane drift snap
- ADR-169 (본 ADR)

### LOCKED policy cross-link
- LOCKED #1/12/41 (SUPERSEDED, 결과 invariant 보존)
- LOCKED #5 spatial-hash 1.5μm
- LOCKED #7 cardinal SSOT
- LOCKED #14/15/16 메타-원칙 #14/15/16
- LOCKED #43 priority sequence ALL CLOSED
- LOCKED #44 Complete Meaning per Merge
- LOCKED #63 z=0 invariant
- LOCKED #66 STATUS-POLICY
- LOCKED #67/68/69 plane management track

### Phase 0 audit cross-link
- Part 1 (mesh + face_split + create_solid, 130 bail!) — 본 audit Types 1/2/3/4/5 의 절반 cover
- Part 2 (operations, 193 bail!) — 본 audit Types 1/2/3 의 cross-cut sites
- Part 3 (curves + surfaces + scene, 124 bail!) — 본 audit Type 4 NURBS kernel carve-out source
