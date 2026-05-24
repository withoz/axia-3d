# ADR-144 — Step 4.65 Silent Dissolve 회귀 자산 Sweep (PR #144 이어서)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-24
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap S1) 의 ADR-144 reserve.
PR #144 (`b3cfbf4`, 2026-05-23) hotfix 의 자연 후속 — silent dissolve
guard 의 회귀 자산 영역 확장 (현재 2 시나리오 → 12-15 시나리오).
**Sprint**: S1 (ADR-141 §3 — 3~4주, 회귀 +55 share ~10-15)

## Canonical anchor

> 보고서 audit (외부 에이전트, 사용자 공유 2026-05-23): `scene.rs:2905`
> 의 `let _ = self.mesh.remove_face(fid)` silent discard → 사용자 face
> 사라짐 잠재 위험. PR #144 (b3cfbf4) hotfix 후 회귀 자산 빈틈 해소.

PR #144 hotfix 의 architectural guarantee 를 회귀 자산 sweep 으로 영구
보존. silent dissolve 의 모든 trigger 시나리오를 cover.

## 1. Problem statement

### 1.1 PR #144 hotfix 요약 (이미 main 통합)

`crates/axia-core/src/scene.rs:2912-2922` 의 Step 4.65 dissolve 분기:

```rust
if let Err(e) = self.mesh.remove_face(fid) {
    let _ = e;  // future telemetry hook
}
if self.mesh.faces.contains(fid) {
    self.mesh.faces.remove(fid);  // fallback direct remove
}
```

