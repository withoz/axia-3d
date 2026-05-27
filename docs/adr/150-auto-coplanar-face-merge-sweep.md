# ADR-150 — 자동 Coplanar Face Merge Sweep (opt-in, Sprint 3 둘째 ADR)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-27
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap) Sprint 3 둘째 ADR.
ADR-141 §3 reserve:
> "ADR-150 | 자동 Coplanar Face Merge (opt-in, 메타-원칙 #16 정합) | S3 | 1주"
**Direct predecessor**: ADR-149 (T-junction Sweep 명시 도구) — 직전 Sprint 3
첫 ADR. 1:1 mirror pattern (engine sweep + bridge + UI ContextMenu).
**Sprint**: S3 (ADR-141 §3 — 3~4주, 회귀 +50 share ~21).

## Canonical anchor

ADR-141 §3 Sprint 3 매트릭스의 둘째 ADR — 메타-원칙 #16 정합으로
*휴리스틱 자동 sweep* 폐기, *사용자 명시 호출 only* 활성. ADR-149 canonical
pattern 1:1 mirror.

**핵심 통찰** (audit-first canonical 10번째, 2026-05-27):
ADR-150 진입 전 사전 audit 결과 — 이미 *manual coplanar merge* 자산 풍부
(`merge_coplanar_faces_geometric`, `merge_faces_by_edge_with_tolerance`,
ContextMenu 4 entries). ADR-150 scope = **batch sweep** (전체 mesh 의 모든
coplanar 인접 pair 자동 검출 + ordered batch merge) — 기존 manual 자산과
의미적으로 다름.

## 1. Problem statement

### 1.1 현재 manual merge 의 한계

**현재 자산** (audit-first canonical 결과):
- `Mesh::merge_coplanar_faces_geometric(f1, f2, tol_deg)` — single pair manual
- ContextMenu `merge-faces` / `merge-faces-geometric` / `merge-xia-coplanar` /
  `merge-faces-force` — 4 manual entries

**문제점**:
1. **반복 호출 부담** — N개 인접 coplanar pair 정리 시 사용자가 각 pair 마다
   선택 → 메뉴 → 호출 반복.
2. **Pair 발견 부담** — 어느 pair 가 mergeable 인지 사용자가 시각적으로
   판단 필요. spatial-hash + coplanar check 자동화 필요.
3. **Merge ordering 부담** — 인접 pair (A-B) merge 후 (AB-C) 도 mergeable
   가능. 사용자가 sequence 정해야.
4. **PushPull / Boolean 후 정리 needs** — 큰 op 후 mesh에 잠재적 coplanar
   pair 다수 발생. one-shot batch cleanup 자연 needs.

### 1.2 메타-원칙 #16 정합 — 명시 sweep only

*자동* sweep (예: 매 mutation 후 자동 batch merge) 은 휴리스틱 자동화의
전형 — cascading 부작용 source. ADR-149 와 동일 정책: **명시 trigger only**
(ContextMenu 호출 시점에만 sweep + batch merge).

ADR-141 §3 spec "opt-in" 의 정확한 의미 — *사용자 명시 ContextMenu 호출*
만 활성 (자동 trigger / localStorage opt-in 모두 제공 안 함). ADR-149 Q4=a
canonical 답습.

### 1.3 LOCKED 정책 cross-cut

- **LOCKED #1 P7 manifold**: batch merge 후 manifold invariant 보존
- **LOCKED #5 spatial-hash**: 0.15μm tolerance — coplanar pair candidate
  검출 활용
- **LOCKED #7 ADR-026 P12**: cardinal snap SSOT — coplanar check 정합
- **LOCKED #15 메타-원칙 #15**: 동일 분할 = 동일 contract — merge 후 결과
  edges 의 flags 정합
- **LOCKED #16 ADR-038 P23**: surface-aware normals — merge 후 normal 재계산
- **LOCKED #65 메타-원칙 #16**: 자동화 antipattern — *명시 호출 only* 강제

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — ADR-150 scope: (a) 자동 sweep (1-shot batch merge)

**Lock-in**: 사용자 명시 ContextMenu 호출 시 전체 mesh 의 모든 coplanar
mergeable pair 1-shot batch 처리. *post-mutation hook* / *localStorage
opt-in* 모두 미제공 — 메타-원칙 #16 strict.

기존 manual 4 entries 와 다름:
- `merge-faces`: 단일 shared edge 사용
- `merge-faces-geometric`: 단일 pair (사용자가 2개 face 선택)
- `merge-xia-coplanar`: XIA 단위 batch (XIA 내 모든 coplanar)
- `merge-faces-force`: 비평면 강제 (다른 의미)
- **ADR-150 신규**: **전체 mesh sweep + 모든 coplanar pair batch merge** —
  사용자 선택 불필요, mesh 전체 처리

### Q2 — Detection algorithm: (a) Full mesh sweep + spatial-hash candidate

**Lock-in**: ADR-149 Q1 1:1 mirror — spatial-hash candidate compression
으로 O(N+M) 후보 → coplanar check.

