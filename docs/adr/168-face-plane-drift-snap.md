# ADR-168 — Face plane drift snap (ADR-167 자연 후속)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-29
**Author**: WYKO + Claude
**Trigger**: ADR-167 §5.1 sequence anchor + LOCKED #43 priority sequence
(a)→(b)→(c) 결재. ADR-167 closure (LOCKED #68) 후 자연 진입.
**Audit precondition**: audit-first canonical 18번째 적용. ADR-026 P12
(Bridge SSOT cardinal plane) 가 cardinal axis (X/Y/Z normal) 만 강제 →
non-cardinal face plane (사용자 face hit drag, sketch slanted plane,
imported BRep tilted face) 의 drift 보정 없음 → DCEL "다른 plane" 판정
silent bug.
**Direct predecessor**:
- ADR-167 §5.1 (sequence anchor 명시) — 직계 source, EPS_PLANE_* SSOT 위
  stricter snap layer 의 자연 layered architecture
- ADR-026 P12 (Cardinal plane SSOT, WasmBridge defense layer 2) — 보존
- ADR-031 Phase D (AnalyticSurface infra) — tessellation chord substitute
  자산 재사용
- ADR-101 Amendment 9 (split-induced edge HARD flag) — face split 정합 source
**Sprint scope**: ADR-141 §3 외부 트랙 (Plane Management Track 5,
LOCKED #43 priority sequence c).

## Canonical anchor

ADR-026 P12 (WasmBridge cardinal plane SSOT) 가 normal cardinal axis
(|n.{x|y|z}|>0.999) 의 coord drift 만 강제 0. *non-cardinal* face plane
(사용자가 다른 plane 위 face 위에서 drag 한 경우, sketch slanted plane,
imported BRep tilted face) 의 drift 는 보정 없음 → DCEL "다른 plane"
판정 silent bug risk.

ADR-167 EPS_PLANE_* SSOT 위 *stricter snap layer* — detection tolerance
(EPS_PLANE_NORMAL = 1e-4) 보다 *strict 하게* drift correction (PLANE_SNAP_
NORMAL = 1e-3 mm) 적용. *layered architecture* — ADR-167 detection vs
ADR-168 snap의 자연 hierarchy.

## 1. Problem statement

### 1.1 ADR-026 P12 cardinal SSOT 의 architectural gap

ADR-026 P12 LOCKED #7:
> Normal 이 cardinal axis (`|n.{x|y|z}|>0.999`) + 좌표가 sub-tol (`<1e-3`)
> 이면 정확히 0 으로 강제

→ **non-cardinal face plane** (`|n.{x|y|z}| < 0.999` for all axes) 는
보정 없음.

| Scenario | 현재 동작 | drift risk |
|---|---|---|
| User Sketch on XY ground | ADR-026 P12 z=0 강제 ✅ | 0 |
| User RECT on XZ wall (front view) | ADR-026 P12 y=0 강제 ✅ | 0 |
| User Sketch slanted (e.g. roof slope 30°) | 강제 없음 ⚠ | f32 ray-plane drift ~10μm |
| User RECT on imported BRep tilted face | 강제 없음 ⚠ | f32 drift + import precision drift |
| Boolean intersection on coplanar tilted faces | 강제 없음 ⚠ | drift accumulation |

### 1.2 사용자 silent bug evidence (potential, deferred until β-3 telemetry)

DCEL `Mesh::are_coplanar` (`dot > 1.0 - EPS_PLANE_NORMAL`) 가 1e-4 threshold.
f32 drift `~10μm` (= 1e-5 mm) → dot product 차이가 `O(drift^2 / radius^2)` →
정상적 face plane 동등성 판정 통과. **그러나** offset drift (face center
이 다른 plane 으로 perceived) 는 ADR-167 EPS_PLANE_OFFSET = 1.5e-3 mm 보다
큰 경우 발생 가능 → silent "different plane" 판정 → face merge / Boolean
implicit fail.

### 1.3 메타-원칙 정합

- **메타-원칙 #6 (Preventive over Curative)** — silent bug 발생 전 snap 보정
- **메타-원칙 #15 (동일 분할 = 동일 topological contract)** — face plane
  contract 의 silent drift 차단
- **메타-원칙 #14 (면은 닫힌 경계로부터 유도된다)** — 경계 polygon 모두
  exact plane 위에 있어야 — drift snap 이 *Jordan-Schoenflies 정리 정합*
  강화

## 2. Solution architecture (5 Q 결재 default 5/5, 사용자 결재 2026-05-29)

### Q1=(a) — Drift snap 알고리즘: Tessellation chord substitute

**Lock-in**: AnalyticSurface 의 tessellation chord vertex 를 plane 으로
projection. ADR-031 Phase D `AnalyticSurface::tessellate` 자산 재사용.

```rust
/// Project tessellation chord vertices to the face's exact analytic plane.
/// Drift correction < 1.5μm typical (matches LOCKED #5).
pub fn snap_face_chord_to_plane(
    mesh: &mut Mesh,
    face: FaceId,
    plane: &Plane,
    snap_tol: f64,
) -> SnapReport { ... }
```

**근거**:
- 가장 단순 (Newton refinement 비교) → multi-week atomic 회피
- ADR-031 Phase D infrastructure 자연 재사용 (per-face surface attach 후 tessellate)
- Drift correction < 1.5μm (matches LOCKED #5 spatial-hash 정합)
- Boundary polygon vertex 도 chord 결과 — 동일 projection 통과

**대안 (거부)**:
- (b) Newton refinement: 더 정확하지만 multi-week atomic. derivative
  evaluate 비용 + non-convex face boundary edge case 복잡
- (c) Polyline boundary only: interior chord drift 부분적 해소 안 됨

### Q2=(a) — Tolerance hierarchy: Independent constants

**Lock-in**: ADR-167 EPS_PLANE_* 와 별도 *stricter* snap constants.
detection (loose) vs snap correction (strict) 의 *layered* 아키텍처.

```rust
/// Normal direction snap tolerance (stricter than EPS_PLANE_NORMAL).
/// Applied during chord vertex projection — caller may override per-call.
pub const PLANE_SNAP_NORMAL: f64 = 1e-3;  // mm — stricter than EPS_PLANE_NORMAL (1e-4)

/// Offset snap tolerance (stricter than EPS_PLANE_OFFSET).
pub const PLANE_SNAP_OFFSET: f64 = 1e-4;  // mm — stricter than EPS_PLANE_OFFSET (1.5e-3)
```

**근거**:
- *detection* (1e-4 / 1.5e-3 = ADR-167) vs *snap* (1e-3 / 1e-4 = ADR-168)
  분리 — 다른 architectural concerns
- Per-call override (L-167-3 답습) — strict callsite (예: STEP/IGES import)
  에서 stricter snap 가능

**대안 (거부)**:
- (b) Re-use EPS_PLANE_*: snap = detection 이라 architectural concern 혼동
- (c) Cascade: divided constants 가 의미 분리 흐림

### Q3=(a) — Callsite scope: Face creation only (minimum risk)

**Lock-in**: DrawRectAsShape / DrawCircleAsShape / DrawPolygonAsShape /
DrawLineAsShape 의 face 생성 직후 만 snap. Boolean / Push/Pull / Offset
는 *Phase 3* 별도 scope.

**Phase 분배**:
- **β-2** (Phase 2): face creation entry points (4 callsites)
- **Phase 3 (별도 ADR)**: Boolean splits + Offset + Push/Pull cascade

**근거**:
- 가장 안전한 entry — face 생성 시점이 *처음 plane definition* 시점
- 회귀 risk 최소 (Boolean 결과는 input face 들이 이미 snap 통과)
- 사용자 facing 즉시 가치 — DrawRect on tilted face 즉시 보정

**대안 (거부)**:
- (b) Face creation + Boolean splits + Offset: 더 많은 callsites,
  drift accumulation 가능성 있는 cascade 미해결
- (c) All-tools: maximum risk, 추적 어려움

### Q4+Q5=(a) — Migration + Scope: 3-phase additive + Face plane only

**Lock-in**:

| Phase | Sub-step | 내용 |
|---|---|---|
| Phase 1 (β-1) | Snap helper + detection only (no mutation) | `snap_face_chord_to_plane` + `detect_drift` API. additive, callsite UNCHANGED |
| Phase 2 (β-2) | Selected callsites 활성 — Q3=a face creation only | DrawRectAsShape / DrawCircleAsShape / DrawPolygonAsShape / DrawLineAsShape |
| Phase 3 (β-3) | Drift telemetry + 사용자 시연 | Drift metric collection + dashboard 정합. silent bug 평가 |
| γ | Closure docs | Status Accepted + LOCKED entry |

**Scope**: Face plane only. Edge polyline drift + curve metadata drift
는 별도 ADR (Future).

## 3. Path Z atomic plan (5 sub-step, ADR-167 답습)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α (본 PR)** | ADR-168 spec only + ADR-026 P12 audit + ADR-167 layered architecture 정합 명시 | +0 |
| **β-1** | `axia-geo/src/operations/plane_snap.rs` 신설 (PLANE_SNAP_NORMAL + PLANE_SNAP_OFFSET constants + snap_face_chord_to_plane API) + `detect_face_drift` (read-only) + 6 회귀 (constants + chord snap + drift detection + no-mutation + edge cases) | +6 |
| **β-2** | 4 callsites 활성 (DrawRectAsShape / DrawCircleAsShape / DrawPolygonAsShape / DrawLineAsShape) — face 생성 직후 snap 호출 + 4 회귀 (각 callsite migration evidence) | +4 |
| **β-3** | Drift telemetry instrumentation + `Mesh.snap_metrics` aggregate + 사용자 시연 게이트 (ADR-087 K-ζ canonical) + 3 회귀 (telemetry + invariant + 사용자 시연) | +3 |
| **γ** | Closure docs + Status Accepted + LOCKED entry + README + 2 회귀 (canonical SSOT direct invocation + catalog drift) | +2 |
| **합계** | | **+15** |

**예상 시간**: 1-day single-day (ADR-152/164/166/167 5-step variant
pattern 5번째 reproducibility 예상).

## 4. Lock-ins (canonical for ADR-168)

- **L-168-1** Q1=(a) Tessellation chord substitute algorithm
- **L-168-2** Q2=(a) Independent constants — PLANE_SNAP_NORMAL (1e-3) +
  PLANE_SNAP_OFFSET (1e-4), stricter than ADR-167 EPS_PLANE_*
- **L-168-3** Q3=(a) Face creation only scope (minimum risk)
- **L-168-4** Q4=(a) 3-phase additive migration (Phase 1 no mutation,
  Phase 2 active callsites, Phase 3 telemetry)
- **L-168-5** Q5=(a) Face plane only scope — edge polyline / curve drift
  별도 future ADR
- **L-168-6** ADR-167 EPS_PLANE_* SSOT 자연 lock-in — *layered architecture*
  (detection vs snap)
- **L-168-7** ADR-026 P12 cardinal SSOT 보존 — non-cardinal 만 보강
- **L-168-8** ADR-031 Phase D AnalyticSurface infrastructure 재사용
- **L-168-9** 메타-원칙 #6 (Preventive over Curative) + #14 (면은 닫힌
  경계로부터) + #15 (동일 분할 contract) 정합
- **L-168-10** Per-call snap_tol override (L-167-3 답습) — strict callsite
  (STEP/IGES import) 에서 stricter snap 가능
- **L-168-11** 절대 #[ignore] 금지 15/15 강제

## 5. Out of scope (별도 ADR / future track)

| ADR | Scope | LOCKED #43 priority |
|---|---|---|
| **ADR-168 (본 ADR)** | Face plane drift snap (Q3=a face creation only) | 🟡 P1 (production silent bug 차단) |
| Future | Boolean / Offset / Push/Pull cascade drift snap (Q3=b/c expansion) | TBD |
| Future | Edge polyline drift snap (Q5=c expansion) | TBD |
| Future | Curve metadata drift snap (NURBS Kernel) | TBD |

**시퀀스 결재 (사용자 2026-05-28 + 2026-05-29 confirmed)**: LOCKED #43
priority sequence (a) → (b) → (c) closure (ADR-166 / ADR-167 / **ADR-168**).
ADR-168 closure 후 next priority audit.

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (axia-geo +6)**:
- `adr168_plane_snap_normal_default_value` (1e-3 lock-in)
- `adr168_plane_snap_offset_default_value` (1e-4 lock-in)
- `adr168_snap_face_chord_to_plane_drift_correction` (< snap_tol after snap)
- `adr168_snap_no_mutation_when_drift_below_tol` (additive only)
- `adr168_detect_face_drift_read_only` (no DCEL state change)
- `adr168_snap_anti_parallel_normal_handled` (face flipped winding evidence)

**β-2 회귀 (axia-geo +4)**:
- `adr168_b2_draw_rect_as_shape_snaps_chord_drift` (per-callsite evidence)
- `adr168_b2_draw_circle_as_shape_snaps_chord_drift`
- `adr168_b2_draw_polygon_as_shape_snaps_chord_drift`
- `adr168_b2_draw_line_as_shape_face_path_snaps_chord_drift` (closed loop)

**β-3 회귀 (axia-geo +3)**:
- `adr168_b3_snap_metrics_aggregate_per_face_count`
- `adr168_b3_telemetry_drift_distribution_invariant`
- `adr168_b3_user_demo_gate_evidence` (사용자 시연 evidence, ADR-087 K-ζ)

**γ 회귀 (+2)**:
- `adr168_gamma_canonical_surface_publicly_invocable_from_crate_root`
- `adr168_gamma_catalog_drift_check_passes`

## 7. Cross-link

- **ADR-167** §5.1 (sequence anchor source — 직계 trigger) + **LOCKED #68**
- **ADR-166** §5.1 (LOCKED #43 priority sequence anchor)
- **ADR-026 P12** (Cardinal plane SSOT — 보존, non-cardinal 만 보강)
- **ADR-031 Phase D** (AnalyticSurface infrastructure — chord substitute 자산)
- **ADR-101 Amendment 9** (split-induced edge HARD flag — face split 정합)
- **ADR-061 Phase P** (Newton refinement — Q1 대안 (b) 비교 source)
- **ADR-094 §E L1** (additive-first + multi-gate atomic)
- **ADR-076 §C-amendment-1** (legacy cleanup pattern — Phase 3 telemetry sunset)
- **메타-원칙 #6** (Preventive) + **#14** (면은 닫힌 경계로부터) +
  **#15** (동일 분할 contract)
- **LOCKED #5** (1.5μm spatial-hash) — snap_tol natural lower bound
- **LOCKED #7** ADR-026 P12 (cardinal SSOT — 보존)
- **LOCKED #43** priority sequence (c) → ADR-168 진입
- **LOCKED #44** Complete Meaning per Merge — single atomic PR per sub-step
- **LOCKED #67** ADR-166 / **LOCKED #68** ADR-167 (직계 precursors)

## 8. 결재 cycle log

- **2026-05-29 α** (본 PR) — ADR-168 spec only + ADR-026 P12 cardinal SSOT
  gap audit + Q1~Q5 결재 default 5/5 (사용자 결재 2026-05-29)
- **TBD β-1** — `axia-geo/src/operations/plane_snap.rs` + 2-constant +
  helper + detect + 6 회귀
- **TBD β-2** — 4 face creation callsites 활성 + 4 회귀
- **TBD β-3** — Drift telemetry + 사용자 시연 + 3 회귀
- **TBD γ** — closure docs + 2 회귀

## 9. Lessons (TBD — γ closure 시 작성)

본 섹션은 γ closure (Status Proposed → Accepted) 시 작성. ADR-167 §9
Lessons 답습 + ADR-168 의 *layered architecture (detection vs snap)
+ Phase 3 telemetry gate* 가치 명시.

후보 lessons (β implementation 완료 시 확정):
- audit-first canonical 18번째 적용 (ADR-026 P12 cardinal gap)
- 5-step variant 5번째 reproducibility
- Layered architecture (ADR-167 detection + ADR-168 snap) 의 자연
  hierarchy 가치
- Telemetry-driven validation gate (β-3) 의 architectural quality value
- Tessellation chord substitute 의 minimum-risk algorithm 가치
- ADR-026 P12 보존 (cardinal SSOT) + non-cardinal 보강 의 backward-compat
- ADR-031 Phase D 자산 재사용 의 architectural reuse 가치
