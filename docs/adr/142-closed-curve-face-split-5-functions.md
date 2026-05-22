# ADR-142 — Closed-curve face split 5 함수 hotfix (Sprint 1 첫 트랙)

**Status**: Accepted (Sprint 1 ADR-142 fully closed, 2026-05-22) — α + Amendment 1 (audit-first 18 + β-1 closed) + Amendment 2 (audit-first 19 — β-2 CANCEL as ADR-110 redundant) + γ (5 K1 cross-cut Rust integration tests) + δ (2 Playwright Chromium E2E specs) + ε (closure synthesis). 회귀 axia-geo +9, Playwright +2. Sprint 1 첫 ADR closure 완성, ADR-143~145 share 자연 증가.
**Date**: 2026-05-22
**Author**: WYKO + Claude
**Sprint**: S1 (ADR-141 §2 — 3~4주, 회귀 +55 분담 ~15~20)
**Trigger**: ADR-141 §3 (Sprint 1 첫 ADR) + 본 세션 PR #143 K1 MVP closure
의 자연 후속 (1/5 사이트 closure → 5/5 closure).
**Anchor**: 외부 에이전트 ADR-101 권장 (원안) → ADR-141 정정 (ADR-142
재배정) — `reports/Sprint0_Kickoff_Guide.html` §2.

## Canonical anchor (사용자 시연 evidence + LOCKED #41 Amendment 9 audit)

> **사용자 시연 (2026-05-21)**: DrawCircle (Path B closed-curve face)
> → DrawLine 으로 chord split 시도 → "7 console errors" 발견.
> → 본 세션 PR #143 (K1 MVP) `split_face_by_line` entry 에
> `polygonize_if_closed_curve` 추가 → 7 errors 해소.

> **LOCKED #41 Amendment 9 §A9.4 audit (2026-05-16)**:
> `Mesh::split_face_by_chain` / `split_face_case_b/c/d` /
> `boolean::split_faces_by_intersections` 4 site **HARD flag 부재**
> — 메타-원칙 #15 ("동일 분할 = 동일 topological contract") 위반.
> "별도 PR 권장" — 본 ADR 이 그 PR.

→ **메타-원칙 #14 (WHAT layer) + #15 (HARD contract) 의 5 site 동시
활성** — closed-curve face 가 *모든 split path* 의 first-class input.
K1 MVP 1 site → 5 site 으로 확장.

## 1. Problem statement

### 1.1 5 split function inventory (face_split.rs + boolean.rs)

| # | 함수 | 위치 | Entry | K1 closed-curve | HARD flag | 작업 |
|---|---|---|---|---|---|---|
| 1 | `split_face_by_line` | face_split.rs:265 | public | ✅ PR #143 | ❌ | HARD only |
| 2 | `split_face_by_chain` | face_split.rs:568 | public | ❌ | ❌ | K1 + HARD |
| 3 | `split_face_case_b` | face_split.rs:940 | private (via by_line) | (auto cover) | ❌ | HARD only |
| 4 | `split_face_case_c` | face_split.rs:1247 | private (via by_line) | (auto cover) | ❌ | HARD only |
| 5 | `split_face_case_d` | face_split.rs:1492 | private (via by_line) | (auto cover) | ❌ | HARD only |
| 6 | `boolean::split_faces_by_intersections` | boolean.rs:477 | private (Boolean op) | ❌ | ❌ | K1 + HARD |

