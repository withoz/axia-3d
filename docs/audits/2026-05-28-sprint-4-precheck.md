# Sprint 4 Healing Pipeline Step 4 — 사전 audit (audit-first canonical 13번째)

**Date**: 2026-05-28
**Author**: WYKO + Claude
**Trigger**: ADR-141 §3 Sprint 4 (3 ADRs, 3-4주, +60 회귀) 진입 결재
("(b) 추천 default Sprint 4 진입").

**Output**: ADR-152/153/154 의 multi-week 추정을 기존 자산 inventory 기반
으로 재평가 + lettered option matrix + sub-step plan.

## 1. ADR-141 §3 Sprint 4 reserve

| ADR | 제목 | ADR-141 추정 |
|---|---|---|
| ADR-152 | P7-M4/M5 + Euler/Genus 모듈 | 2주 |
| ADR-153 | Best-fit Plane SVD + Pullback | 1주 |
| ADR-154 | Mesh::heal() 통합 entry | 1주 |
| **합계** | | **3-4주, +60 회귀** |

## 2. 기존 자산 inventory

Sprint 4 의 architectural 가치는 *새 알고리즘 도입* 이 아닌 *기존 자산
통합 + invariant 확장*.

### 2.1 P7 manifold 자산 (ADR-152 base)

- **`axia-geo/p7_manifold.rs:200`** `verify_p7_manifold(mesh, container,
  inners) -> P7ManifoldReport`
- **`P7Violation` enum** (line 55) 3 variants:
  * `EdgeSharedByWrongCount` (M1)
  * `BoundaryEdgeMalformed` (M2)
  * `HoleLoopMissingContainer` (M3)
- **`P7ManifoldReport`** with `is_valid()` / `summary()` API
- 4 existing 회귀 tests (passes/disjoint_inner/empty/inactive)

→ ADR-152 의 M4/M5 추가는 **enum extension** + verify_p7_manifold 의 추가
loop. 새 알고리즘 0.

### 2.2 Mesh 위상 자산 (ADR-152 Euler/Genus base)

- **`mesh.rs:3668`** Jordan curve theorem note (genus=1 평면 한정)
- **DCEL primitives**: `verts.len()` / `edges.len()` / `faces.len()` 모두
  Mesh 메서드 노출