**기존 회귀 자산 (2 시나리오, PR #144 통합)**:
1. `p2_step_4_65_surrounded_dissolve_no_silent_total_dissolve` —
   outer 가 4 inner 로 surround 시 active face count >= 1 (silent total
   dissolve 차단)
2. `p2_step_4_65_disjoint_inner_preserves_outer` — disjoint inner 시
   outer 보존 (dissolve 잘못 fire 차단)

### 1.2 회귀 자산 빈틈 (본 ADR sweep scope)

PR #144 의 2 회귀 자산 외 추가 trigger 시나리오:

| # | 시나리오 | 회귀 risk | 우선순위 |
|---|---|---|---|
| 1 | Partial overlap dissolve (outer ∩ inner) | partial dissolve 잘못 fire | High |
| 2 | Multi-level nested (3 concentric) | middle level silent dissolve | High |
| 3 | L-shape inner arrangement | 비-rectangular surround 판정 | Medium |
| 4 | Coincident outer/inner (동일 위치) | self-dissolve 조건 검증 | Medium |
| 5 | Concentric (multiple inner 동심) | nested surround chain | Medium |
| 6 | 3×3 grid stress (9 inner cells) | mass dissolve 회귀 baseline | High |
| 7 | T-shape arrangement | 비대칭 surround edge case | Low |
| 8 | Edge-touching adjacent (corner shared) | manifold edge dissolve | Medium |
| 9 | Outer larger than mesh boundary | empty mesh dissolve | Low |
| 10 | Single inner (1 → 1) baseline | minimum case 회귀 | Medium |

### 1.3 메타-원칙 정합 분석

| 원칙 | 정합 |
|---|---|
| #6 Preventive over Curative | ✅ 회귀 자산 sweep |
| #9 회귀 없음 | ✅ 추가 회귀 자산 + 절대 #[ignore] 금지 |
| #14 WHAT 결과 invariant | ✅ active face count >= 1 invariant |
| LOCKED #1 P7-N (Non-Manifold) | ✅ 인접 inner NM expected (focus 아님) |
| LOCKED #44 Complete Meaning per Merge | ✅ 각 β sub-step single atomic PR |
| LOCKED #65 Sprint 1 ADR-144 reserve | ✅ ADR-141 reserve table 정합 |
| LOCKED #66 Status canonical | ✅ "Proposed (α spec)" 정합 |

## 2. Solution architecture

### 2.1 회귀 자산 분배 (10 시나리오 → 6 sub-step)

같은 위상 카테고리 묶음 (LOCKED #44 정합):

- **β-1**: Partial overlap + Single inner baseline (overlap topology 2개)
- **β-2**: Multi-level nested + Concentric (concentric topology 2-3개)
- **β-3**: L-shape + T-shape (non-rectangular topology 2개)
- **β-4**: Edge cases — Coincident + Edge-touching + Empty mesh (3개 edge case)
- **β-5**: 3×3 grid stress (mass dissolve baseline, 단독 회귀 + benchmark)
- **γ**: Cross-cut audit + closure docs

### 2.2 회귀 자산 pattern (PR #144 1:1 답습)

```rust
#[test]
fn p2_step_4_65_<scenario_name>_<invariant>() {
    let mut scene = Scene::new();

    // Setup: DrawRect commands per scenario
    scene.execute(Command::DrawRect { ... });
    // ... (additional inner/overlap rects per scenario)

    // **P2 핵심 invariant**: silent total dissolve 차단
    let active = scene.mesh.faces.iter()
        .filter(|(_, f)| f.is_active()).count();
    assert!(active >= 1,
        "P2 (<scenario>): active face count >= 1; got {}", active);

    // **(시나리오별) 추가 invariant**: 의도된 face 개수 + topology
    assert_eq!(active, expected, "<scenario> expected {} active", expected);
}
```

### 2.3 회귀 자산 추정

| Sub-step | 회귀 자산 추가 | 비용 |
|---|---|---|
| α | 0 (본 spec) | ~30분 |
| β-1 | +2 (partial overlap + single inner) | ~1시간 |
| β-2 | +2-3 (nested + concentric) | ~1시간 |
| β-3 | +2 (L-shape + T-shape) | ~1시간 |
| β-4 | +3 (coincident + edge-touching + empty) | ~1.5시간 |
| β-5 | +1-2 (3×3 grid + benchmark) | ~1시간 |
| γ | 0 (closure docs) | ~30분 |
| **합계** | **+10-12** | **~6-7시간 (3일 estimate 정합)** |

ADR-141 share +55 의 ~10-12 = 18-22% (Sprint 1 share table 정합).

## 3. Lock-ins

- **L-144-1** PR #144 hotfix code 보존 (let _ guard + fallback path,
  scene.rs:2912-2922). 본 ADR 은 회귀 자산 only — Rust code 변경 0.
- **L-144-2** 본 sweep 의 모든 test 가 `p2_step_4_65_*` 명명 규칙 답습.
  PR #144 의 기존 2 test 와 같은 module + 같은 pattern.
- **L-144-3** LOCKED #1 P7-N (Non-Manifold By Design) 정합 — 인접 inner
  시 non-manifold edges 발생은 expected, dissolve guard test 의 focus
  아님 (별도 ADR-151 가 P7-N closure 영역).
- **L-144-4** 절대 #[ignore] 금지 — 모든 신규 회귀 자산 enabled. CI
  PR 마다 자동 검증.
- **L-144-5** LOCKED #44 (Complete Meaning per Merge) — 각 β sub-step
  은 위상 카테고리 묶음 (overlap / concentric / non-rectangular / edge
  / stress) single atomic PR.
- **L-144-6** LOCKED #66 (ADR-164 Sunset Policy) Status canonical —
  α "Proposed" / γ closure 시 "Accepted".
- **L-144-7** 사용자 facing 변화 0 — 회귀 자산 only, runtime 영향 없음.

## 4. Out of scope (별도 ADR)

- Step 4.65 logic 자체 변경 (alternative dissolve criterion) — 별도
  architectural ADR
- 다른 Step (4.6 / 4.7 / 4.8 / 4.9) silent guard sweep — 별도 ADR
  per Step
- ADR-151 (Connected Stacked-inner Component-Merge Resolver) 의
  P7-N closure 영역 — 본 ADR 과 직교 (별도 LOCKED #65 reserve)
- Performance benchmark 정량 lock — 본 ADR 은 invariant only
  (별도 perf ADR)

## 5. Cross-link

- PR #144 (`b3cfbf4`, 2026-05-23) — hotfix source (let _ guard)
- 기존 회귀 자산 (PR #144) — `scene.rs:15065-15100` (2 tests)
- LOCKED #1 P7-N (Non-Manifold By Design)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #65 (ADR-141 Master Roadmap — Sprint 1 ADR-144 reserve)
- LOCKED #66 (ADR-164 Sunset Policy — Status canonical)
- 메타-원칙 #6 (Preventive over Curative)
- 메타-원칙 #9 (회귀 없음)
- 메타-원칙 #14 (WHAT 결과 invariant)

## 6. Sub-step roadmap

| Sub-step | Scope | 회귀 추가 | 비용 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) | 0 | ~30분 |
| **β-1** | Partial overlap + Single inner baseline | +2 | ~1시간 |
| **β-2** | Multi-level nested + Concentric | +2-3 | ~1시간 |
| **β-3** | L-shape + T-shape | +2 | ~1시간 |
| **β-4** | Edge cases (coincident + edge-touching + empty) | +3 | ~1.5시간 |
| **β-5** | 3×3 grid stress | +1-2 | ~1시간 |
| **γ** | Closure docs (Status Accepted + §9 Lessons) | 0 | ~30분 |

각 sub-step single atomic PR (LOCKED #44). β 시작 결재 시 본 spec
sub-step plan 답습.

## 7. Acceptance Log

- **2026-05-24 α** (PR #165, fbf5791) — α spec + sub-step plan + lock-ins.
- **2026-05-24 β-1** (PR #166, 5cc8699) — Partial overlap + Single inner
  baseline. 2 신규 회귀 자산 (`p2_step_4_65_partial_overlap_preserves_outer`
  + `p2_step_4_65_single_inner_baseline`).
- **2026-05-24 β-2** (PR #167, 294f56a) — Multi-level nested + Concentric.
  2 신규 회귀 자산 (multi_level_nested_preserves_middle + concentric_chain).
- **2026-05-24 β-3** (PR #168, 1dee4d0) — L-shape + T-shape inner
  arrangement. 2 신규 회귀 자산 (l_shape_inner + t_shape_inner).
- **2026-05-24 β-4** (본 commit) — Edge cases (coincident + edge-
  touching + empty mesh). `crates/axia-core/src/scene.rs` tests module
  에 3 신규 회귀 자산 추가:
  - `p2_step_4_65_coincident_outer_inner_no_silent_total_dissolve` —
    outer 10×10 + inner 10×10 정확 coincident (boundary fully matched).
    surround criterion 즉시 충족 case, dedup 또는 dissolve OK, 단
    silent total dissolve 차단. active >= 1.
  - `p2_step_4_65_edge_touching_corner_preserves_both` — outer 10×10
    at origin + inner 5×5 at (7.5,7.5) corner shared at (5,5).
    boundary disjoint (corner 한 점 touch) → surround false-positive
    차단. active >= 1.
  - `p2_step_4_65_empty_mesh_no_panic` — Scene::new() 만, no DrawRect.
    Step 4.65 trigger 미호출 + empty mesh state invariants 검증.
    active == 0 정합, verify_face_invariants 미위반.
  누적: PR #144 (2) + β-1 (2) + β-2 (2) + β-3 (2) + 본 β-4 (3) =
  **11 회귀 자산** (sweep target +10-12 의 **92%**). degenerate /
  trivial / boundary edge cases coverage 완료.
- **(β-5 + γ, ~2시간)** — 3×3 grid stress + closure docs.

---

**다음 trigger**: β-5 진입 결재 (3×3 grid stress, ~1시간 + γ closure docs ~30분)
또는 우선순위 priority track 결정.
