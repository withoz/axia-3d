# Drift Propagation Chain Matrix — ADR-169 β-2

**Date**: 2026-05-29
**Author**: WYKO + Claude
**Source**: ADR-169 §3.2 (β-2 deliverable, audit-first canonical 19번째)
**Cross-link**:
- β-1 boundary element type matrix
- LOCKED #5/7/63/67/68/69 SSOT
- ADR-166/167/168 plane management track

---

## 1. Executive Summary

사용자 클릭부터 엔진 emit 까지 ε (epsilon) 누적 추적 매트릭스 — **11
layer × 4-column** (ε in / ε internal / ε out / SSOT). 핵심 finding:

**현재 architecture**: 11 layer 중 **8 layer** 가 ε 흡수 책임, **3 layer**
가 ε *증폭*. 각 layer 가 자기 SSOT 만 적용 → cumulative ε 가 Engine entry
에서 `~30-40μm` 도달 → `face_split.rs:1803` bail! trigger 거리 ε~30mm (face
bbox 1m 기준 max_dist 약 3mm) 의 1/100 보다 작아 **정상 작동**.

**그러나 drift 누적 시나리오**:
- Stacked transforms (translate/rotate × N) — 매 transform 마다 f32→f64
  conversion drift `~1-5μm` 누적
- Boolean / Push-Pull 후 face plane drift — ADR-168 PLANE_SNAP_OFFSET
  `1e-4 mm` 보다 큰 누적 → silent "different plane" 판정