**Algorithm**:
1. 모든 active face 의 normal + plane equation 수집
2. Spatial-hash (LOCKED #5 0.15μm cell, face AABB) 으로 face pair candidate
   필터링
3. 각 (f1, f2) candidate 에 대해:
   - normal angle check (tol_deg)
   - plane distance check (LOCKED #5 ε)
   - shared edge OR collinear overlap 검출
   - `would_geometric_merge_succeed(f1, f2, tol_deg)` 호출 (기존 dry-run API)
   → eligible 시 `CoplanarPairReport` emit

**Return type**: `Vec<CoplanarPairReport { face_a, face_b, plane_normal, overlap_segment }>`

### Q3 — Coplanar tolerance: (a) 기존 default tol_deg 답습 (1.0°)

**Lock-in**: `merge_coplanar_faces_geometric` 의 기존 default tol_deg
(1.0°) 답습. 사용자 설정 (SettingsPanel slider) / strict (0.5°) 모두
별도 ADR.

```rust
const COPLANAR_PAIR_TOL_DEG: f64 = 1.0; // default
```

### Q4 — UI entry: (a) ContextMenu "🧹 Coplanar 면 일괄 자동 정리"

**Lock-in**: ADR-149 β-4 pattern 1:1 mirror. 기존 4 merge entry 와 함께
그룹 (HTML index.html). 새 단축키 / panel 신설 0.

**위치**: ContextMenu 의 면 통합 그룹 (merge-faces-force 직후).

**호출 시점**: 우클릭 → 메뉴 → 클릭. Selection 무관 (mesh 전체 처리).

### Q5 — 자동 trigger 정책: (a) Default OFF + 명시 호출 only

**Lock-in**: 메타-원칙 #16 정합 강제. autopilot 0.

- 자동 trigger / post-mutation hook / localStorage opt-in **모두 0**
- 사용자 ContextMenu 클릭 = 유일한 trigger
- ADR-149 Q4 / ADR-139 / ADR-145 / ADR-148 canonical 답습

## 3. Path Z atomic plan (6 sub-step)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-150 spec only commit (본 PR) | +0 |
| **β-1** | Engine `Mesh::sweep_coplanar_pairs(tol_deg) -> Vec<CoplanarPairReport>` + 6 회귀 | +6 (axia-geo) |
| **β-2** | Engine `Mesh::merge_coplanar_pair_batch(pairs) -> BatchMergeReport` + 4 회귀 (기존 `merge_coplanar_faces_geometric` 호출 + ordering + skip) | +4 (axia-geo) |
| **β-3** | WASM bridge `sweepCoplanarPairs` + `mergeCoplanarPairBatch` exports + TS bridge wrappers + 2 회귀 | +2 (axia-wasm) + 6 (vitest) |
| **β-4** | UI ContextMenu "🧹 Coplanar 면 일괄 자동 정리" integration + 4 회귀 | +4 (vitest) |
| **γ** | E2E + closure docs (Status Proposed → Accepted + §9 Lessons) | +3 (Playwright) |
| **합계** | | **+21** |

**ADR-141 §3 Sprint 3 회귀 share**: +21 (S3 +50 share ~42%, 1주 분 적정).

**Sprint 3 누적 (ADR-149 +29 → 합계)**: +50 / +50 (100%) — Sprint 3 회귀
share 도달.

## 4. Lock-ins (canonical for ADR-150)

- **L-150-1** 메타-원칙 #16 정합 강제 — 자동 trigger 0, 명시 호출 only
- **L-150-2** ADR-149 canonical pattern 1:1 mirror (Sprint 3 reproducibility 증명)
- **L-150-3** Q1=(a) 전체 mesh sweep batch — 기존 4 manual entry 와 다름
- **L-150-4** Q2=(a) Spatial-hash candidate compression (ADR-149 Q1 답습)
- **L-150-5** Q3=(a) `COPLANAR_PAIR_TOL_DEG = 1.0` (기존 default 답습)
- **L-150-6** Q4=(a) ContextMenu only — 새 단축키/panel 0 (ADR-046 P31 #4
  additive only)
- **L-150-7** Q5=(a) Default OFF + 명시 호출 only — localStorage opt-in
  미제공
- **L-150-8** 기존 `merge_coplanar_faces_geometric` 자산 활용 — 새 merge
  알고리즘 0 (β-2 가 dispatch loop 만)
- **L-150-9** Ordering policy — face_id ascending order batch processing
  (deterministic, future-proof for incremental sweep)
- **L-150-10** Skip-on-error policy — single pair merge 실패 시 skip + 다음
  pair 진행 (silent skip 차단 — BatchMergeReport.skipped 필드)
- **L-150-11** 회귀 가드 — ADR-077 V-2 visual baseline 보존 (명시 호출
  시점만 활성)
- **L-150-12** 절대 #[ignore] 금지 21/21 강제

## 5. Out of scope (선택적 또는 별도 ADR)

- **자동 sweep on mutation** — 메타-원칙 #16 정합 위반 → 영구 거부
- **localStorage opt-in** — 별도 ADR (사용자 needs evidence 시)
- **Coplanar tolerance SettingsPanel slider** — 별도 ADR (사용자 needs
  시)
- **Incremental sweep** (변경된 face 만 batch) — 별도 ADR (perf optimization)
- **Multi-XIA cross-cut batch merge** — 별도 ADR (semantic boundary)
- **Visual feedback** (mergeable pair highlight) — ADR-046 P31 Pillar 2
  별도 ADR
- **Undo granularity** — 현재 batch = 단일 undo step. multi-undo 별도 ADR.

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (axia-geo +6)**:
- `adr150_sweep_no_pairs_on_clean_mesh` (baseline)
- `adr150_sweep_finds_adjacent_coplanar_pair` (canonical positive)
- `adr150_sweep_excludes_non_coplanar` (regression guard)
- `adr150_sweep_finds_multiple_pairs` (multi-pair)
- `adr150_sweep_respects_tolerance` (1° boundary case)
- `adr150_sweep_spatial_hash_optimization` (large mesh 100-face 성능)

**β-2 회귀 (axia-geo +4)**:
- `adr150_batch_merge_single_pair_success` (canonical)
- `adr150_batch_merge_multiple_pairs_cascade` (A-B → AB-C)
- `adr150_batch_merge_skips_invalid_pair` (skip + continue)
- `adr150_batch_merge_manifold_safe_post_batch` (LOCKED #1 invariant)

**β-3 회귀 (axia-wasm +2 + vitest +6)**:
- axia-wasm: parser tests (canonical / missing field) — ADR-149 β-3 답습
- vitest: detect/merge round-trip + camelCase mapping + graceful/strict

**β-4 회귀 (vitest +4)**:
- ContextMenu menu visibility
- Zero pairs → Toast.info
- Canonical batch merge → Toast.success
- Partial failure → Toast.info

**γ 회귀 (Playwright +3)**:
- Clean mesh sweep → empty
- Invalid batch input → strict throw
- ContextMenu entry exists (β-4 wiring)

## 7. Cross-link

- ADR-141 §3 Sprint 3 (canonical roadmap anchor)
- ADR-149 (T-junction Sweep — 직전 Sprint 3 ADR, 1:1 mirror source)
- ADR-139 (Boundary tool 명시 only — pattern source)
- ADR-145 (Annulus 명시 promote — ContextMenu pattern source)
- ADR-148 (Point-Localized BoundaryTool — algorithm pattern source)
- ADR-006 C1 Phase F (coplanar containing merge)
- ADR-007 Invariant 2 (manifold + winding 보존)
- LOCKED #1 ADR-021 P7 (manifold anchor)
- LOCKED #5 (spatial-hash 0.15μm canonical)
- LOCKED #15 메타-원칙 #15 (merge contract 정합)
- LOCKED #16 ADR-038 P23 (surface-aware normals)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #65 메타-원칙 #16 (자동화 antipattern — canonical anchor)
- LOCKED #66 STATUS-POLICY

## 8. 결재 cycle log

- **2026-05-27 α-audit** (본 ADR α PR) — Sprint 3 source materials + ADR-141
  §3 매트릭스 확인 + codebase coplanar merge 자산 audit (`geometric_merge.rs`
  1027 LoC, 4 manual ContextMenu entries) + scope 분리 명시 (ADR-150 =
  *batch sweep*, 기존 manual 자산과 다름)
- **2026-05-27 Q1~Q5 결재** — 사용자 "추천으로 진행" (default 5/5):
  - Q1=(a) 자동 sweep (1-shot batch merge) ✅
  - Q2=(a) Full mesh sweep + spatial-hash candidate ✅
  - Q3=(a) COPLANAR_PAIR_TOL_DEG = 1.0 (기존 default) ✅
  - Q4=(a) ContextMenu "🧹 Coplanar 면 일괄 자동 정리" ✅
  - Q5=(a) Default OFF + 명시 호출 only ✅
- **2026-05-27 α** (본 commit) — ADR-150 spec only PR
- **TBD β-1** — Engine sweep_coplanar_pairs + 6 회귀
- **TBD β-2** — Engine merge_coplanar_pair_batch + 4 회귀
- **TBD β-3** — WASM bridge + TS wrapper + 8 회귀
- **TBD β-4** — UI ContextMenu integration + 4 회귀
- **TBD γ** — E2E + closure docs + §9 Lessons

## 9. Lessons (TBD — γ closure 시 작성)

본 섹션은 γ closure (Status Proposed → Accepted) 시 작성. ADR-149 §9
Lessons (canonical for Sprint 3 ADRs) 답습 + Sprint 3 둘째 ADR 의 추가
lessons 누적.

후보 lessons (β implementation 완료 시 확정):
- ADR-149 1:1 mirror reproducibility 증명 (Sprint 3 reproducibility)
- 기존 manual 자산 활용 + 신규 sweep API 만 신설 (정책 (B) hybrid
  답습 — `operations/geometric_merge.rs` 확장 + mesh.rs 0 line)
- 메타-원칙 #16 정합의 10번째 적용 (Sprint 1+2+3 모든 explicit-trigger
  ADRs 누적)
- Sweep + batch + ordering + skip canonical pattern (향후 batch op ADRs
  에 답습 가능)