- **`verify_face_invariants`** (`mesh_invariants.rs`, Tier 2-A Stack #1)

→ Euler characteristic `χ = V - E + F = 2 - 2g` 공식 단순 카운팅. 활성
DCEL 요소만 카운팅하는 helper 필요 (active filter).

### 2.3 Plane / SVD 자산 (ADR-153 base)

- **`axia-geo/surfaces/plane.rs`** Plane variant + `inverse_at_point`
  (2D-3D mapping pullback 패턴)
- **`glam` crate** — DVec3 / DMat3 (이미 의존성)
- **`nalgebra` crate audit 필요** — Cargo.toml 확인
- 기존 chord plane / face-fit logic: `compute_combined_perimeter` 의
  centroid + normal computation 패턴

→ SVD 본격 도입은 `nalgebra` 의존성 필요 (1-line cargo add). Best-fit
plane = covariance matrix → SVD → 최소 singular vector = normal. Pullback
은 기존 inverse_at_point 답습.

### 2.4 Healing primitives 자산 (ADR-154 base)

- **`axia-geo/operations/repair.rs:147`** `repair_non_manifold_edges_geometric`
- **`mesh_export.rs:631`** `deactivate_empty_emit_faces`
- **`axia-core/orphan_recovery.rs:297`** `apply_orphan_recovery(plan)`
- **`axia-core/topology_damage.rs`** TopologyDamageReport (ADR-097)
- **TopologyRecoveryDialog/Orchestrator** (`web/src/topology/`, ADR-097
  production)

→ ADR-154 의 `Mesh::heal()` 는 4-5개 함수 dispatch wrapper. 새 알고리즘 0.

## 3. multi-week 시간 감소 가능성 (audit-first 12번째 evidence 답습)

ADR-151 audit 가 multi-week 2주 → 1주 (50% 감소) evidence 도달. Sprint 4
유사 가능성:

| ADR | ADR-141 추정 | Audit 후 재추정 | 감소율 |
|---|---|---|---|
| ADR-152 | 2주 | **1주** (enum variant + Euler counting) | -50% |
| ADR-153 | 1주 | **3-4일** (nalgebra SVD 1-line + inverse_at_point 답습) | -40~50% |
| ADR-154 | 1주 | **3-4일** (4-5 dispatch wrapper) | -40~50% |
| **합계** | **3-4주** | **2-3주** | **-25~50%** |

## 4. 회귀 분배 매트릭스 (+60 ADR-141 spec 정합)

| ADR | β-1 | β-2 | β-3 | γ | 합계 |
|---|---|---|---|---|---|
| ADR-152 (M4/M5 + Euler/Genus) | +6 enum/Euler | +6 Genus | +5 WASM/TS | +3 E2E | **+20** |
| ADR-153 (SVD + Pullback) | +6 SVD | +6 Pullback | +5 WASM/TS | +3 E2E | **+20** |
| ADR-154 (Mesh::heal()) | +6 dispatch | +6 cascading | +5 WASM/TS | +3 E2E | **+20** |
| **합계** | | | | | **+60** ✅ |

## 5. Template 결정

| 측면 | ADR-152 | ADR-153 | ADR-154 |
|---|---|---|---|
| Engine 변경 | ✅ (P7Violation enum + Euler/Genus) | ✅ (SVD + Pullback) | ✅ (heal dispatch) |
| WASM 변경 | ✅ (verify + checkInvariants exports) | ✅ (computeBestFitPlane export) | ✅ (heal export) |
| UI 변경 | ❌ (dispatch only) | ❌ (dispatch only) | ❌ (TopologyRecoveryDialog 이미 production) |
| Template | **5-step** (α/β-1/β-2/β-3/γ — UI β-4 없음) | **5-step** | **5-step** |

→ Sprint 3 의 6-step (UI 포함) 보다 **5-step 변형** (ADR-164 답습). UI
없으므로 β-3 가 WASM + TS wrapper 통합.

## 6. Lettered Option Matrix

| Q | 항목 | (a) 추천 default | (b) alt |
|---|---|---|---|
| Q1 | ADR 순서 | **152 → 153 → 154** (ADR-141 spec 정합) | 다른 순서 |
| Q2 | 시간 추정 | **2-3주** (audit-first 25-50% 감소) | 3-4주 보수 |
| Q3 | Template | **5-step** (UI 없음, β-3 WASM+TS 통합) | 6-step (UI dispatch) |
| Q4 | 회귀 분배 | ADR-141 spec **+20/+20/+20=+60** | 재분배 |
| Q5 | Sprint 4 closure 시점 | **3 ADRs γ 완료 후** | ADR-152 closure 만 |

## 7. Out-of-scope (별도 ADR 또는 future)

- **ADR-155 (S4.5)** Curve-to-Curve Face Split — Sprint 4 외부 multi-week
- **OCCT BRepGProp_Volume** — ADR-152 Genus 계산의 NURBS extension (S5 ADR-157)
- **GUI heal slider** — ADR-154 UI 확장 (S6)
- **Healing batch UI** — ContextMenu 추가 (future)

## 8. 결론

Sprint 4 가 *architectural complete meaning* (LOCKED #44) 으로 묶음 가능
+ audit-first canonical 의 13번째 적용 evidence. ADR-152 α spec 부터
진행 권장.

**Cross-link**:
- ADR-141 §3 (Sprint 4 reserve anchor)
- LOCKED #66 (audit-first canonical)
- ADR-149/150/151 audit (Sprint 3 precedent, 6-step template)
- ADR-164 audit (5-step variant precedent)
- LOCKED #44 / #65 메타-원칙 #5/#16