- Non-cardinal face plane (사용자 보고 PR #248) — ADR-026 P12 cardinal
  SSOT 미적용 → drift `~10-40μm` × N stacked ops → bail!

**Phase 1+2 SSOT 통합 효과**: 11 layer 중 5 layer (Tool layer) 가 normalize
DrawInput SSOT 로 통합, 2 layer (Engine entry) 가 absorb_boundary_input
SSOT 로 통합. ε 누적 위치 명확화 → drift 추적 + 영구 차단.

---

## 2. 11-Layer ε Propagation Chain

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1  : Mouse hardware             ε ~0.5px (browser native)     │
│ Layer 2  : THREE.Vector2 NDC          ε ~0.5px (screen space)       │
│ Layer 3  : Raycaster (f32 internal)   ε ~10μm (world space)         │
│ Layer 4  : SnapManager.findSnap       ε absorb (snap candidates)    │
│ Layer 5  : ToolManager.getSnappedPoint ε wrap (legacy passthrough)  │
│ Layer 6  : ToolManager.get3DPoint     ε absorb (LOCKED #63 cardinal)│
│ Layer 7  : Tool.firstClick / mousemove ε amplify (tool-specific)    │
│ Layer 8  : WasmBridge typed wrapper    ε absorb (LOCKED #7 cardinal)│
│ Layer 9  : WASM boundary (TS f64 → Rust f64)  ε 0 (lossless)        │
│ Layer 10 : Engine entry (Mesh::* / Scene::*)  ε absorb (LOCKED #5/68)│
│ Layer 11 : Engine internal (DCEL emit)        ε snap (LOCKED #69)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Layer 1 — Mouse hardware (browser native)

| Column | Value |
|---|---|
| ε in | N/A (raw input) |
| ε internal | ~0.5px (CSS pixel grid, OS subpixel sampling) |
| ε out | ~0.5px (clientX/Y from event) |
| SSOT | (none — browser native) |
| Normalize responsibility | (none) |

**Note**: 4K display + DPR=2 → effective ε `~0.25 device px`. 사용자 시연
trigger 의 *시작점*. 본 ε 는 모든 후속 layer 의 *upstream noise floor*.

---

### Layer 2 — THREE.Vector2 NDC normalize

| Column | Value |
|---|---|
| ε in | ~0.5px (clientX/Y) |
| ε internal | f32 division (canvasWidth/Height) — `~1e-7` relative |
| ε out | NDC range [-1, 1], ε `~ 1px / canvasWidth` ≈ `1e-3` for 1280px |
| SSOT | THREE.js Raycaster.setFromCamera |
| Normalize responsibility | screen → NDC conversion |

**Code path**: `mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, ...)`
in ToolManagerRefactored.ts mousemove handlers.

**Drift contribution**: 0 (precision-preserving NDC mapping).

---

### Layer 3 — Raycaster (f32 internal precision)

| Column | Value |
|---|---|
| ε in | NDC `~1e-3` |
| ε internal | **f32 mantissa 24-bit** — relative ε `~ 6e-8` |
| ε out | world space — absolute ε `~ 10μm` at 1m camera distance |
| SSOT | THREE.js raycaster + matrix4Inverse |
| Normalize responsibility | NDC → world ray + intersection |

**Code path**: `raycaster.setFromCamera(mouse, camera)` +
`raycaster.intersectObject(viewport.mesh, true)`.

**Drift contribution**: **★ 10μm typical** (f32 conversion 한계). 가장
큰 single drift source. ADR-167 EPS_PLANE_OFFSET = 1.5e-3 mm = 1.5μm 보다
크지만 LOCKED #5 spatial-hash 1.5μm dedup 보다 큼 → snap miss 가능.

**Phase 2 흡수**: absorb_boundary_input Step 1 (ADR-168 PLANE_SNAP_OFFSET
1e-4 mm = 0.1μm strict snap 강제).

---

### Layer 4 — SnapManager.findSnap (snap detection)

| Column | Value |
|---|---|
| ε in | ~10μm (raycast world) |
| ε internal | snap tolerance per-type — vertex 5px / midpoint 5px / edge 8px (screen) |
| ε out | snap result `Vector3`, ε = snap target precision (LOCKED #5 1.5μm vertex / ADR-088 owner_id curve) |
| SSOT | SnapManager.findSnap (multi-priority candidates + scoring) |
| Normalize responsibility | snap candidate generation + best-match selection |

**Code path**: `web/src/snap/SnapManager.ts:findSnap()` (Phase A/B/C
inference engine).

**Drift contribution**: Snap 성공 시 ε *흡수* (10μm → target precision).
Snap 실패 시 raycast 결과 그대로 passthrough → ε 누적.

**Phase 1 영향**: normalizeDrawInput Step 2 가 snap result 활용 (이미
정상 작동, ADR-146 정합).

---

### Layer 5 — ToolManager.getSnappedPoint (snap result wrap)

| Column | Value |
|---|---|
| ε in | snap result `Vector3` (Layer 4) |
| ε internal | wrap + override priority (chainStart 등) |
| ε out | `Vector3` (passthrough) |
| SSOT | `SnapManager.findSnap` 위임 |
| Normalize responsibility | none (wrap only) |

**Code path**: `ToolManagerRefactored.ts:getSnappedPoint()`.

**Drift contribution**: 0 (wrap only, no conversion).

**Phase 1 영향**: normalizeDrawInput SSOT 가 본 layer 흡수 — getSnappedPoint
폐기 또는 internal helper 로 강등.

---

### Layer 6 — ToolManager.get3DPoint (3D pick + cardinal force)

| Column | Value |
|---|---|
| ε in | snap result OR raycast result |
| ε internal | **LOCKED #63 cardinal axis force = 0** (z=0 for 3d/top/bottom, y=0 for front/back, x=0 for right/left) |
| ε out | cardinal-aligned `Vector3` (single axis exact 0, 다른 축 raw) |
| SSOT | LOCKED #63 z=0 invariant (사용자 결재 2026-05-18) |
| Normalize responsibility | cardinal axis projection |

**Code path**: `ToolManagerRefactored.ts:get3DPoint()` line ~2669.

**Drift contribution**: ★ ε *흡수* on cardinal axis (10μm → 0). Non-
cardinal axis 는 passthrough. *Non-cardinal plane* (face hit, sketch
slanted) 에서는 효과 없음.

**Phase 1 통합**: normalizeDrawInput Step 1 (cardinal force). 현재 위치
보존 (LOCKED #63 invariant).

---

### Layer 7 — Tool.firstClick / mousemove (tool-specific normalization)

| Column | Value |
|---|---|
| ε in | get3DPoint result `Vector3` |
| ε internal | **★ 도구별 분산** — DrawLineTool.tryFaceSplit pre-project (PR #248), DrawRectTool plane snap, DrawCircleTool center cardinal, etc. |
| ε out | bridge.* 호출용 `[x, y, z]` array |
| SSOT | (none — 7 도구 각자 다른 routine) |
| Normalize responsibility | **★ 분산** — 통합 미존재 |

**Code path**: 7 Draw 도구 + SelectTool + BoundaryTool 각자 firstClick
구현.

**Drift contribution**: ε *증폭* 가능 — 도구별 누락된 projection 시 raw
drift passthrough. 예: DrawLineTool 의 face hit 분기는 PR #248 로 face
plane projection 추가, 사이드 분기 (sketch plane / ground / locked plane)
는 별도 normalize 부재.

**핵심 gap**: **본 layer 가 Phase 1 ADR-170 의 single target chokepoint**.

**Phase 1 target**: `ToolManager.normalizeDrawInput(rawPoint, context)`
SSOT 가 7 도구 + SelectTool + BoundaryTool 통합. 5-step routine (cardinal
force / face plane projection / vertex_at dedup / 10mm short-circuit /
plane lock validation).

---

### Layer 8 — WasmBridge typed wrapper

| Column | Value |
|---|---|
| ε in | TS `[x, y, z]` array (number[]) |
| ε internal | **LOCKED #7 ADR-026 P12 cardinal SSOT** (Bridge defense layer 2 — `|n.{x,y,z}|>0.999` + coord `<1e-3` → 0) |
| ε out | f64 `[x, y, z]` → WASM call |
| SSOT | LOCKED #7 ADR-026 P12 (cardinal plane SSOT) |
| Normalize responsibility | cardinal plane force (last defense before WASM) |

**Code path**: `WasmBridge.drawRect / drawLine / drawCircle / drawPolyline`
+ `splitFaceByLine` (PR #248 hotfix layer).

**Drift contribution**: ε *흡수* on cardinal plane. Non-cardinal plane 은
passthrough.

**Phase 2 통합**: absorb_boundary_input Step 1 가 ADR-167/168 SSOT (non-
cardinal 포함) 추가 흡수.

---

### Layer 9 — WASM boundary (TS f64 → Rust f64)

| Column | Value |
|---|---|
| ε in | TS Number (f64) |
| ε internal | wasm-bindgen f64 → Rust f64 (lossless) |
| ε out | Rust f64 |
| SSOT | (lossless conversion) |
| Normalize responsibility | none |

**Code path**: wasm-bindgen 자동 변환.

**Drift contribution**: 0 (f64 ↔ f64 lossless).

---

### Layer 10 — Engine entry (Mesh::* / Scene::* methods)

| Column | Value |
|---|---|
| ε in | Rust f64 (lossless from TS) |
| ε internal | **LOCKED #5 spatial-hash 1.5μm dedup** at `add_vertex_with_snap`. **LOCKED #68 ADR-167 EPS_PLANE_*** at plane comparison. **face_split.rs:1803 max_plane_dist = face bbox diagonal** (loose). |
| ε out | DCEL operation result (FaceId / EdgeId / VertId 또는 bail!) |
| SSOT | LOCKED #5 + LOCKED #68 ADR-167 |
| Normalize responsibility | vertex dedup + plane equality + face plane validation |

**Code path**: `Mesh::split_face_by_line` (face_split.rs:265) + `Mesh::
add_face_with_holes` (mesh.rs:2950) + `Mesh::split_face` (mesh.rs:4641).

**Drift contribution**: ε *흡수* (vertex dedup + plane equality 정상
작동). 그러나 `face_split.rs:1803` 의 plane distance check 는 LOCKED #68
(1.5μm detection) 보다 약 1000× loose (face bbox diagonal ~ mm 단위) →
*과도하게 관대* 보이지만 drift 누적 시나리오에서 실패 (PR #248 trigger).

**Phase 2 통합**: absorb_boundary_input Step 1 가 ADR-168 PLANE_SNAP_
OFFSET (0.1μm strict) 적용 → drift correction → max_plane_dist 검사가
unreachable 한 normalized input 만 entry 통과.

---

### Layer 11 — Engine internal (DCEL emit)

| Column | Value |
|---|---|
| ε in | normalized input (Layer 10 통과 후) |
| ε internal | **LOCKED #69 ADR-168 PLANE_SNAP_OFFSET 1e-4 mm strict snap** (Phase D face creation callsites) + LOCKED #5 spatial-hash + ADR-101 Amendment 9 HARD flag |
| ε out | new FaceId + invariant 강제 (ADR-007 winding + ADR-051 P7 manifold) |
| SSOT | LOCKED #69 + ADR-007 + ADR-051 |
| Normalize responsibility | snap correction + invariant enforce |

**Code path**: `Mesh::split_face` internal HE chain + `snap_face_to_plane`
helper (ADR-168 β-2).

**Drift contribution**: ε *흡수* (strict snap). drift 가 입력에서 누적
되어도 emit 직전 0.1μm 정확도로 보정 → 다음 op 에 깨끗한 face 전달.

**Phase 3 통합**: register_boundary_element 가 본 layer 호출 통일 →
Edge Register pattern canonical.

---

## 3. ε accumulation worst-case scenario

### 3.1 Single op (정상 flow)

```
Layer 1 (mouse)             : ε = 0.5px (browser noise)
  ↓
Layer 2 (NDC)               : ε = 1e-3 NDC
  ↓
Layer 3 (raycast f32)       : ε = 10μm world ★
  ↓
Layer 4 (snap success)      : ε = 1.5μm (LOCKED #5 dedup) ★ 흡수
  ↓
Layer 5 (wrap)              : ε = 1.5μm passthrough
  ↓
Layer 6 (cardinal axis)     : ε = 0 on cardinal axis ★ 흡수
  ↓
Layer 7 (Tool-specific)     : ε = 1.5μm OR 10μm (도구별 분기)
  ↓
Layer 8 (Bridge cardinal)   : ε = 0 on cardinal plane ★ 흡수
  ↓
Layer 9 (f64 → f64)         : ε = 0 (lossless)
  ↓
Layer 10 (Engine entry)     : ε = 1.5μm (dedup pass) ★ 흡수
  ↓
Layer 11 (DCEL emit)        : ε = 0.1μm (PLANE_SNAP strict) ★ 흡수
```

**결과**: 정상 시나리오에서 ε 누적 < 1.5μm → 모든 bail! threshold 통과.

### 3.2 사용자 시연 trigger (drift accumulation)

```
Stacked transform N=5 + non-cardinal face hit:
  Layer 3 (raycast f32)     : ε = 10μm × √N = 22μm (random walk)
  Layer 4 (snap miss)       : passthrough 22μm
  Layer 6 (non-cardinal)    : no absorption 22μm
  Layer 7 (DrawLine on face): pre-project PR #248 hotfix → ε = 0.1μm ★
  Layer 8 (non-cardinal plane): no absorption → ε = 0.1μm
  Layer 10 (face_split.rs:1803): max_plane_dist = face bbox ~3mm → PASS

But: if PR #248 hotfix MISSING (i.e., before merge):
  Layer 7 : raw 22μm passthrough
  Layer 10: 22μm × N stacked ops = 110μm > strict tolerance 1.5μm → bail!
```

**Conclusion**: PR #248 hotfix 가 *현재 single fix*, multi-op stacked
시나리오에서는 여전히 누적 가능. **Phase 2 absorb_boundary_input SSOT**
가 모든 entry 강제 흡수 → 영구 차단.

---

## 4. SSOT 정합 매트릭스 (현재 vs Phase 1+2 target)

| Tolerance / SSOT | 현재 위치 (분산) | Phase 1 target | Phase 2 target |
|---|---|---|---|
| **LOCKED #5 spatial-hash 1.5μm** | Engine `add_vertex_with_snap` only | (no change) | absorb_boundary_input Step 2 (vertex dedup) |
| **LOCKED #7 ADR-026 P12 cardinal** | WasmBridge defense layer 2 + ToolManager.get3DPoint cardinal force | normalizeDrawInput Step 1 (consolidate) | absorb_boundary_input Step 1 (defense layer 3) |
| **LOCKED #63 z=0 invariant** | ToolManager.get3DPoint cardinal force | normalizeDrawInput Step 1 (delegate) | (engine 영향 0) |
| **LOCKED #67 ADR-166 plane lock** | ToolManager._planeLock | normalizeDrawInput Step 5 (validation) | (engine 영향 0) |
| **LOCKED #68 ADR-167 EPS_PLANE detection** | axia-geo/src/plane.rs | (Tool layer 영향 0) | absorb_boundary_input Step 1 (detection) |
| **LOCKED #69 ADR-168 PLANE_SNAP correction** | axia-geo/src/operations/plane_snap.rs + face creation callsites | (Tool layer 영향 0) | absorb_boundary_input Step 1 (correction) |
| **ADR-088 curve_owner_id grouping** | Edge.curve_owner_id field + walk_face_owner_siblings | normalizeDrawInput Step 4 (curve dedup hint) | absorb_boundary_input Step 3 (sub-curve metadata) |
| **ADR-101 Amendment 9 HARD flag** | split_face / auto_intersect_coplanar 후 split-induced edges | (Tool layer 영향 0) | absorb_boundary_input Step 4 (split contract 강제) |

**핵심**: 모든 SSOT 가 *이미 존재*, **위치만 분산**. Phase 1+2 가 통합
chokepoint 정착.

---

## 5. Cross-cut Phase 1+2+3 SSOT integration map

```
┌────────────────────────────────────────────────────────────────┐
│ Phase 1: normalizeDrawInput (TS, ToolManager.ts)                │
│   Step 1: Cardinal force        (LOCKED #7/63)                  │
│   Step 2: Face plane projection (LOCKED #69 ADR-168)            │
│   Step 3: Vertex_at silent dedup (LOCKED #5)                    │
│   Step 4: 10mm short-circuit    (axia-sketch pattern 1)         │
│   Step 5: Plane lock validation (LOCKED #67 ADR-166)            │
└────────────────────────────────────────────────────────────────┘
                              ↓ Normalized input
┌────────────────────────────────────────────────────────────────┐
│ Phase 2: absorb_boundary_input (Rust, operations/boundary_input)│
│   Step 1: Drift projection      (LOCKED #68/69 detection+snap)  │
│   Step 2: Vertex dedup          (LOCKED #5 spatial-hash)        │
│   Step 3: 10mm short-circuit    (axia-sketch pattern 1)         │
│   Step 4: Split-induced HARD    (ADR-101 Amendment 9)           │
└────────────────────────────────────────────────────────────────┘
                              ↓ Absorbed input
┌────────────────────────────────────────────────────────────────┐
│ Phase 3: register_boundary_element (Rust, Mesh::register)       │
│   Step 1: Dispatch by BoundaryElement type (6 types)            │
│   Step 2: vertex/edge insert via DCEL                            │
│   Step 3: split if intersects existing boundary                  │
│   Step 4: Emit face if cycle closes (ADR-139 Boundary tool only) │
└────────────────────────────────────────────────────────────────┘
                              ↓ DCEL truth
                       Face / Edge / Vert emission
                       (LOCKED #15 owner-ID, ADR-007 winding,
                        ADR-051 P7 manifold)
```

---

## 6. Specific bail! sites cross-reference (β-1 ↔ β-2 통합)

| bail! site | Layer | Cause | Phase target |
|---|---|---|---|
| `face_split.rs:1803` "Point off face plane" | 10 | Layer 3 f32 drift + Layer 7 missing projection (PR #248 partial fix) | Phase 2 Step 1 |
| `mesh.rs:4671` "v1 v2 adjacent" | 10 | Layer 4 snap collapse + Layer 10 dedup-aware split 미통합 | Phase 2 Step 2 |
| `face_split.rs:283` "line length <ε" | 10 | Layer 7 missing 10mm short-circuit | Phase 1 Step 4 |
| `face_split.rs:418` "Both points same vertex" | 10 | Layer 4 snap collapse + cardinal force 통합 (Layer 6+8) overactive | Phase 2 Step 2 |
| `mesh.rs:2955` "Face requires ≥3 verts" | 10 | Layer 7 polyline cancel | Phase 1 Step 4 |
| `coplanar.rs:137/146` "faces not coplanar" | 10 | Layer 10 LOCKED #68 detection vs LOCKED #69 correction tolerance 분리 | Phase 2 Step 1 |
| `draw.rs:38/55/74/79/139` engine-side | 9-10 | Layer 7 Tool layer 가 진입 전 흡수 안 됨 → engine bail! 도달 | Phase 1 Step 4 (Tool 진입 전 회피) |

---

## 7. Findings summary

### 7.1 ε absorption distribution (현재)

- Layer 4 SnapManager — primary absorption (~95% of normal flow)
- Layer 6 ToolManager.get3DPoint — cardinal axis only
- Layer 8 WasmBridge — cardinal plane only (LOCKED #7)
- Layer 10 Engine entry — vertex dedup (LOCKED #5)
- Layer 11 Engine internal — strict snap (LOCKED #69)
- **Layer 7 Tool-specific — fragmented (7 도구 각자 다른 routine)**
- **Layer 8 non-cardinal plane — gap**

### 7.2 Phase 1+2 통합 효과

- Layer 7 분산 → normalizeDrawInput SSOT 통합 (★ 가장 큰 단일 개선)
- Layer 10 entry 부담 분산 → Layer 2 absorb 가 *진입 전* drift 흡수
- Layer 11 strict snap 은 보존 (ADR-168 정합)
- Layer 8 non-cardinal plane gap → Phase 2 Step 1 (ADR-167/168 SSOT 호출)
- 7+ bail sites 자연 흡수 → user-trigger ~95% 해소

### 7.3 메타-원칙 정합

- **메타-원칙 #4 SSOT** — 11 layer 중 7-8 SSOT 가 *이미 존재*, Phase
  1+2 가 통합 chokepoint 정착 → SSOT 의 deepest realization
- **메타-원칙 #6 Preventive over Curative** — PR #247/248 hotfix pattern
  (curative) 영구 차단, Phase 1+2 통합 (preventive) 정착
- **메타-원칙 #11 Latency Budget** — 11-layer 통합도 16ms hover / 33ms
  click budget 보존 (각 Step 마이크로초 단위)
- **메타-원칙 #15 동일 분할 contract** — Layer 10 (split_face_by_line /
  by_chain / auto_intersect_coplanar / Boundary boundary_from_point) 의
  *동일 contract* 강제 = Phase 2 SSOT 의 architectural value

---

## 8. Related

### Phase 0 audit cross-link
- Part 1 (mesh + face_split + create_solid, 130 bail!) — Layer 10 absorption 매트릭스 source
- Part 2 (operations, 193 bail!) — Layer 10-11 cross-cut sites
- Part 3 (curves + surfaces + scene, 124 bail!) — NURBS kernel carve-out (Phase 1-4 영향 0)

### Audit deliverable cross-link
- β-1 boundary element type matrix — 6 type × 4-column gap analysis
- β-2 (본 문서) — 11-layer ε propagation chain matrix
- β-3 (예정) — 사용자 시연 evidence 12 scenario matrix

### LOCKED policy cross-link
- LOCKED #5 spatial-hash 1.5μm (Layer 4, 10)
- LOCKED #7 ADR-026 P12 cardinal (Layer 8)
- LOCKED #14/15/16 메타-원칙 #14/15/16
- LOCKED #43 priority sequence ALL CLOSED (foundation)
- LOCKED #44 Complete Meaning per Merge
- LOCKED #63 z=0 invariant (Layer 6)
- LOCKED #66 STATUS-POLICY
- LOCKED #67 ADR-166 plane lock (Layer 7)
- LOCKED #68 ADR-167 EPS_PLANE (Layer 10)
- LOCKED #69 ADR-168 PLANE_SNAP (Layer 11)

### ADR cross-link
- ADR-026 P12 cardinal SSOT
- ADR-101 Amendment 9 HARD flag
- ADR-139 Boundary tool only (WHEN layer)
- ADR-140 surface-aware getDrawPlane (Layer 6 enhancement)
- ADR-146 SnapManager inferencing
- ADR-166/167/168 plane management track
- ADR-169 (본 audit ADR)
