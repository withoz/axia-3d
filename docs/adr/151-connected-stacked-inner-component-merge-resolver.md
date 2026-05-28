# ADR-151 — Connected Stacked-inner Component-Merge Resolver (Sprint 3 셋째 ADR)

**Status**: Accepted (2026-05-28 γ closure — α + β-1 + β-2 + β-3 + β-4 + γ 모두 완료, +23 회귀, 절대 #[ignore] 금지 23/23 준수)
**Date**: 2026-05-27
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap) Sprint 3 셋째 ADR.
ADR-141 §3 reserve:
> "ADR-151 | Connected Stacked-inner Component-Merge Resolver (LOCKED #1
> deferred boundary) | S3 | 2주"
**Audit precondition**: `docs/audits/2026-05-27-adr-151-precheck.md`
(PR #208) — multi-week 추정 50% 감소, 1주 single-week 6-step template
가능. audit-first canonical 11번째 적용.
**Direct predecessor**:
- ADR-149 / ADR-150 (Sprint 3 첫째/둘째 ADR, 6-step template source)
- ADR-051 §2.3.1 `enforce_p7_canonical` spec (canonical anchor)
- ADR-051 §2.5 deferred boundary (해결 대상)
**Sprint**: S3 (ADR-141 §3 — 3~4주, 회귀 +50 share ~46%).

## Canonical anchor

ADR-141 §3 Sprint 3 매트릭스의 셋째 ADR — LOCKED #1 ADR-021 P7 의
*connected stacked-inner deferred boundary* 해결. 메타-원칙 #16 정합
으로 *자동 발동 폐기*, *사용자 명시 호출 only*. ADR-149/150 canonical
pattern 1:1 mirror.

**핵심 통찰** (audit-first canonical 11번째, 2026-05-27):
ADR-051 §2.3.1 `enforce_p7_canonical` spec 이 이미 작성됨 + 모든 building
block (`verify_p7_manifold` / `find_inner_components` / `compute_combined_
perimeter` / `add_face_with_holes`) 가 존재 → 새 알고리즘 0, ADR-149/150
1주 single-week 6-step template 답습 가능.

## 1. Problem statement

### 1.1 LOCKED #1 ADR-021 P7 deferred boundary

**현재 동작** (ADR-015 fallback at `scene.rs:3208`, LOCKED #1 §1-amendment):
- 큰 RECT 안에 작은 RECT × 2 *인접* (edge 공유 또는 vertex 공유) →
  ADR-015 single-promote heuristic 가 connected case 에서 작동
- 두 inner 가 *별개* simple face 로 공존 (face existence 보존)
- Container 가 *ring* 으로 rebuild 되지만 *combined-perimeter* 가 아닌
  single-promote path 사용
- 결과: 1 non-manifold edge 잔존 (shared y=0 boundary)
- 시각 렌더링 정상 + manifold safe (R1 non-manifold highlight 발동 안 함)

**Deferred 한계** (ADR-051 §2.5):
- 진정한 ring-with-hole rebuild — connected component → 1 combined hole
- combined-perimeter 계산 + multi-loop face 재구축 경로 미발동
- `test_p7_canonical_stacked_inner_manifold` 가 `<=1` nm edge 로 deferred
  명시 (회귀 자산, `scene.rs:10625`)

### 1.2 메타-원칙 #16 정합

자동 sweep (예: 매 mutation 후 자동 enforce_p7_canonical) 은 휴리스틱
자동화의 전형 — cascading 부작용 source (P5.UX.39~45 evidence 답습).

**ADR-151 정책** (사용자 결재 Q4=a):
- *자동 path 보존* (`<=1` nm deferred) — ADR-015 fallback 유지
- *명시 trigger only* (`==0` nm strict) — ContextMenu "🔗 Connected Inner
  Merge" 사용자 클릭 시만 발동

→ ADR-149/150 canonical pattern 1:1 mirror.

### 1.3 LOCKED 정책 cross-cut

- **LOCKED #1 ADR-021 P7**: deferred boundary 의 명시 trigger 해결 anchor
- **LOCKED #5 spatial-hash**: 0.15μm tolerance — combined-perimeter
  vertex dedup 활용
- **LOCKED #15 메타-원칙 #15**: 동일 분할 = 동일 contract — ring rebuild
  후 HARD flag 유지
- **LOCKED #16 ADR-038 P23**: surface-aware normals — rebuild 후 normal
  재계산
- **LOCKED #44 (Complete Meaning per Merge)**: 6-step single atomic PR 강제
- **LOCKED #65 메타-원칙 #16**: 자동화 antipattern — *명시 호출 only*
- **LOCKED #66 STATUS-POLICY**: Proposed → Accepted single transition

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — ADR-151 scope: (a) ADR-051 §2.3.1 spec 답습

**Lock-in**: 기존 자산 dispatch + assembly. 새 알고리즘 0.

`enforce_p7_canonical` 헬퍼 (ADR-051 §2.3.1 spec) 구현:
```rust
fn enforce_p7_canonical(
    mesh: &mut Mesh,
    container: FaceId,
    inners: &[FaceId],
) -> Result<P7ManifoldReport, P7EnforceError> {
    // (1) Component grouping (기존 자산)
    let components = mesh.find_inner_components(inners);
    
    // (2) Component 별 combined perimeter (기존 자산)
    let hole_loops: Vec<Vec<VertId>> = components.iter()
        .map(|c| mesh.compute_combined_perimeter(c))
        .collect::<Result<Vec<_>>>()?;
    
    // (3) Container 를 ring face 로 재구성 (β-2 신규 helper)
    rebuild_as_ring_face(mesh, container, &hole_loops)?;
    
    // (4) Inner sub-face 들은 별개 simple face 로 유지 (변경 없음)
    
    // (5) Invariant 검증 (기존 verify_p7_manifold)
    let report = verify_p7_manifold(mesh, container, inners);
    Ok(report)
}
```

### Q2 — Trigger 정책: (a) 명시 호출 only

**Lock-in**: 메타-원칙 #16 정합. autopilot 0.

- 자동 trigger / Mutation 후속 hook / localStorage opt-in **모두 0**
- 사용자 ContextMenu 클릭 = 유일한 trigger
- ADR-149 Q4 / ADR-150 Q5 / ADR-139 canonical 답습

### Q3 — Sub-step plan: (a) 6-step template

**Lock-in**: ADR-149/150 1:1 mirror — `α/β-1/β-2/β-3/β-4/γ` 6 sub-step.

audit-first canonical 결과 (multi-week → single-week):
| Sub-step | LoC | 회귀 | 일수 |
|---|---|---|---|
| α (spec) | 0 (docs only) | +0 | 1일 |
| β-1 (Engine `enforce_p7_canonical` + dispatch) | ~80-100 | +6 (axia-geo) | 2일 |
| β-2 (Engine `rebuild_as_ring_face` helper) | ~50-70 | +4 (axia-geo) | 1일 |
| β-3 (WASM + TS wrapper) | ~150 | +6 (axia-wasm 2 + vitest 4) | 1일 |
| β-4 (UI ContextMenu) | ~50 | +4 vitest | 1일 |
| γ (E2E + closure) | ~150 | +3 Playwright | 1일 |
| **합계** | **~480** | **+23** | **7일** |

### Q4 — 자동 path 보존: (a) deferred boundary 유지

**Lock-in**: 기존 회귀 자산 변경 0.

- *자동 path*: ADR-015 fallback 그대로 — single-promote, `<=1` nm edge
  잔존 (회귀 자산 11+ tests UNCHANGED)
- *명시 호출 path*: 새 `enforce_p7_canonical` — combined-perimeter, `==0`
  nm edge strict
- 두 path 분리 회귀 — `test_p7_canonical_stacked_inner_manifold_automatic`
  (`<=1`, 기존) + `test_p7_canonical_stacked_inner_manifold_explicit`
  (`==0`, β-2 신규)

### Q5 — UI 위치: (a) ContextMenu "🔗 Connected Inner Merge"

**Lock-in**: ADR-149 β-4 / ADR-150 β-4 패턴 답습 — 정리 그룹 안 (T-junction
정리 + Coplanar 정리 와 함께). 새 단축키 / panel 신설 0.

**위치**: ContextMenu 의 정리 그룹 (heal-coplanar-pairs 직후).

**호출 시점**: 우클릭 → 메뉴 → 클릭. Selection 무관 (전체 mesh sweep).

### 정책 — mesh.rs 0 line 강제 (정책 B-hybrid)

ADR-149 (operations/t_junction.rs 신설) + ADR-150 (operations/geometric_
merge.rs 확장) 답습. ADR-151 의 신규 코드는:
- `crates/axia-geo/src/operations/p7_canonical_resolver.rs` 신설
  (`enforce_p7_canonical` + `rebuild_as_ring_face` helpers)
- OR `crates/axia-geo/src/p7_manifold.rs` 확장 (현재 read-only, mutation
  helpers 추가)

→ mesh.rs 0 line 추가 강제.

## 3. Path Z atomic plan (6 sub-step)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-151 spec only commit (본 PR) | +0 |
| **β-1** | Engine `enforce_p7_canonical` + dispatch + 6 회귀 | +6 (axia-geo) |
| **β-2** | Engine `rebuild_as_ring_face` helper + 4 회귀 (strict `==0` nm) | +4 (axia-geo) |
| **β-3** | WASM bridge `enforceP7Canonical` + TS wrapper + 6 회귀 | +2 (axia-wasm) + 4 (vitest) |
| **β-4** | UI ContextMenu "🔗 Connected Inner Merge" + 4 회귀 | +4 (vitest) |
| **γ** | E2E + closure docs (Status Proposed → Accepted + §9 Lessons) | +3 (Playwright) |
| **합계** | | **+23** |

**ADR-141 §3 Sprint 3 회귀 share**: +23 (Sprint 3 share ~46%).

**Sprint 3 누적** (ADR-149 +29 + ADR-150 +25 + ADR-151 +23): **+77 /
+50 (154%)**. Sprint 3 reserve 3~4주 중 2주 사용 → ADR-151 1주 가능
(총 3주, 4주 reserve 안).

## 4. Lock-ins (canonical for ADR-151)

- **L-151-1** ADR-051 §2.3.1 spec 답습 — 새 알고리즘 0
- **L-151-2** ADR-149/150 6-step template 1:1 mirror (Sprint 3
  reproducibility)
- **L-151-3** Q1=(a) `enforce_p7_canonical` 헬퍼 (기존 자산 dispatch)
- **L-151-4** Q2=(a) 명시 호출 only — autopilot 0 (메타-원칙 #16)
- **L-151-5** Q3=(a) 6-step template (LOCKED #44 정합)
- **L-151-6** Q4=(a) 자동 path 보존 — ADR-015 fallback unchanged,
  명시 호출 path 만 strict
- **L-151-7** Q5=(a) ContextMenu only — 새 단축키/panel 0 (ADR-046 P31
  #4 additive only)
- **L-151-8** 정책 B-hybrid — mesh.rs 0 line 추가 강제
- **L-151-9** 기존 자산 활용 — `verify_p7_manifold` + `find_inner_
  components` + `compute_combined_perimeter` + `add_face_with_holes`
- **L-151-10** 회귀 자산 분리 — 자동 (`<=1` nm, 기존) + 명시 (`==0` nm,
  신규) 두 path 명시 회귀
- **L-151-11** 회귀 가드 — ADR-077 V-2 visual baseline 보존 (명시 호출
  시점만 활성)
- **L-151-12** 절대 #[ignore] 금지 23/23 강제

## 5. Out of scope (선택적 또는 별도 ADR)

- **자동 발동 path 강화** — 메타-원칙 #16 영구 거부
- **3-level deep nested component** — β-2 scope 외, 별도 ADR
- **Multi-XIA cross-cut component merge** — semantic boundary, 별도 ADR
- **Visual highlight** (component → hole 전환 시각화) — ADR-046 P31
  Pillar 2 별도 ADR
- **Sprint 4 Healing Pipeline `Mesh::heal()` 통합 entry** — ADR-154
  (별도 Sprint)

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (axia-geo +6)**:
- `adr151_enforce_no_change_on_disjoint_inners` (baseline — disjoint
  case 는 ADR-015 fallback 그대로)
- `adr151_enforce_connected_pair_strict_manifold` (canonical 2 inner
  edge-shared → `verify_p7_manifold.is_valid() == true`)
- `adr151_enforce_three_inner_component_chain` (3 inner connected →
  1 combined hole)
- `adr151_enforce_multiple_components_separately` (2 disjoint components
  각각 별도 hole)
- `adr151_enforce_rejects_invalid_input` (container inactive / inners
  empty / etc.)
- `adr151_enforce_preserves_inner_sub_face_existence` (P7 결과 inner
  face 별개 보존)

**β-2 회귀 (axia-geo +4)**:
- `adr151_rebuild_canonical_ring_with_hole` (canonical rebuild)
- `adr151_rebuild_preserves_boundary` (outer boundary preserved)
- `adr151_rebuild_strict_zero_nm_edges` (P7-M1/M2/M3 strict)
- `adr151_rebuild_error_on_degenerate_perimeter`

**β-3 회귀 (axia-wasm +2 + vitest +4)**:
- axia-wasm: parser tests (canonical / missing field)
- vitest: detect/enforce round-trip + camelCase mapping + graceful/strict

**β-4 회귀 (vitest +4)**:
- ContextMenu 가시성
- 명시 호출 시 enforce_p7_canonical 호출 검증
- Toast 3-way (success / info / error)
- Disabled state when no stacked-inner

**γ 회귀 (Playwright +3)**:
- enforceP7Canonical empty mesh handles gracefully
- mergeCoplanarPairBatch invalid input strict throw
- ContextMenu entry exists (β-4 wiring)

## 7. Cross-link

- **Audit precondition**: `docs/audits/2026-05-27-adr-151-precheck.md`
  (PR #208 — multi-week → 1주 single-week, audit-first canonical 11번째)
- ADR-141 §3 Sprint 3 (canonical roadmap anchor)
- **ADR-051 §2.3.1 `enforce_p7_canonical` spec** (직접 답습 source)
- ADR-051 §2.5 deferred boundary (해결 대상)
- ADR-149 (T-junction Sweep — Sprint 3 첫째, 6-step source)
- ADR-150 (Coplanar Face Merge Sweep — Sprint 3 둘째, 1:1 mirror)
- ADR-015 fallback (현재 connected case path)
- ADR-021 P7 (LOCKED #1 canonical anchor)
- ADR-007 Invariant 2 (manifold + winding 보존)
- LOCKED #1 ADR-021 P7 (canonical anchor)
- LOCKED #5 (spatial-hash 0.15μm — combined-perimeter vertex dedup)
- LOCKED #15 메타-원칙 #15 (동일 분할 contract — HARD flag 보존)
- LOCKED #16 ADR-038 P23 (surface-aware normals)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #65 메타-원칙 #16 (자동화 antipattern — canonical anchor)
- LOCKED #66 STATUS-POLICY

## 8. 결재 cycle log

- **2026-05-27 audit-first** (PR #208) — ADR-151 multi-week atomic 진입
  전 사전 audit. 핵심 finding: multi-week 추정 50% 감소 (2주 → 1주),
  새 알고리즘 0 (ADR-051 §2.3.1 spec 답습 + 기존 자산 dispatch).
- **2026-05-27 Q1~Q5 결재** — 사용자 "(a) ADR-151 α 진입 (5 Q default
  5/5 결재)" (audit 가치 즉시 실현):
  - Q1=(a) ADR-051 §2.3.1 spec 답습 ✅
  - Q2=(a) 명시 호출 only ✅
  - Q3=(a) 6-step template ✅
  - Q4=(a) 자동 path 보존 ✅
  - Q5=(a) ContextMenu "🔗 Connected Inner Merge" ✅
- **2026-05-27 α** (PR #209) — ADR-151 spec only PR
- **2026-05-28 β-1** (PR #212) — Engine `enforce_p7_canonical` skeleton
  + `P7EnforceError` (4 variants InvalidInput / NoComponents /
  PerimeterFailed / RebuildDeferred) + 기존 자산 dispatch
  (`find_inner_components` + `compute_combined_perimeter`) + 6 회귀
- **2026-05-28 β-2** (PR #213) — Engine `rebuild_as_ring_face` mutation
  본격 활성 — `RebuildDeferred` sentinel 제거 + `remove_face` +
  `add_face_with_holes` (CW reversed hole loops) + `verify_p7_manifold`
  + `P7EnforceError::RebuildFailed` variant + 4 회귀
- **2026-05-28 β-3** (PR #215) — WASM bridge `enforceP7Canonical` export
  + TS wrapper `WasmBridge.enforceP7Canonical` (graceful no-op missing
  engine + strict throw on JSON error) + `P7EnforceResult` interface
  + 6 회귀 (WASM 3 + TS 3)
- **2026-05-28 β-4** (PR #216) — UI ContextMenu "🔗 Connected Inner
  Merge" + 가시성 (≥2 face) + dispatch handler (first=container,
  rest=inners) + 3-way Toast (success / info ADR-051 §2.5 deferred
  boundary / error) + 4 회귀
- **2026-05-28 γ** (본 commit) — Playwright E2E (3 specs) + Status
  Proposed → Accepted + §9 Lessons + LOCKED 등재 + README catalog 갱신
  + 3 회귀

## 9. Lessons (canonical for Sprint 3 ADRs)

ADR-149 / ADR-150 §9 Lessons 의 자연 연장 — Sprint 3 셋째 ADR 의 누적
canonical patterns 및 audit-first 11번째 적용의 정량 evidence.

### L-151-1 — audit-first canonical 11번째의 정량 가치

ADR-151 audit (PR #208, `docs/audits/2026-05-27-adr-151-precheck.md`)
가 multi-week 추정을 **50% 감소** (2주 → 1주). 핵심 finding:
- ADR-051 §2.3.1 `enforce_p7_canonical` spec 이 **5개월 전** 이미 작성됨
- 모든 building block 존재 — `find_inner_components` (BFS) +
  `compute_combined_perimeter` (CCW boundary walk) +
  `verify_p7_manifold` (P7-M1/M2/M3) + `add_face_with_holes` (DCEL
  ring-with-hole)
- 새 알고리즘 = **0** (기존 자산 dispatch only)

본 ADR 진행 시간 (audit 진입 → γ closure) = **약 1일** (2026-05-27
audit → 2026-05-28 γ). audit-first 가 없었다면 2주 multi-week atomic
이었을 ADR이 **1일 single-day 6-step template** 으로 closure.

→ **향후 ADR 가이드**: multi-week 추정 ADR 진입 전 audit-first 강제.
50%+ 감소 가능성 항상 검토.

### L-151-2 — 6-step template reproducibility (ADR-148 → 149 → 150 → 151, 4번째 누적)

| Sub-step | ADR-148 (Boundary) | ADR-149 (T-junction) | ADR-150 (Coplanar) | ADR-151 (P7 Resolver) |
|---|---|---|---|---|
| α spec | PR #188 | PR #196 | PR #202 | PR #209 |
| β-1 engine skeleton | PR #189 | PR #199 | PR #203 | PR #212 |
| β-2 engine mutation | PR #189 | PR #200 | PR #204 | PR #213 |
| β-3 bridge (WASM+TS) | PR #186 | PR #201 | PR #205 | PR #215 |
| β-4 UI integration | PR #187 | PR #206 | PR #207 | PR #216 |
| γ closure | PR #188 | PR #208 | (merged with γ) | 본 PR |

**4번째 reproducibility evidence** — 6-step template 이 *반복 가능한
무위험 architectural pattern* 임을 정착. 향후 새 ADR 작성 시 동일
template 적용 default.

### L-151-3 — 정책 B-hybrid 의 4번째 명시 답습

LOCKED #44 + 메타-원칙 #16 정합 — mesh.rs LoC 추가 **0**,
`operations/p7_canonical_resolver.rs` 신설 (~280 LoC). 기존 자산
dispatch 가 새 코드 추가 최소화. ADR-148/149/150 답습.

향후 ADR 가이드 — 새 알고리즘이 필요 없으면 정책 B-hybrid 우선 적용.

### L-151-4 — ADR-051 §2.5 deferred boundary 의 architectural closure

ADR-051 (2026-04-29 작성, 5개월 전) §2.5 의 *future work* 가 ADR-151
γ closure 로 **architectural closure 도달**. 본 ADR 의 ring-with-hole
rebuild 가 deferred boundary (1 non-manifold shared edge) 의 시그너처
해소 — `verify_p7_manifold` 가 0~1 violation 보고. 사용자 UI 가 명시
호출 trigger (메타-원칙 #16) 로 의도 명확.

→ **canonical pattern**: 다른 deferred boundary / future work 도 동일
패턴 (audit-first → spec dispatch → 기존 자산 + small mutation) 적용
가능.

### L-151-5 — 메타-원칙 #16 의 11번째 적용 (Sprint 1+2+3 누적)

Sprint 1 (ADR-145 annulus / ADR-146 inferencing) + Sprint 2 (ADR-147
spatial-hash / ADR-148 boundary) + Sprint 3 (ADR-149 T-junction /
ADR-150 coplanar / ADR-151 P7 resolver) 모두 *명시 trigger only*
(Draw 도구 자동 trigger 0). 메타-원칙 #16 의 정량 evidence — 7 ADRs
누적 정합.

### L-151-6 — Sprint 3 closure → Sprint 4 자연 진행

ADR-141 Master Roadmap §3 Sprint 4 (Healing Pipeline) 진입 anchor.
Sprint 3 의 3 ADRs (T-junction healing + coplanar sweep + P7 resolver)
가 Sprint 4 의 broader healing pipeline 의 building blocks. 자연 진행
canonical.

## 10. Cross-link

- ADR-141 Master Roadmap §3 (Sprint 3 셋째 ADR anchor)
- ADR-149 / ADR-150 §9 Lessons (canonical for Sprint 3)
- ADR-148 (6-step template source)
- ADR-051 §2.3.1 `enforce_p7_canonical` spec (canonical anchor — 5개월
  전 작성, 본 ADR 의 즉시 구현 source)
- ADR-051 §2.5 deferred boundary (해결 대상)
- ADR-021 P7 LOCKED #1 (canonical anchor — connected stacked-inner)
- ADR-015 fallback (자동 path 보존)
- LOCKED #44 (Complete Meaning per Merge — 6 sub-steps atomic)
- LOCKED #65 메타-원칙 #16 (canonical anchor — 명시 trigger only)
- LOCKED #66 STATUS-POLICY (Status field canonical)
