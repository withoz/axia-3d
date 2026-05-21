# ADR-142 — Closed-curve face split 5 함수 hotfix (Sprint 1 첫 트랙)

**Status**: α spec (β implementation 별도 사용자 결재 후 진행)
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

### β ~ η Acceptance (향후 작성)

각 sub-step 종료 시 본 §10 에 추가 entry 작성 — commit hash + 산출물 +
회귀 카운트 + 사용자 시연 evidence (해당 시).
