# ADR-152 — P7-M4/M5 + Euler/Genus 모듈 (Sprint 4 첫째 ADR)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-28
**Author**: WYKO + Claude
**Trigger**: ADR-141 §3 Sprint 4 (Healing Pipeline Step 4) 첫째 ADR.
ADR-141 reserve:
> "ADR-152 | P7-M4/M5 + Euler/Genus 모듈 | S4 | 2주"
**Audit precondition**: `docs/audits/2026-05-28-sprint-4-precheck.md`
(본 PR 동시) — multi-week 추정 50% 감소 evidence (2주 → 1주).
audit-first canonical 13번째 적용.
**Direct predecessor**:
- ADR-051 P7 canonical (P7-M1/M2/M3 reaffirmation, LOCKED #1)
- ADR-151 (Sprint 3 셋째 ADR, 6-step template + verify_p7_manifold 활용)
- ADR-149/150 (Sprint 3 첫째/둘째)
**Sprint**: S4 (ADR-141 §3 — 3-4주, 회귀 +60 share ~33%).

## Canonical anchor

ADR-141 §3 Sprint 4 매트릭스의 첫째 ADR — P7 manifold 의 *기존 3 invariant*
(M1/M2/M3) 위에 **2 additional invariants (M4/M5)** + **Euler characteristic
+ Genus** 계산 모듈 추가. ADR-051 §2.3 P7 strict reaffirmation 의 자연
확장.

**핵심 통찰** (audit-first canonical 13번째, 2026-05-28):
- P7Violation enum 의 3 variants 위에 M4/M5 variant 추가는 **enum extension**
  (새 알고리즘 0)
- Euler characteristic `χ = V - E + F = 2 - 2g` 공식은 단순 카운팅 (Genus
  계산은 한 줄)
- 기존 DCEL primitives (`verts.len()` / `edges.len()` / `faces.len()`)
  + active filter helper 로 충분

## 1. Problem statement

### 1.1 ADR-051 P7-M1/M2/M3 의 한계

ADR-051 §2.3 의 P7Violation enum (`axia-geo/p7_manifold.rs:55`):
- M1 `EdgeSharedByWrongCount` — edge shared by ≠ 2 active faces
- M2 `BoundaryEdgeMalformed` — radial chain malformed
- M3 `HoleLoopMissingContainer` — hole loop incident face missing

**미확인 invariants**:
- **M4 — Vertex valence pathology**: 단일 vertex 가 비정상 valence (e.g.,
  isolated vertex with 0 incident edges, or vertex with >MAX_VALENCE)
- **M5 — Face orientation consistency**: connected face neighborhood 의
  normal direction 일관성 (winding flip 감지)

→ **Healing pipeline 에서 미감지** — Mesh::heal() (ADR-154) 이 M4/M5 까지
체크해야 완전한 invariant guarantee.

### 1.2 Euler/Genus 모듈 부재

Mesh 의 topological 분류 (genus 0 = sphere-like / genus 1 = torus-like /
etc.) 가 명시적으로 계산되지 않음. ADR-051 §2.5 deferred boundary 같은
edge case 에서 *quantitative* topology check 필요.

→ **`χ = V - E + F` Euler characteristic** + **`g = (2 - χ) / 2` Genus**
공식 모듈 신설. Closed manifold 한정 (open manifold 는 boundary loop
count 까지 포함).

### 1.3 메타-원칙 정합

- **메타-원칙 #14** (면 = closed boundary 의 byproduct) — Euler/Genus 가
  *quantitative* expression
- **메타-원칙 #15** (동일 분할 = 동일 contract) — M4/M5 가 split 정합성
  invariant 강화
- **LOCKED #1 ADR-021 P7** — M4/M5 추가는 P7 의 자연 확장 (변경 아닌
  확장)
- **LOCKED #44** (Complete Meaning per Merge) — 5-step single atomic PR
  per sub-step

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — M4 정의: (a) Isolated vertex + max valence violation

**Lock-in**: P7Violation enum 에 추가:
```rust
P7Violation::VertexValencePathology {
    vertex: VertId,
    kind: VertexValenceKind,
}

pub enum VertexValenceKind {
    Isolated,         // 0 incident edges
    OverConnected,    // > MAX_VERTEX_VALENCE (default 64)
}
```

### Q2 — M5 정의: (a) Connected face normal consistency

