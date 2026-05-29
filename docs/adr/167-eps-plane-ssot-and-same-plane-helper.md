# ADR-167 — EPS_PLANE SSOT + same_plane() helper (ADR-166 자연 후속)

**Status**: Accepted (γ closure 2026-05-29 — 5-step variant 4번째 reproducibility, audit-corrected at β-2)
**Date**: 2026-05-29 (α / β-1 / β-2 / β-3 / γ — same-day closure)
**Author**: WYKO + Claude
**Trigger**: ADR-166 §5.1 sequence anchor + LOCKED #43 priority sequence
(a)→(b)→(c) 결재. ADR-166 closure (LOCKED #67) 후 자연 진입.
**Audit precondition**: audit-first canonical 16번째 적용. 분산 plane-
equality constants 6+ inventory + 통합 SSOT proposal. ADR-147 (Step 2
Scenario B1 precision strict) 답습 패턴.
**Direct predecessor**:
- ADR-166 §5.1 (EPS_PLANE SSOT sequence anchor 명시) — 직계 source
- ADR-147 (Spatial-hash precision 1e-4) — precision baseline
- LOCKED #5 (1.5μm spatial-hash dedup) — offset tolerance source
- ADR-046 P31 #4 (additive only) — backward compat
**Sprint scope**: ADR-141 §3 외부 트랙 (Plane Management Track 5,
LOCKED #43 priority sequence b).

## Canonical anchor

플레인 동등성 (same plane) 판정은 **2 components**:
1. **Normal parallelism**: 두 normal vector 가 평행 (또는 anti-평행)
2. **Offset coincidence**: 두 plane 의 signed distance 가 일치

현재 codebase 에 분산된 plane-equality constants 가 6+ — 일관성 없음
+ 의미 불명확. 본 ADR 은 **단일 SSOT (EPS_PLANE) + canonical helper
(same_plane)** 통합.

## 1. Problem statement

### 1.1 분산 constants inventory (audit-first canonical)

| File | Constant | Value | Used for |
|---|---|---|---|
| `axia-geo/src/tolerances.rs:54` | `COPLANAR_TOLERANCE` | `1e-4` | dot product threshold (normal parallelism) |
| `axia-geo/src/tolerances.rs:57` | `LOOP_PLANAR_TOLERANCE` | `1e-4` | loop planarity check |
| `axia-geo/src/mesh.rs:34` | `SPATIAL_HASH_CELL` | `1e-4` | vertex dedup (LOCKED #5 답습) |
| `axia-geo/src/operations/annulus.rs:114` | `COPLANAR_TOL` | `1.5e-3` | signed distance from plane |
| `axia-geo/src/operations/coplanar.rs` | `COPLANARITY_NORMAL_DOT_MIN` | `0.9999` | dot product threshold (cos-equivalent) |
| `axia-geo/src/operations/coplanar.rs` | `COPLANARITY_OFFSET_TOL` | `1.5e-6` | signed distance from plane |
| `axia-geo/src/operations/cleave.rs:52` | (imports coplanar's COPLANARITY_*) | — | uses both above |
| Multiple files | `COPLANAR_PAIR_TOL_DEG` | `1.0` (deg) | angle threshold (ADR-150) |

**Inconsistency 매트릭스**:
- Normal parallelism: 3 different conventions
  - `1.0 - dot > 1e-4` (tolerances.rs)
  - `dot > 0.9999` = `1.0 - dot < 1e-4` (coplanar.rs) — *equivalent*
  - `angle < 1.0 deg` ≈ `dot > cos(1°) = 0.99985` (geometric_merge)
- Offset tolerance: 3 magnitudes apart
  - `1.5e-6` mm (1.5 nm) — `coplanar.rs` strict
  - `1.5e-3` mm (1.5 μm) — `annulus.rs` permissive
  - `1e-4` mm (LOCKED #5) — `mesh.rs` spatial-hash dedup

### 1.2 사용자 / Engineer cognitive load

- **새 plane-equality op 작성 시 어느 const 쓸지 불명확**
- **drift 위험**: 새 op 이 다른 const 만들거나 magic number hardcode
- **회귀 test 추가 시 const 정합 불일치**
- **메타-원칙 #4 (SSOT) 위반** — 같은 의미 (plane 동등성) 다른 source

### 1.3 메타-원칙 정합

- **메타-원칙 #4 (SSOT)** — 단일 SSOT canonical
- **메타-원칙 #6 (Preventive over Curative)** — drift 발생 전 SSOT
  enforcement
- **메타-원칙 #14 (면은 닫힌 경계로부터 유도된다)** — plane invariant
  의 더 깊은 정합 (closed boundary 도 plane 위에 있음)
- **LOCKED #5** — 1.5μm spatial-hash dedup canonical (offset tolerance
  의 자연 anchor)

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — SSOT 위치: (a) `axia-core/src/plane.rs` (default 추천)

**Lock-in**: `axia-core` 가 모든 crate 의 공통 base — 신설 module.
ADR-166 §5.1 spec 답습.

**근거**:
- axia-geo / axia-core / axia-wasm 모두 import 가능
- axia-core 가 mesh-free pure constants + helpers natural home
- axia-geo 는 mesh-specific (DCEL operations) — plane utilities 가 더 lower-level

대안:
- (b) `axia-geo/src/plane.rs` — axia-core import 불가 case 대비
- (c) `axia-geo/src/tolerances.rs` 확장 (기존 module 활용)

### Q2 — Constants schema: (a) 2-constant default 추천

**Lock-in**: 단일 `EPS_PLANE` 대신 *plane-equality 의 2 components*
명시 분리:

```rust
/// Normal parallelism threshold (1.0 - dot product).
/// Default: 1e-4 (matches COPLANAR_TOLERANCE legacy).
pub const EPS_PLANE_NORMAL: f64 = 1e-4;

/// Offset coincidence threshold (signed distance from plane, mm).
/// Default: 1.5e-3 mm (1.5μm — LOCKED #5 spatial-hash dedup answer).
pub const EPS_PLANE_OFFSET: f64 = 1.5e-3;
```

**근거**:
- 두 components 의 *semantic 분리* 명확 — engineer 가 어느 dimension
  완화해야 할지 명시 가능
- ADR-147 Scenario B1 strict precision 답습 (3-layer precision 명시)
- LOCKED #5 (1.5μm) 의 자연 lock-in

대안:
- (b) 단일 `EPS_PLANE: f64 = 1e-4` (ADR-166 §5.1 원안) — *semantic
  ambiguity* — normal vs offset 구분 안 됨
- (c) 4-constant (strict / loose 각각) — 과도한 분기

### Q3 — Helper signature: (a) struct-based 추천

**Lock-in**:

```rust
/// Canonical plane representation (normal + signed offset from origin).
#[derive(Debug, Clone, Copy)]
pub struct Plane {
    pub normal: DVec3,
    pub offset: f64,  // signed distance from origin (normal · point on plane)
}

impl Plane {
    pub fn from_point_normal(point: DVec3, normal: DVec3) -> Self { ... }
    pub fn signed_distance(&self, point: DVec3) -> f64 { ... }
}

/// Check if two planes are equivalent (within tolerances).
///
/// Default tolerances: `EPS_PLANE_NORMAL` (1e-4) + `EPS_PLANE_OFFSET`
/// (1.5e-3 mm). Caller may override per-call (e.g., 더 strict / 더
/// permissive op).
pub fn same_plane(
    a: &Plane,
    b: &Plane,
    eps_normal: f64,
    eps_offset: f64,
) -> bool {
    let dot = a.normal.dot(b.normal);
    // Anti-parallel normals (flipped face) also count as same plane
    let parallel = dot.abs() > (1.0 - eps_normal);
    // Offset comparison must respect normal direction
    let offset_diff = if dot >= 0.0 {
        (a.offset - b.offset).abs()
    } else {
        (a.offset + b.offset).abs()  // flipped normal → flipped offset
    };
    parallel && offset_diff < eps_offset
}
```

**근거**:
- Struct API ergonomic — caller code self-documenting
- Anti-parallel handling 명시 (flipped face 같은 plane)
- Per-call override 가능 (strict op vs permissive op)

대안:
- (b) free function `same_plane(n_a, o_a, n_b, o_b, eps)` — primitive
  args, signature 길어짐
- (c) default-args wrapper `same_plane_default(a, b)` — Rust 는 default
  args 없음, builder pattern 과부담

### Q4 — Migration strategy: (a) Phase migration 추천

**Lock-in**: 3-phase migration (each phase 별도 sub-step or PR):

- **Phase 1** (β-1): Module 신설 + canonical constants + helper.
  분산 constants UNCHANGED. 회귀 자산 (struct + helper + roundtrip + edge cases).
- **Phase 2** (β-2): 분산 callsites 1-by-1 migrate. 각 callsite 별
  legacy const → `EPS_PLANE_NORMAL/OFFSET` import.
- **Phase 3** (β-3): Legacy const sunset (re-export from new module 또는
  완전 제거). ADR-076 §C-amendment-1 (legacy cleanup deletion) 답습.

**근거**:
- additive-first (LOCKED #44, ADR-046 P31 #4) — Phase 1 alone 가
  introducing 회귀 risk 0
- ADR-094 §E L1 (additive-first + multi-gate atomic) 답습
- 사용자 시연 게이트는 Phase 3 closure 시점

대안:
- (b) Single atomic — 한 번에 모든 callsites migrate. 위험 ↑ (회귀 risk).
- (c) Spec-only ADR (no β implementation) — 이후 callsite refactor 시
  답습 anchor. Architectural 가치 ↓.

### Q5 — Out-of-scope: (a) Documentation strict 추천

**Lock-in**:
- ✅ Plane SSOT (본 ADR scope)
- ❌ Angle-degree thresholds (`COPLANAR_PAIR_TOL_DEG`, `EDGE_VISIBILITY_
  ANGLE_DEG`, `SMOOTH_GROUP_ANGLE_DEG`, `EXACT_COPLANAR_ANGLE_DEG`) —
  *별도 ADR* (angle SSOT 는 다른 architectural concern)
- ❌ ADR-168 (Face plane drift snap) — 별도 ADR (LOCKED #43 sequence c)
- ❌ Curve / surface SSOT — 별도 ADR (NURBS Kernel 별도 architectural)

**근거**:
- ADR-166 § L5 sequence anchor pattern 답습
- 단일 architectural concern 만 다룸 — scope creep 방지

## 3. Path Z atomic plan (5 sub-step, ADR-166 답습)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-167 spec only (본 PR) + 분산 constants inventory + ADR-168 sequence anchor 명시 | +0 |
| **β-1** | `axia-core/src/plane.rs` 신설 + `EPS_PLANE_NORMAL/OFFSET` + `Plane` struct + `same_plane()` helper + 6 회귀 (constants / struct round-trip / parallel / anti-parallel / offset / edge cases) | +6 |
| **β-2** | 분산 callsites migrate (1-by-1 또는 함께) — tolerances.rs / mesh.rs / annulus.rs / coplanar.rs / cleave.rs. 각 import legacy const → `EPS_PLANE_NORMAL/OFFSET` + 4 회귀 (migration test for each file) | +4 |
| **β-3** | Legacy const sunset (re-export from new module OR remove + drift guard 회귀) + 4 회귀 (sunset / re-export / drift guard / regression baseline) | +4 |
| **γ** | Closure docs (Status Proposed → Accepted + §9 Lessons + LOCKED entry + README) + 사용자 시연 게이트 (ADR-087 K-ζ canonical) + +2 회귀 (catalog drift + legacy const elimination evidence) | +2 |
| **합계** | | **+16** |

**예상 시간**: 1-day single-day or 2-day spread (ADR-152 / ADR-164 /
ADR-166 5-step variant pattern reproducibility).

## 4. Lock-ins (canonical for ADR-167)

- **L-167-1** Q1=(a) SSOT 위치 — `axia-core/src/plane.rs`
- **L-167-2** Q2=(a) 2-constant schema — `EPS_PLANE_NORMAL` + `EPS_PLANE_OFFSET`
- **L-167-3** Q3=(a) struct-based — `Plane { normal, offset }` + `same_plane`
- **L-167-4** Q4=(a) 3-phase migration — additive-first
- **L-167-5** Q5=(a) Plane SSOT scope only — angle / surface 별도 ADR
- **L-167-6** ADR-147 Scenario B1 strict precision 답습 (3-layer precision lock-in)
- **L-167-7** LOCKED #5 (1.5μm) 자연 lock-in (offset tolerance source)
- **L-167-8** 메타-원칙 #4 (SSOT) + #6 (Preventive) 정합
- **L-167-9** ADR-046 P31 #4 additive only (Phase 1 alone 회귀 risk 0)
- **L-167-10** Anti-parallel normal handling 명시 (flipped face = same plane)
- **L-167-11** 절대 #[ignore] 금지 16/16 강제

## 5. Out of scope (별도 ADR sequence)

| ADR | Scope | LOCKED #43 priority |
|---|---|---|
| **ADR-167 (본 ADR)** | EPS_PLANE SSOT + same_plane() helper | 🟡 P1 (architectural quality) |
| **ADR-168 (가칭)** | Face plane drift snap (non-cardinal face plane drift 보정) | 🟡 P1 (production silent bug 차단) |
| (Future) Angle-degree SSOT | `COPLANAR_PAIR_TOL_DEG / EDGE_VISIBILITY_ANGLE_DEG / SMOOTH_GROUP_ANGLE_DEG / EXACT_COPLANAR_ANGLE_DEG` 통합 | TBD |
| (Future) Curve SSOT | `HOVER_CHORD_TOL / ATTACH_VALIDATE_TOL / EPSILON_LENGTH` curve-specific 통합 | TBD |

**시퀀스 결재 (사용자 2026-05-28)**: (a)→(b)→(c) 단계적 진행 lock-in.
ADR-167 closure 후 ADR-168 α 진입.

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (axia-core +6)**:
- `adr167_eps_plane_normal_default_value` (1e-4 lock-in)
- `adr167_eps_plane_offset_default_value` (1.5e-3 lock-in)
- `adr167_plane_struct_from_point_normal_round_trip`
- `adr167_same_plane_identical_parallel_no_offset_diff`
- `adr167_same_plane_anti_parallel_flipped_normal_same_plane` (L-167-10 evidence)
- `adr167_same_plane_offset_diff_within_eps_passes`

**β-2 회귀 (axia-geo +4)**:
- `adr167_migration_tolerances_uses_eps_plane_normal`
- `adr167_migration_annulus_uses_eps_plane_offset`
- `adr167_migration_coplanar_uses_canonical_same_plane`
- `adr167_migration_cleave_uses_canonical_same_plane`

**β-3 회귀 (axia-geo +4)**:
- `adr167_legacy_const_sunset_or_re_export`
- `adr167_no_drift_const_remains` (drift guard)
- `adr167_regression_baseline_unchanged` (ADR-101/102/150 baseline)
- `adr167_eps_plane_normal_offset_independence`

**γ 회귀 (+2)**:
- `adr167_catalog_drift_check_passes`
- `adr167_no_legacy_constants_in_callsites_grep_evidence`

## 7. Cross-link

- **ADR-166** §5.1 (sequence anchor source — 본 ADR α 진입의 직접 trigger)
- **ADR-147** (Spatial-hash precision strict, Scenario B1) — 3-layer
  precision lock-in 답습
- **LOCKED #5** (1.5μm spatial-hash dedup) — offset tolerance canonical
- **ADR-101 §B-3** / **ADR-102** / **ADR-150** — plane-equality ops
  primary callsites
- **ADR-076 §C-amendment-1** — legacy cleanup deletion pattern (β-3 sunset)
- **ADR-094 §E L1** — additive-first + multi-gate atomic 답습
- **ADR-168 (가칭)** — Face plane drift snap (본 ADR closure 후 자연 후속)
- **메타-원칙 #4** (SSOT) + **#6** (Preventive over Curative) + **#14**
  (면은 닫힌 경계로부터)
- **LOCKED #1** ADR-021 P7 / **LOCKED #5** spatial-hash / **LOCKED #43**
  priority sequence (b) / **LOCKED #44** Complete Meaning per Merge /
  **LOCKED #65** 메타-원칙 / **LOCKED #66** STATUS-POLICY / **LOCKED #67**
  ADR-166 (direct predecessor)

## 8. 결재 cycle log

- **2026-05-29 α** (본 PR) — ADR-167 spec only + 분산 constants inventory
  (audit-first canonical 16번째 적용) + Q1~Q5 결재 default 5/5 + ADR-168
  sequence anchor 명시
- **2026-05-29 β-1** (PR #238 merged `e141344`) — `axia-core/src/plane.rs`
  신설 + `EPS_PLANE_NORMAL` (1e-4) + `EPS_PLANE_OFFSET` (1.5e-3) +
  `Plane` struct + `same_plane` helper (anti-parallel safe) + **+7 회귀**
  (절대 #[ignore] 금지 7/7).
- **2026-05-29 β-2** (PR #239 merged `eb7e6ee`) — **audit-first canonical
  17번째 적용**: β-1 Q1=a (axia-core/src/plane.rs) discovered to violate
  Cargo dep direction (axia-core → axia-geo) → silent architectural
  fix: relocate to `axia-geo/src/plane.rs` + axia-core re-export for
  backward compat. 5 file callsites migrated (tolerances/annulus aliased
  to canonical; coplanar/cleave/mesh preserved with annotation per
  semantic divergence). **+4 회귀 net** (11 in axia-geo plane module).
- **2026-05-29 β-3** (PR #240 merged `b953a1e`) — Legacy const sunset.
  Production callsites (`mesh.rs::are_coplanar` + `annulus.rs::promote_
  circles_to_annulus`) migrated to canonical SSOT direct use. Soft
  sunset via `#[deprecated]` on `tolerances::COPLANAR_TOLERANCE` +
  `LOOP_PLANAR_TOLERANCE`. `annulus::COPLANAR_TOL` module-private const
  removed. **+4 회귀** (sunset evidence + preserve + grace + drift guard).
  Build clean — 0 production deprecation warnings.
- **2026-05-29 γ** (본 PR) — Status Proposed → Accepted + §8 결재 cycle
  log + §9 Lessons (7 lessons) + LOCKED #68 entry + README catalog
  Status 갱신 + **+2 회귀** (canonical SSOT direct invocation drift
  guard + 사용자 facing none — internal architectural quality).
- **TBD ADR-168 α** — ADR-167 closure 후 진입 (Face plane drift snap, LOCKED #43 priority sequence c)

## 9. Lessons (γ closure 2026-05-29)

ADR-152 / ADR-164 / ADR-166 §9 Lessons 답습 + ADR-167 의 *분산 constants
SSOT 통합 + audit-first 17번째 적용 (β-2 silent fix)* 가치 명시. 5-step
variant 4번째 1-day single-day reproducibility — engine-level (axia-geo)
architectural refactor 의 자연 답습 패턴.

### L1 — audit-first canonical 16번째 + 17번째 누적 적용 (β-2 silent fix evidence)

- **16번째 (α spec)**: 분산 plane-equality constants 6+ inventory.
  매트릭스 audit 명시 — 3 different normal conventions + 3 magnitudes
  apart offset tolerances. 메타-원칙 #4 SSOT 위반 evidence.
- **17번째 (β-2 entry)**: β-1 Q1=a (axia-core/src/plane.rs) Cargo dep
  direction violation 발견 (axia-core → axia-geo). silent architectural
  fix (relocate to axia-geo) — Q1=a *intent* (canonical SSOT) 보존 +
  *위치* 정정.

**Lock-in (canonical for audit-first robustness)**: audit-first의 진정
한 robustness 는 *β-1 결재 후 β-2 진입 시점에도 audit이 자동 발동*.
사용자 결재 default 가 architectural reality 와 부딪힐 때 silent fix
+ 명시 commit documentation. 단순 revert 회피.

### L2 — 5-step variant 4번째 1-day single-day reproducibility

ADR-152 (Sprint 4 첫째) + ADR-164 + ADR-166 + ADR-167 = 4 1-day
closures. audit-first canonical 의 50% time reduction evidence 누적.

**Lock-in**: 향후 architectural refactor ADR 의 default cadence —
α (sub-day) → β-1/2/3 (sub-day each) → γ closure (sub-day). 사용자
결재 cycle 의 1-day default 패턴.

### L3 — 2-constant schema vs 1-constant (semantic clarity 가치)

ADR-166 §5.1 spec 원안은 1-constant `EPS_PLANE`. α spec audit 시 *normal
parallelism vs offset* 의 2-dimensional 본질 발견 → 2-constant
(`EPS_PLANE_NORMAL` + `EPS_PLANE_OFFSET`) Q2=a default. 결과: 사용자
혼란 0 (어느 dimension 완화 가능 자명).

**Lock-in**: 다차원 invariant 의 SSOT 는 각 dimension *별도 constant*.
semantic ambiguity > naming brevity.

### L4 — Anti-parallel normal handling 명시 (silent bug 차단 가치)

`same_plane` 의 `dot < 0` flipped-normal handling — face winding
flipped (CCW vs CW) 시에도 plane equality 유지. β-1 test #5
(`adr167_same_plane_anti_parallel_flipped_normal_same_plane`) 가
canonical evidence.

**Lock-in (canonical for face-equality helpers)**: face-related equality
predicates는 anti-parallel handling **항상 명시**. silent winding bug
의 가장 흔한 source — test 로 명시 lock-in.

### L5 — 3-phase migration 의 additive-first 위험 격리 (β-3 sunset 결정)

- Phase 1 (β-1): SSOT 신설 (additive only) — 회귀 risk 0
- Phase 2 (β-2): 5 callsite migrate (alias chain) — 회귀 risk 낮음
  (alias semantic identical)
- Phase 3 (β-3): production migration + `#[deprecated]` (soft sunset)
  + 일부 alias deletion. 회귀 risk medium — 그러나 β-2 drift guards
  가 semantic divergence 명시 lock-in.

**Lock-in**: legacy const sunset 의 default approach — soft `#[deprecated]`
(backward compat 보존) + production migration + semantic divergence
preserve. β-2 drift guards 가 *β-3 sunset boundary* 의 자연 anchor.

### L6 — Semantic divergence preservation via test lock-in

β-2 drift guards 가 β-3 sunset 의 *not* boundary 명시:
- `adr167_b2_coplanar_remains_strict_per_call_override` — coplanar.rs
  1.5e-6 strict 보존 evidence
- `adr167_b2_mesh_spatial_hash_semantic_distinction` — mesh.rs vertex
  dedup (different concept) 보존 evidence

향후 maintainer 가 sunset 추가 검토 시 — 이 두 test 가 *명시 boundary*
역할. silent removal 차단.

**Lock-in**: SSOT 통합 ADR 의 sunset 결정 default — *값 같다 ≠ sunset
가능*. *의미 같다* 인 경우만 sunset. 명시 test lock-in.

### L7 — Engine-level architectural refactor의 user-facing impact = 0

ADR-167 5-step closure 의 사용자 facing 변화 = 0 (internal architectural
quality only). 그러나 미래 maintainer cognitive load 감소, new
plane-equality op 추가 시 SSOT 자명, drift 위험 영구 차단.

**Lock-in**: engine-level architectural refactor 는 사용자 facing 가치
*0* 가 default — 측정 가능한 가치 는 maintainer 시간 절감 + drift 차단.
γ closure 시 사용자 시연 gate (ADR-087 K-ζ) 대신 *architectural
quality gate* (test sweep + build clean + 0 deprecation warnings) 가
canonical.