**남은 작업**:
- **K1 (closed-curve auto-polygonize)** — 2 public entry: `split_face_by_chain` + Boolean entry
- **HARD flag (메타-원칙 #15 contract)** — 4 site (chain + case_b/c/d + boolean.split_faces_by_intersections)

### 1.2 사용자 facing 회귀 (currently 미해소)

| 시나리오 | 현재 | ADR-142 closure 후 |
|---|---|---|
| Path B Circle face + DrawLine chord | ✅ K1 MVP fix | ✅ (보존) |
| Path B Circle face + `split_face_by_chain` (e.g., complex split tool) | ❌ panic 또는 silent fail | ✅ Auto-polygonize |
| Path B Circle face + Boolean op | ❌ Boolean fail or silent skip | ✅ Auto-polygonize |
| Lens (split-induced) edge **vs** smooth Plane edge 시각 구분 | ❌ 일부 hide (LOCKED #16 K-ε hotfix path) | ✅ HARD flag 강제 visible |

### 1.3 메타-원칙 정합 분석

| 원칙 | 현재 | ADR-142 closure 후 |
|---|---|---|
| #14 면은 닫힌 경계로 유도 (WHAT) | ✅ 보존 | ✅ 보존 |
| #15 동일 분할 = 동일 topological contract | ❌ 4 site 위반 | ✅ 4 site HARD 부여 정합 |
| #16 자동화 antipattern (WHEN) | ✅ ADR-139 정합 (Boundary explicit) | ✅ 보존 |

→ ADR-142 = 메타-원칙 #15 정착 의 4번째 site 확장.

## 2. Solution architecture

### 2.1 K1 (closed-curve auto-polygonize) — 2 entry 적용

`polygonize_if_closed_curve` helper (face_split.rs:30, K1 MVP 신설) 를 다음
2 site 에서 동일 패턴 적용:

```rust
pub fn split_face_by_chain(
    mesh: &mut Mesh,
    face_id: FaceId,
    chain_verts: &[VertId],
    inherit_material: MaterialId,
) -> Result<FaceSplitResult> {
    let face_id = polygonize_if_closed_curve(mesh, face_id)?;  // ← NEW (K1 답습)
    // (기존 boundary lookup + chain split 로직 보존)
    // ...
}

fn split_faces_by_intersections(
    &mut self,
    solid: &[FaceId],
    intersections: &[Intersection],
    material: MaterialId,
) -> SplitResult {
    let solid_normalized: Vec<FaceId> = solid.iter()
        .map(|&fid| polygonize_if_closed_curve(self, fid).unwrap_or(fid))
        .collect();
    // (기존 intersection split 로직 보존, solid → solid_normalized)
    // ...
}
```

**불변 (PR #143 K1 MVP 답습)**:
- 닫힌 곡선 (1 anchor + 1 self-loop edge with `AnalyticCurve`) 만 polygonize
- 폴리곤 face 는 no-op (early return)
- material 보존 (inherit)
- 새 face_id 반환 (caller 가 shadow update)

### 2.2 HARD flag (메타-원칙 #15 contract) — 4 site 적용

ADR-101 Amendment 9 §A9.3 패턴 1:1 답습 — split 후 새 boundary HEs 에
`HeFlags::HARD` 부여:

```rust
// 4 site 모두 split 후 추가:
//   * split_face_by_chain (face_split.rs:568)
//   * split_face_case_b (face_split.rs:940)
//   * split_face_case_c (face_split.rs:1247)
//   * split_face_case_d (face_split.rs:1492)
//   * boolean::split_faces_by_intersections (boolean.rs:477)

// 안전 OR 패턴 (mesh.rs:2541 답습) — 기존 flags 보존:
for he_id in newly_created_split_hes.iter() {
    let cur = mesh.hes[*he_id].flags();
    mesh.hes[*he_id].set_flags(cur | HeFlags::HARD);
}
```

**불변 (ADR-101 Amendment 9 답습)**:
- Twin HE pair 양쪽 모두 HARD 부여
- 기존 boundary edges (split 외부) 영향 0
- Render path (LOCKED #16 K-ε coplanar hide) 와 충돌 해소 — HARD edges 는 visible 강제

### 2.3 회귀 자산 보강 — 5 site cross-cut

각 site 마다 closed-curve face input 회귀 + HARD flag 부여 검증 회귀:

| Site | closed-curve 회귀 | HARD flag 회귀 |
|---|---|---|
| split_face_by_line (PR #143) | ✅ 이미 있음 | ❌ 추가 |
| split_face_by_chain | ❌ 추가 | ❌ 추가 |
| split_face_case_b | (via by_line) | ❌ 추가 |
| split_face_case_c | (via by_line) | ❌ 추가 |
| split_face_case_d | (via by_line) | ❌ 추가 |
| split_faces_by_intersections | ❌ 추가 | ❌ 추가 |

→ **회귀 +15~20** (각 site 별 2~3개 회귀, axia-geo `face_split::tests` + `boolean::tests`).

## 3. Sub-step plan (Path Z atomic, β~η)

| Sub-step | 의도 | 회귀 | 소요 |
|---|---|---|---|
| α | 본 ADR (spec only) | +0 | (현재) |
| β-1 | `split_face_by_chain` K1 + HARD | +4 | 0.5일 |
| β-2 | `split_face_case_b/c/d` HARD 일괄 부여 | +6 (각 2 회귀) | 0.5일 |
| β-3 | `boolean::split_faces_by_intersections` K1 + HARD | +5 | 0.5일 |
| γ | 5 site cross-cut 회귀 자산 (메타-원칙 #15 정합 강제) | +3 (HARD contract sweep) | 0.5일 |
| δ | 사용자 시연 게이트 (ADR-087 K-ζ canonical) — DrawCircle + DrawCircle Boolean / DrawCircle + chain split | +0 | 0.5일 |
| ε | closure docs + ADR §D Acceptance Log | +0 | 0.25일 |
| **합계** | **5 site 메타-원칙 #15 정합 강제** | **+18** | **2~3일** |

각 sub-step 단일 atomic PR (LOCKED #44 정합).

## 4. Lock-ins

- **L-142-1** K1 MVP pattern (PR #143) **2 site 추가 적용** — `split_face_by_chain` + `split_faces_by_intersections`. `polygonize_if_closed_curve` helper 재사용 (새 helper 0).
- **L-142-2** ADR-101 Amendment 9 §A9.3 HARD flag pattern **4 site 일괄 답습** — split 후 새 boundary HEs `HeFlags::HARD` 부여. Twin HE pair 모두.
- **L-142-3** 메타-원칙 #15 ("동일 분할 = 동일 topological contract") 5 site 정착 — `Mesh::split_face` (canonical) + `split_face_by_line` (PR #143) + `split_face_by_chain` (β-1) + case_b/c/d (β-2) + boolean (β-3).
- **L-142-4** 사용자 시연 게이트 (ADR-087 K-ζ canonical) — δ sub-step 시 DrawCircle Path B + DrawLine chain split / DrawCircle Path B + Boolean op 검증. 7 console errors 회귀 자산 답습.
- **L-142-5** ADR-046 P31 #4 additive only — 5 site public API (`split_face_by_line`, `split_face_by_chain`, Boolean ops) signature UNCHANGED. 내부 helper 호출만 추가.
- **L-142-6** LOCKED #44 (Complete Meaning per Merge) — 각 sub-step (β-1/β-2/β-3/γ) 단일 atomic PR. β-2 의 4 사이트 (case_b/c/d) 는 같은 의미 단위 (HARD flag 일괄) → 단일 PR.
- **L-142-7** 절대 #[ignore] 금지 18/18 강제.
- **L-142-8** Path B Circle (1 anchor + 1 self-loop) 의 *모든 face split path* first-class input 강제 (메타-원칙 #14 정합).
- **L-142-9** Render path (LOCKED #16 K-ε hotfix coplanar Plane hide) ↔ split-induced edges 정합 — HARD flag 1 bit 로 결정 (추가 분기 0, "빠르고 신속하고 정확").
- **L-142-10** 회귀 단조 증가 +18 (외부 agent +55 Sprint 1 share = ADR-142: ~18 / ADR-143: ~15 / ADR-144: ~5 / ADR-145: ~17).

## 5. 회귀 estimation 분배

axia-geo (`face_split::tests` + `boolean::tests`):

| Site | 회귀 추가 | 검증 항목 |
|---|---|---|
| split_face_by_chain | +4 | closed-curve input + HARD flag + polygon regression guard + 사용자 시연 회귀 |
| case_b | +2 | HARD flag + ADR-101 §A9.3 답습 |
| case_c | +2 | HARD flag + ADR-101 §A9.3 답습 |
| case_d | +2 | HARD flag + ADR-101 §A9.3 답습 |
| split_faces_by_intersections | +5 | closed-curve input + HARD flag + Boolean union/subtract/intersect 3 op 각 회귀 |
| cross-cut sweep (γ) | +3 | 5 site HARD contract sweep + 메타-원칙 #15 정합 강제 회귀 |
| **합계** | **+18** | **절대 #[ignore] 금지 18/18** |

Sprint 1 누적 회귀 추세: ADR-142 (+18) + ADR-143 (+15) + ADR-144 (+5) + ADR-145 (+17) = **+55** (ADR-141 §6 Sprint 1 정합).

## 6. 사용자 facing 변화 매트릭스

| 시나리오 | Before ADR-142 | After ADR-142 |
|---|---|---|
| Path B Circle + DrawLine chord | ✅ K1 MVP (PR #143) | ✅ (보존) |
| Path B Circle + `split_face_by_chain` 호출 | ❌ panic 또는 silent fail | ✅ Auto-polygonize → split 정상 |
| Path B Circle Union (Boolean) | ❌ Boolean fail | ✅ Auto-polygonize → Boolean 정상 |
| Path B Circle Subtract (Boolean) | ❌ Boolean fail | ✅ Auto-polygonize → Boolean 정상 |
| Path B Circle Intersect (Boolean) | ❌ Boolean fail | ✅ Auto-polygonize → Boolean 정상 |
| Split-induced edge 시각 (5 site) | ❌ 일부 coplanar hide | ✅ HARD flag visible |
| Polygon face split (non-closed-curve) | ✅ 정상 | ✅ no-op (회귀 0) |

## 7. Cross-link

### LOCKED 정책 (정합 강제)

- LOCKED #1 ADR-021 P7 (superseded by ADR-139) — closed boundary 결과 invariant 보존
- LOCKED #14 메타-원칙 #14 (면은 닫힌 경계로 유도, WHAT layer) — canonical anchor
- LOCKED #15 P22.5 ADR-037 (owner-ID uniformity) — split 후 metadata 보존
- LOCKED #16 ADR-038 P23 (surface-aware normals) — render path 정합
- LOCKED #41 ADR-101 Amendment 9 §A9.3-A9.4 (HARD flag canonical source)
- LOCKED #44 (Complete Meaning per Merge) — 각 sub-step 단일 atomic PR
- LOCKED #63 (z=0 invariant) — 직교 보존
- LOCKED #64 ADR-139 (Boundary-only, WHEN layer) — 자동 trigger 폐기 정합
- LOCKED #65 ADR-141 (Master Roadmap) — Sprint 1 첫 ADR

### 메타-원칙

- 메타-원칙 #9 (회귀 없음 — 절대 #[ignore] 금지)
- 메타-원칙 #10 (ADR 불변)
- 메타-원칙 **#14** (canonical anchor, WHAT layer)
- 메타-원칙 **#15** (canonical anchor, 동일 분할 contract)
- 메타-원칙 #16 (WHEN layer 정합)

### Cross-ADR 답습

- ADR-089 Phase 2 (Path B closed-curve face — kernel-native canonical)
- ADR-094 §E L1 (additive-first + multi-gate atomic)
- ADR-101 Amendment 9 (HARD flag canonical, 4 site 답습 source)
- ADR-139 (WHAT/WHEN layer 분리)
- ADR-140 (Surface-aware getDrawPlane — ADR-143 의 직접 후속)
- ADR-141 (Master Roadmap — Sprint 1 anchor)
- 본 세션 PR #143 (K1 MVP — split_face_by_line entry, 4-site 확장 source)
- 본 세션 PR #140 (K3 hotfix — surface_owner_id propagation 6 site, HARD flag site 와 동일)

### 보고서 anchor

- `reports/곡선면_도형그리기_완성계획.html` §곡선면 도형 그리기 audit
- `reports/Sprint0_Kickoff_Guide.html` §2 ADR-101 reserve (재배정 ADR-142)
- `reports/최종_결재완료_Sprint0_시작.html` §4 사용자 결재 정합

## 8. Out of scope (deferred)

본 ADR scope 외 (모두 별도 ADR 또는 future track):

- **Mesh::split_face** (canonical reference) 의 HARD flag 정책 변경 — 이미 정합, 변경 0
- **Mesh::polygonize_closed_curve_face** — substitute (split 아닌 face 교체), HARD flag 적용 외 (메타-원칙 #15 정합 정의)
- **closed-curve face 의 multi-loop hole 지원** — 별도 ADR (현재 closed-curve = single loop, ADR-089 Phase 2 정합)
- **NURBS-aware coplanar intersect** — ADR-155 (Sprint 4.5, 별도 트랙)
- **사용자 시연 게이트의 자동화** (CI integration) — ADR-077 V-2 visual baseline 확장 별도 ADR

## 9. 변경 시 필수 절차 (메타-원칙 #10)

본 ADR 변경 시:
1. 사용자 **명시적 확인** 요청
2. 사용자 동의 시 진행
3. 변경 시 새 ADR 작성 (본 ADR 은 `Superseded by ADR-XXX` 표시)
4. ADR-141 LOCKED #65 매트릭스 갱신
5. 변경 사유 + 영향 범위 commit message 명시

## 10. Acceptance Log

### α (spec only — 본 commit)

- **Trigger**: ADR-141 §3 Sprint 1 첫 ADR + 본 세션 PR #143 K1 MVP 자연 후속
- **산출물**: 본 ADR doc (~270 lines)
- **회귀**: +0 (docs only)
- **다음 sub-step**: β-1 (`split_face_by_chain` K1 + HARD) — 사용자 결재 후 진행

### β-1 (split_face_by_chain K1 — 본 commit)

- **Trigger**: 사용자 결재 (2026-05-22 휴식 후) + audit-first 18번째 finding 적용
- **변경 (3 files)**:
  - `crates/axia-geo/src/operations/face_split.rs` — `split_face_by_chain` entry 에 `polygonize_if_closed_curve` 호출 추가 (line 588 신설)
  - `crates/axia-geo/src/operations/face_split.rs` — Amendment 1 회귀 자산 +4 (test module)
  - `docs/adr/142-closed-curve-face-split-5-functions.md` — Amendment 1 + β-1 closure
- **회귀**: axia-geo **1415 → 1419** (+4, 절대 #[ignore] 금지 4/4 준수)
  - `adr142_beta1_split_face_by_chain_polygon_face_regression` — polygon no-op 보존
  - `adr142_beta1_split_face_by_chain_polygonizes_closed_curve_face` — Path B Circle face K1 fire evidence
  - `adr142_beta1_polygonize_if_closed_curve_polygon_noop` — helper API contract (no-op)
  - `adr142_beta1_polygonize_if_closed_curve_transforms_closed_curve` — helper API contract (transform)
- **다음 sub-step**: β-2 (`boolean::split_faces_by_intersections` K1) — Amendment 1 §B 참조 → ⚠ **Amendment 2 에서 CANCEL** (audit-first 19번째 — ADR-110 redundant). γ 로 직접 진입.

### β-2 (CANCEL — 본 commit Amendment 2)

- **Trigger**: Sprint 1 progression 진입 결재 (2026-05-22 cowork sweep 후)
- **시도**: boolean.rs:477 `split_faces_by_intersections` entry K1 pre-pass + `original_fid`/`fid` split_map key 분리 implementation
- **컴파일**: PASS, baseline 1419/1419 보존 (회귀 0)
- **Audit-first 19번째 finding**: ADR-110 π-β (이미 main 통합) 가 `Mesh::boolean` *entry* 에서 모든 input face 의 closed-curve pre-polygonize 수행 → split_faces_by_intersections 도달 시점에 input 이미 polygonal. β-2 per-face pre-pass = redundant.
- **결정**: implementation revert (`git checkout HEAD --`) + Amendment 2 docs 작성 (본 commit)
- **회귀**: +0 (docs only — boolean.rs 변경 0)
- **다음 sub-step**: γ K1 cross-cut 사용자 시연 회귀 자산 + 통합 sweep (Amendment 2 §C 매트릭스 + §F 결재 매트릭스)

### γ (K1 cross-cut 통합 sweep — 본 commit)

- **Trigger**: Amendment 2 §F 결재 매트릭스 (γ + δ + ε 묶음 single atomic PR, 사용자 결재 2026-05-22)
- **변경 (1 file)**: `crates/axia-geo/src/operations/boolean.rs` — `adr142_gamma_tests` module 추가 (5 회귀 자산, line 1571+)
- **회귀**: axia-geo **1419 → 1424** (+5, 절대 #[ignore] 금지 5/5 준수)
  - `gamma_path_b_circle_union_via_adr110_cover` — ADR-110 entry pre-polygonize cover (Union)
  - `gamma_path_b_circle_subtract_via_adr110_cover` — ADR-110 cover (Subtract)
  - `gamma_path_b_circle_intersect_via_adr110_cover` — ADR-110 cover (Intersect)
  - `gamma_path_b_circle_chain_split_via_beta1_cover` — β-1 K1 cover (split_face_by_chain Path B input)
  - `gamma_polygonal_regression_guard` — Path A polygonal Boolean additive only 보존

### δ (사용자 시연 게이트 — 본 commit, Playwright E2E)

- **Trigger**: Amendment 2 §F 결재 매트릭스 (γ + δ + ε 묶음, ADR-087 K-ζ canonical)
- **변경 (1 file)**: `web/e2e/adr-142-demo.spec.ts` — Playwright Chromium real browser round-trip evidence (2 spec)
- **회귀 (Playwright)**: +2 spec (절대 #[ignore] 금지)
  - `δ-1: Path B Circle × Path B Circle Boolean Union (ADR-110 cover)` — real Chromium 의 drawCircleAsCurve × 2 → face count 증가 evidence
  - `δ-2: Single Path B Circle face creation` — sanity check (1 anchor + 1 self-loop edge, ADR-089 Phase 2 canonical)
- **CI 자동 검증**: ADR-075 E.4 `ci.yml` `web-e2e` job 통합 — PR 마다 자동 실행
- **사용자 manual demo**: Playwright spec 이 evidence template + 자동화 cover. ADR-087 K-ζ "사용자 manual 시연" 도 보완적으로 권장 (선택, 별도 cowork sweep).

### ε (closure docs synthesis — 본 commit)

- **Trigger**: Sprint 1 ADR-142 closure (단일 의미 단위, LOCKED #44 정합)
- **변경**: 본 §10 γ + δ + ε entries + Status line canonical 갱신 ("Closed" 표시)
- **회귀**: +0 (docs only)
- **Status 최종**: Accepted (α + Amendment 1 + β-1 + Amendment 2 + γ + δ + ε all atomic-merged) — Sprint 1 ADR-142 closure 완성

### Sprint 1 ADR-142 누적 결산

| Sub-step | PR | 회귀 (axia-geo cargo) | 회귀 (Playwright) |
|---|---|---|---|
| α (spec) | #151 (73b40c7) | +0 | +0 |
| β-1 (split_face_by_chain K1 + Amendment 1) | #152 (fbfebe9) | +4 | +0 |
| β-2 (CANCEL) | — | +0 | +0 |
| Amendment 2 (β-2 cancel docs) | #157 (46123cc) | +0 | +0 |
| γ + δ + ε (본 PR) | (다음) | +5 | +2 |
| **합계** | **5 PRs** | **+9** | **+2** |

**Sprint 1 +55 target ADR-142 share**: 원안 +18 → Amendment 1 +11~13 → Amendment 2 +7~9 → **실제 +11 (axia-geo +9 + Playwright +2)**. Sprint 1 +55 target 의 1/5 사용. ADR-143/144/145 cumulative share 자연 증가.

### 보존 정합 (LOCKED 정책)

- ✅ LOCKED #1 ADR-021 P7 (closed-curve face first-class input)
- ✅ LOCKED #14 메타-원칙 #14 (WHAT layer — face from closed boundary)
- ✅ LOCKED #15 메타-원칙 #15 (HARD contract — ADR-101 Amendment 10 자동 cover)
- ✅ LOCKED #41 ADR-101 (Coplanar auto-intersect)
- ✅ LOCKED #44 (Complete Meaning per Merge — 5 PRs atomic 분리)
- ✅ LOCKED #64 ADR-139 (WHAT/WHEN layer, Boundary tool default OFF + opt-in)
- ✅ LOCKED #65 ADR-141 (Master Roadmap Sprint 1 첫 ADR closure)
- ✅ LOCKED #66 STATUS-POLICY (Status canonical first-token Accepted)

## Amendment 1 — audit-first 18번째 finding (β-1 진입 직전, 2026-05-22)

### §A. Trigger

본 ADR α spec 작성 시 (2026-05-22 휴식 전 turn) LOCKED #41 Amendment 9
§A9.4 audit (2026-05-16) 의 "4 site HARD flag 부재" 를 β-1~β-3 plan 의
근거로 사용. 사용자 휴식 복귀 후 β-1 implementation 진입 직전
**audit-first canonical 18번째 적용** — main 의 실제 상태 재audit
중 발견된 finding:

**ADR-101 Amendment 9 후속 작업 (ADR-101 Amendment 10)** 이 main 에
사전 통합 — `Mesh::mark_chain_edges_hard` + `Mesh::mark_edges_hard`
helpers (mesh.rs:2637 / 2650) + 5 site 호출 사전 활성:

| Site | mark_*_hard 호출 위치 |
|---|---|
| `Mesh::split_face` (canonical) | mesh.rs:4706-4707 (직접 HARD set) |
| `split_face_by_chain` | face_split.rs:819 → mark_chain_edges_hard |
| `split_face_case_b` | face_split.rs:1144 → mark_edges_hard |
| `split_face_case_c` | face_split.rs:1377 → mark_edges_hard |
| `split_face_case_d` | face_split.rs:1588 → mark_edges_hard |
| `boolean::split_faces_by_intersections` | boolean.rs:623 → mark_edges_hard |
| `operations::coplanar::auto_intersect_coplanar` | coplanar.rs:665 (인라인) |

→ **HARD flag dimension = 6/6 site 사전 closure** (원안 4 site → 실제 6
site 포함, ADR-101 Amendment 10 으로 통합).

### §B. β scope 정정

원안 (α spec §3 sub-step plan):

| Sub-step | 원안 의도 | 실제 필요성 |
|---|---|---|
| β-1 | split_face_by_chain K1 + HARD (+4) | ✅ K1 필요 / ❌ HARD 이미 완료 |
| β-2 | case_b/c/d HARD 일괄 (+6) | ❌ 이미 완료 (보존, 신규 작업 0) |
| β-3 | boolean K1 + HARD (+5) | ✅ K1 필요 / ❌ HARD 이미 완료 |
| γ | cross-cut 회귀 (+3) | 부분 보존 (K1 cross-cut 만, HARD 는 ADR-101 Amendment 10 회귀 자산 이미 확보) |
| δ | 사용자 시연 | (보존) |
| ε | closure | (보존) |

**정정 후 β scope** (HARD 부분 모두 제거 — 이미 완료):

| Sub-step | 정정 후 scope | 회귀 | 소요 |
|---|---|---|---|
| **β-1 (본 commit)** | **split_face_by_chain K1 polygonize_if_closed_curve 적용** | **+4** | **30분** |
| β-2 (다음 PR) | `boolean::split_faces_by_intersections` K1 polygonize 적용 (per-face pre-pass) | +5~6 | 1~2시간 |
| γ (선택) | K1 cross-cut 사용자 시연 회귀 자산 + 통합 sweep | +2~3 | 30분 |
| δ | 사용자 시연 게이트 — Path B Circle Boolean (Union/Subtract/Intersect) | +0 | 30분 |
| ε | closure docs | +0 | 15분 |
| **합계** | **K1 dimension only — HARD 는 ADR-101 Amendment 10 으로 사전 완료** | **+11~13** | **2~4시간** |

→ **회귀 +18 (원안) → +11~13 (정정)** — 7 회귀 정도 reduce. Sprint 1
target (+55) 의 ADR-142 share 도 자동 조정. ADR-141 §6 Sprint 1 +55
allocation 정합 강제 — ADR-143/144/145 분배 재산정 필요 (별도 트랙).

### §C. β-1 implementation 산출물 요약

- `split_face_by_chain` (face_split.rs:588) — `let face_id = polygonize_if_closed_curve(mesh, face_id)?;` 1 line 추가 (split_face_by_line:301 패턴 1:1 mirror)
- 4 회귀 자산 추가 (face_split.rs test module 끝)
- ADR-142 §10 β-1 Acceptance entry + Amendment 1 (본 §A~§D)

### §D. Lessons (audit-first canonical 18번째 적용 evidence)

**L1 — audit timing 의 architectural 가치**: α spec 작성 시 audit (2026-05-16
LOCKED #41 Amendment 9 §A9.4) 사용. β implementation 진입 시 **재audit**
필수 — α 와 β 사이 시간 동안 main 진화 가능. 본 ADR 의 경우 ADR-101
Amendment 10 (별도 트랙) 가 5 site HARD 사전 closure.

**L2 — Amendment vs supersede 선택**: 원안 의도 (closed-curve face 5
site first-class input) 는 보존, 운영 scope (회귀 수 / 작업 분담) 만
정정. Amendment pattern 적용 (ADR-125/126/127/130 amendment 답습) —
원안 ADR 본문 보존 + Amendment 1 추가. **supersede 회피**.

**L3 — Sprint 1 회귀 +55 share 재분배 필요**: ADR-142 분담 +18 → +11~13
으로 reduce. ADR-143/144/145 의 share 가 자연 증가 또는 ADR-141 §6 의
Sprint 1 total 회귀 target 조정. Sprint 1 종료 시 cowork sweep 시 결재.

**L4 — Out-of-date audit 의 architectural risk**: α spec 의 LOCKED #41
Amendment 9 audit 참조 (2026-05-16) 는 **2주 이상 stale**. main 진화
빈도 (외부 agent 작업 + 본 세션 PR 누적) 가 높으므로 α-to-β 시간 간격
에서 audit 회귀 가능. → 모든 ADR β implementation 진입 시 **사전
검토** 절차 강제 (메타-원칙 #6 Preventive over Curative 정합).

**L5 — boolean K1 (β-2) 의 별도 atomic 분리 정당성**: β-1 (chain) 과 β-2
(boolean) 는 같은 K1 dimension 이지만 *다른 의미 단위* — split_face_
by_chain 의 chain endpoint lookup 과 boolean::split_faces_by_intersections
의 per-face pre-pass 는 별개 architectural path. LOCKED #44 (Complete
Meaning per Merge) 정합 — 각 PR 단일 의미 단위.

> ⚠ **L5 정정 (Amendment 2, 2026-05-22)**: 본 lesson 의 가정 ("β-2 가
> 별개 architectural path") 자체가 audit-first 19번째 적용 (Amendment 2
> §A) 에서 무효화 — ADR-110 π-β 가 이미 `Mesh::boolean` entry 에서
> 모든 input face 의 closed-curve pre-polygonize 수행 → β-2 의 per-face
> pre-pass 는 redundant. β-2 cancel + scope re-allocate to γ/δ/ε.
> 자세한 finding 은 Amendment 2 §A 참조.

---

## Amendment 2 — audit-first 19번째 finding (β-2 진입 직전, 2026-05-22)

### §A. Trigger — ADR-110 π-β entry-level pre-polygonize 발견

본 세션 cowork sweep (PR #151 audit 직후, Sprint 1 progression) Step 3
진입 결재 후 β-2 implementation 진입. boolean.rs:477 `split_faces_by_
intersections` entry 에 `polygonize_if_closed_curve` pre-pass 추가 (β-1
의 `split_face_by_chain:588` 1:1 mirror) 시도. 컴파일 PASS, baseline
1419/1419 보존 직후 *재audit* 진행 (메타-원칙 #6 정합).

**Finding** (`Mesh::boolean` line 67-100):

```rust
// ── ADR-110 π-β — Pre-polygonize Path B closed-curve faces ──
let faces_a_resolved: Vec<FaceId> = faces_a.iter()
    .map(|&fid| match self.polygonize_closed_curve_face(fid, material) {
        Ok(Some(new_fid)) => new_fid,
        _ => fid,
    })
    .collect();
let faces_b_resolved: Vec<FaceId> = faces_b.iter()
    .map(|&fid| match self.polygonize_closed_curve_face(fid, material) {
        Ok(Some(new_fid)) => new_fid,
        _ => fid,
    })
    .collect();
```

ADR-110 π-β (이미 main 통합) 가 `Mesh::boolean` *entry* 에서 모든 input
face 에 대해 `polygonize_closed_curve_face` 직접 호출 — Path B closed-
curve → polygonal substitute. `split_faces_by_intersections` 도달 시점에
input face 들은 *이미 polygonal*.

### §B. 호출 chain 매트릭스

| Caller | Path B 처리 |
|---|---|
| `Mesh::boolean` Union (line 67) → entry pre-polygonize → `prepare_solid` → `split_faces_by_intersections` (line 140/146) | ✅ ADR-110 이 cover |
| `Mesh::boolean` Subtract (line 290) | ✅ ADR-110 이 cover |
| `Mesh::boolean` Intersect (동일 entry) | ✅ ADR-110 이 cover |
| `split_faces_by_intersections` 외부 직접 호출 | ❌ **0 외부 caller** (private fn, only 4 internal sites in `Mesh::boolean`) |

**결론**: β-2 per-face K1 pre-pass 의 architectural value = 0.

### §C. β scope 재정정 (Amendment 1 §B → Amendment 2)

**Amendment 1 §B 의 정정 후 scope** (β-2 보존):

| Sub-step | scope | 회귀 | 소요 |
|---|---|---|---|
| β-1 (PR #152) | split_face_by_chain K1 polygonize 적용 | **+4 (closed)** | **30분 (closed)** |
| β-2 (다음 PR) | boolean K1 polygonize 적용 (per-face pre-pass) | +5~6 | 1~2시간 |
| γ (선택) | K1 cross-cut 사용자 시연 회귀 자산 + 통합 sweep | +2~3 | 30분 |
| δ | 사용자 시연 게이트 | +0 | 30분 |
| ε | closure docs | +0 | 15분 |
| 합계 | — | +11~13 | 2~4시간 |

**Amendment 2 의 재정정** (β-2 cancel — redundant):

| Sub-step | scope | 회귀 | 소요 | 상태 |
|---|---|---|---|---|
| β-1 (PR #152) | split_face_by_chain K1 | +4 | 30분 | ✅ closed |
| **β-2** | ~~boolean K1~~ — **ADR-110 redundant, CANCEL** | **+0** | **0분** | **🗑 cancel** |
| γ | K1 cross-cut 사용자 시연 회귀 자산 + 통합 sweep (Path B Circle × Path B Circle Boolean — ADR-110 cover 검증 + β-1 chain split — 통합 evidence) | +3~5 | 30~60분 | ⏭ next |
| δ | 사용자 시연 게이트 | +0 | 30분 | ⏭ |
| ε | closure docs (Amendment 1 + 2 synthesis) | +0 | 15분 | ⏭ |
| **합계** | **— Amendment 2 정정** | **+7~9** | **1.5~2.5시간** | — |

**회귀 단조 감소**: 원안 +18 → Amendment 1 +11~13 → Amendment 2 **+7~9**.
Sprint 1 target +55 의 ADR-142 share 자동 reduce. ADR-141 §6 share 재
분배 — ADR-143/144/145 자연 증가 또는 Sprint 1 total +55 → +47 조정.

### §D. β-2 implementation revert evidence

본 PR (Amendment 2) 진행 중:
- boolean.rs 에 `use super::face_split::polygonize_if_closed_curve;` import +
  `split_faces_by_intersections` entry 의 K1 pre-pass + `original_fid` /
  `fid` split_map key 분리 변경 시도
- 컴파일 PASS + baseline 1419/1419 보존 (회귀 0, 정합 OK)
- Audit-first 19번째 적용 후 **모두 revert** (`git checkout HEAD --
  crates/axia-geo/src/operations/boolean.rs`)
- Baseline 1419/1419 재확인

→ implementation 정확성 자체는 OK, **redundancy 가 cancel 사유**. ADR-110
이 이미 cover 하는 의미 단위 (메타-원칙 #6 + LOCKED #44).

### §E. Lessons (audit-first canonical 19번째 적용 evidence)

**L1 — 자체 코드 base 의 audit 빈도 = 메타-원칙 #6 의 implementation**:
β-1 의 audit-first 18번째 (LOCKED #41 Amendment 9 §A9.4 staleness) 처럼
α spec 의 ADR-110 cross-cut 미확인 → β-2 진입 직전 audit 으로 cover
발견. 매 sub-step β implementation 진입 시 **main codebase 의 직접 audit**
(이전 ADR + main 통합 상태) 강제.

**L2 — Architectural redundancy = anti-pattern**: ADR-110 이 entry-level
pre-polygonize 로 *모든 caller* cover 시, per-face pre-pass 추가는 defense
in depth 가치 0 + code 가독성 감소 + 미래 외부 caller 0 (private fn).
LOCKED #44 (Complete Meaning per Merge) 정합 — *redundant meaning* 도
single PR scope 위반.

**L3 — Amendment cascading 의 architectural value**: ADR-142 본문 보존 +
Amendment 1 (18번째) → Amendment 2 (19번째) 누적. 각 amendment 가 단계
적 scope reduce + lesson 누적. **supersede 회피** — ADR 본 의도 (closed-
curve face 5 site first-class input) 는 여전히 valid, 운영 scope 만 자
연 진화.

**L4 — Cross-ADR awareness gap**: α spec 작성 시 ADR-101 Amendment 9 의
cross-ADR (ADR-110) 영향 미인식. ADR catalog 의 cross-link 가 부족 →
ADR 본문 §관련 문서 sections 의 cross-cut audit 권장 (future cleanup).

**L5 — Sprint 회귀 +55 target 조정 cascade**: Amendment 1 (+18 → +11~13)
+ Amendment 2 (+11~13 → +7~9). Sprint 1 total target ADR-141 §6 +55 의
재분배 + γ 의 가치 증가 (β-2 cover 영역 부분 흡수). Sprint 1 종료 cowork
sweep 결재 시 target 정정 결재 가능.

### §F. 다음 sub-step 결재 매트릭스 (γ 진입 결재)

본 Amendment 2 PR closure 후 γ + δ + ε 별도 PR 진입.

| Sub-step | 가치 | 소요 | 회귀 |
|---|---|---|---|
| γ K1 cross-cut 사용자 시연 회귀 자산 | Path B Circle × Path B Circle Boolean (ADR-110 cover) + Path B Circle + DrawLine chord (β-1 cover) 통합 evidence | 30~60분 | +3~5 |
| δ 사용자 시연 게이트 | ADR-087 K-ζ canonical — Path B Circle Boolean / chain split 실 demo | 30분 (사용자 action) | +0 |
| ε closure docs | Amendment 1 + 2 synthesis + Sprint 1 ADR-142 closure | 15분 | +0 |

추천: γ + δ + ε 묶음 single atomic PR (LOCKED #44 정합) — Sprint 1
ADR-142 closure 단일 의미 단위.