**Lock-in**: P7Violation enum 에 추가:
```rust
P7Violation::FaceOrientationInconsistent {
    face_a: FaceId,
    face_b: FaceId,
    dot_product: f64,  // -1.0 ≈ flipped, +1.0 ≈ aligned
}
```

체크 정책: container + inners 의 *neighbor* face pair (shared edge)
normal dot product < -0.5 → flip 의심.

### Q3 — Euler/Genus 모듈 위치: (a) `axia-geo/p7_manifold.rs` 확장

**Lock-in**: `axia-geo/p7_manifold.rs` 에 추가:
```rust
pub struct MeshTopologyReport {
    pub vertex_count: usize,
    pub edge_count: usize,
    pub face_count: usize,
    pub euler_characteristic: i32,  // V - E + F
    pub genus: Option<i32>,  // (2 - χ) / 2, closed manifold only
    pub boundary_loop_count: usize,
    pub is_closed: bool,
}

pub fn compute_topology(mesh: &Mesh) -> MeshTopologyReport;
```

### Q4 — Template 선택: (a) 5-step (UI 없음, β-3 WASM+TS 통합)

**Lock-in**: ADR-164 의 5-step 변형 답습. UI 변경 0 (β-3 가 WASM bridge
+ TS wrapper 통합).

### Q5 — 회귀 분배: (a) +20 (β-1 6 + β-2 6 + β-3 5 + γ 3)

**Lock-in**: ADR-141 §3 spec 정합.

## 3. Path Z atomic plan (5 sub-step)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-152 spec only commit (본 PR) | +0 |
| **β-1** | P7Violation enum M4/M5 + `verify_p7_manifold` extension + 6 회귀 (M4 isolated/over-connected + M5 flip detection + regression guards) | +6 |
| **β-2** | `MeshTopologyReport` + `compute_topology` + 6 회귀 (closed manifold Euler + open boundary loop + genus calc + regression guards) | +6 |
| **β-3** | WASM bridge (`verifyP7ManifoldExtended` + `computeTopology` JSON) + TS wrapper + 5 회귀 (3 WASM endpoint-wired + 2 TS bridge) | +5 |
| **γ** | E2E + closure docs (Status Accepted + §9 Lessons + README + LOCKED 등재) + 3 회귀 (Playwright) | +3 |
| **합계** | | **+20** |

**예상 시간**: 1주 single-week (audit-first 13번째 50% 감소 evidence).

## 4. Lock-ins (canonical for ADR-152)

- **L-152-1** Q1=(a) M4 — VertexValencePathology (Isolated + OverConnected)
- **L-152-2** Q2=(a) M5 — FaceOrientationInconsistent (dot product < -0.5)
- **L-152-3** Q3=(a) Euler/Genus 모듈 `p7_manifold.rs` 확장 (new module
  파일 추가 안 함)
- **L-152-4** Q4=(a) 5-step template (UI 없음)
- **L-152-5** Q5=(a) +20 회귀 (ADR-141 spec 정합)
- **L-152-6** Engine 변경 = enum extension only (mesh.rs 변경 0, 정책
  B-hybrid 답습)
- **L-152-7** ADR-051 P7 canonical 보존 — M1/M2/M3 unchanged, M4/M5 추가만
- **L-152-8** ADR-046 P31 #4 additive only — public API surface UNCHANGED
  (`verify_p7_manifold` signature 동일, return type 만 확장)
- **L-152-9** `MAX_VERTEX_VALENCE` const = 64 (현재 mesh 사용 사례 기준 +
  여유)
- **L-152-10** 절대 #[ignore] 금지 20/20 강제

## 5. Out of scope (선택적 또는 별도 ADR)

- **M6+ 추가 invariants** — 별도 ADR (현재는 M4/M5 만)
- **NURBS surface genus** — OCCT BRepGProp_Volume 등, ADR-157 (S5)
- **Genus > 1 manifold support** — torus / multi-handle, 별도 ADR
- **Visual debug overlay** — TopologyRecoveryDialog cross-cut, ADR-154 γ
- **`Mesh::heal()` integration** — ADR-154 (Sprint 4 셋째)

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (axia-geo +6)**:
- `adr152_m4_isolated_vertex_detected`
- `adr152_m4_over_connected_vertex_detected`
- `adr152_m4_normal_valence_passes`
- `adr152_m5_face_flip_detected`
- `adr152_m5_aligned_neighbors_pass`
- `adr152_m1_m2_m3_unchanged_baseline` (regression guard)

**β-2 회귀 (axia-geo +6)**:
- `adr152_compute_topology_closed_cube_genus_0`
- `adr152_compute_topology_open_disk_boundary_loop_count`
- `adr152_compute_topology_euler_v_minus_e_plus_f`
- `adr152_compute_topology_genus_only_for_closed_manifold`
- `adr152_compute_topology_active_filter_excludes_inactive`
- `adr152_compute_topology_empty_mesh_baseline`

**β-3 회귀 (vitest +5)**:
- `adr152_beta3_verify_p7_manifold_extended_endpoint_wired`
- `adr152_beta3_compute_topology_endpoint_wired`
- `adr152_beta3_json_schema_locked` (vertex_count + edge_count + ...)
- `WasmBridge.verifyP7ManifoldExtended parses JSON + graceful fallback`
- `WasmBridge.computeTopology parses JSON + graceful fallback`

**γ 회귀 (Playwright +3)**:
- `adr152_gamma_engine_p7_violation_enum_extended` (browser smoke)
- `adr152_gamma_compute_topology_browser_round_trip`
- `adr152_gamma_verify_p7_extended_browser_round_trip`

## 7. Cross-link

- **Audit precondition**: `docs/audits/2026-05-28-sprint-4-precheck.md`
  (Sprint 4 사전 audit, 본 PR 동시)
- ADR-141 §3 (Sprint 4 reserve anchor)
- ADR-051 §2.3 P7 canonical (M1/M2/M3 source)
- ADR-149/150/151 (Sprint 3 6-step template)
- ADR-164 (5-step template variant — UI 없음, 본 ADR 답습)
- ADR-148 (BoundaryTool 6-step template source)
- ADR-021 P7 LOCKED #1 (canonical anchor)
- ADR-046 P31 #4 (additive only)
- LOCKED #1 (P7) / #44 (atomic per merge) / #65 메타-원칙 #14/#15/#16
  / #66 STATUS-POLICY
- 메타-원칙 #14 (면 = closed boundary byproduct) + #15 (동일 분할 contract)

## 8. 결재 cycle log

- **2026-05-28 audit-first canonical 13번째** (본 PR `docs/audits/`) —
  Sprint 4 사전 audit. 핵심 finding: multi-week 추정 50% 감소 가능 (3-4주
  → 2-3주).
- **2026-05-28 Q1~Q5 결재** — 사용자 "승인합니다" (audit 후 추천 default
  5/5 자동 결재):
  - Q1=(a) M4 VertexValencePathology ✅
  - Q2=(a) M5 FaceOrientationInconsistent ✅
  - Q3=(a) p7_manifold.rs 확장 (별도 파일 안 만듦) ✅
  - Q4=(a) 5-step template (UI 없음) ✅
  - Q5=(a) +20 회귀 ADR-141 spec ✅
- **2026-05-28 α** (본 commit) — ADR-152 spec only PR
- **TBD β-1** — P7Violation M4/M5 extension + 6 회귀
- **TBD β-2** — compute_topology + 6 회귀
- **TBD β-3** — WASM bridge + TS wrapper + 5 회귀
- **TBD γ** — E2E + closure docs + §9 Lessons

## 9. Lessons (TBD — γ closure 시 작성)

본 섹션은 γ closure (Status Proposed → Accepted) 시 작성. ADR-149 / 150
/ 151 / 164 §9 Lessons (canonical for Sprint 3 + ADR-164) 답습 +
Sprint 4 첫째 ADR 의 추가 lessons 누적.

후보 lessons (β implementation 완료 시 확정):
- **audit-first canonical 13번째 가치** — multi-week 추정 50% 감소 evidence
  (2주 → 1주)
- ADR-148 → ADR-149 → ADR-150 → ADR-151 → ADR-164 → ADR-152 6-step template
  reproducibility (Sprint 1+2+3+4 cumulative pattern)
- enum extension via P7Violation (Sprint 4 의 architectural 가치 — *원본
  API 변경 0, 확장 only*)
- 메타-원칙 #14 (면 = closed boundary byproduct) 의 *quantitative*
  expression — Euler/Genus 모듈이 architectural anchor
- Sprint 4 closure → Sprint 4.5 / Sprint 5 자연 진행
