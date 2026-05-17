# ADR-110 — Boolean Path B Compatibility (Pre-polygonize for Boolean Ops)

| Field | Value |
|---|---|
| Status | **Draft (spec + engine fix, 사용자 결재 2026-05-16)** |
| Date | 2026-05-16 |
| Supersedes | — |
| Related | ADR-089 (Path B closed-curve face), ADR-094 (Path B-full default ON), ADR-101 (auto-intersect coplanar, Phase A `polygonize_closed_curve_face`), ADR-107 (`*AsShape` → Path B), ADR-064/066 (NURBS Boolean DCEL), ADR-076 (Boolean Path Sunset) |
| Cross-cut | 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다"), 메타-원칙 #15 ("동일 분할 = 동일 topological contract"), "기능 확보 → 결함 자연 해소" 전략 |

## 1. Anchor 통찰 (canonical, 사용자 2026-05-16)

> **"결함들을 수정하는 방향으로 먼저 기능을 확보해 놓으면 결함도 수정되는 부분이 있는지 검토. 블리언을 진행시 해결되는 문제들도 있을것."**

본 세션 audit 의 직접 evidence — **Path B cylinder × Path B cylinder Boolean = mesh 변경 0** (silent fail).

ADR-094 Path B-full default ON (production via localStorage) 사용자가 그린 cylinder 가 Boolean 수행 시 결과 0 — architectural inconsistency. ADR-101 §3.1 명시 evidence:
> "Path B closed-curve face (1 anchor + 1 self-loop edge) 는 loop_verts.len() == 1 로 short-circuit (positions.len() < 3 → skip)"

본 ADR-110 은 ADR-101 의 `polygonize_closed_curve_face` helper 를 `Mesh::boolean` entry 에 사전 호출 → Path B face 가 polygonal 로 변환 → Boolean 활성.

## 2. Decision

### 2.1 P-1 (canonical) — Pre-polygonize at Mesh::boolean entry

`Mesh::boolean(faces_a, faces_b, op, material)` 의 첫 단계에서 양 operand 의 Path B closed-curve face 를 `polygonize_closed_curve_face` 로 사전 polygonize → 새 FaceId 매핑 후 기존 path 계속.

```rust
// crates/axia-geo/src/operations/boolean.rs - Mesh::boolean entry
let faces_a_resolved = self.polygonize_path_b_for_boolean(faces_a, material)?;
let faces_b_resolved = self.polygonize_path_b_for_boolean(faces_b, material)?;
// Continue with _resolved versions (existing prepare_solid → find_intersections → ...)
```

### 2.2 5 lock-in 원칙

- **L1 — Additive, drop-in alongside**: 기존 Boolean path (3D triangle-triangle / coplanar detection / split_faces_by_intersections) UNCHANGED. polygonize 만 사전 추가.
- **L2 — ADR-101 Phase A helper 재사용**: `Mesh::polygonize_closed_curve_face` (mesh.rs:3308) 의 이미 검증된 path. ADR-101 회귀 자산 활용 (+7 회귀 모두 PASS).
- **L3 — In-place face_id 매핑**: polygonize 결과 새 FaceId 가 caller 와 무관. Mesh::boolean 내부에서만 사용. 호출자 (Scene / WASM bridge) 영향 0.
- **L4 — Backward compat**: 이미 polygonal face 는 `polygonize_closed_curve_face` 가 `Ok(None)` 반환 — fallback 으로 원본 face_id 사용. 영향 0.
- **L5 — 기능 확보 → 결함 자연 해소 (canonical strategy)**: Path B Boolean 활성 시 Tier 1+2 의 9건 결함이 cascade 해소. 본 세션의 "기능 확보 → 결함 해소" 패턴 적용.

### 2.3 LOCKED 정책 정합

- **LOCKED #1 (ADR-021 P7) / #12 (ADR-025 P11)**: face 합성 / 분할 정책 영향 0 (additive)
- **LOCKED #15 (ADR-037 P22.5)**: edge owner-ID uniformity — polygonize 후 N segments 각각 새 EdgeId. ADR-088 owner-id grouping 자동 정합 (polygonize 가 owner 부여하지 않음, Boolean 후 ID 변경)
- **LOCKED #16 (ADR-038 P23)**: surface-aware normals — Plane attach 정합
- **LOCKED #26 (ADR-049 Two-Layer Citizenship)**: Shape/Xia 시민권 영향 0
- **LOCKED #35 (ADR-089/094 Path B canonical)**: Path B 의 *Boolean 호환 활성* — canonical workflow 완성
- **메타-원칙 #14**: Path B closed-curve face 의 Boolean 영역 deepest realization 확장
- **메타-원칙 #15**: split contract uniformity — Path B 도 Boolean dispatch 일관

## 3. 자연 해소 후보 매트릭스 (사용자 통찰 검증)

### Tier 1 — 본 ADR fix 시 **직접 해소**

| 결함 / 한계 | 자연 해소 메커니즘 |
|---|---|
| **Path B cylinder × Path B cylinder Boolean 무변화** (audit 직접 evidence) | prepare_solid 가 polygonize 후 정상 path |
| **Path B circle × Path B circle 외부 Boolean** | 동일 |
| **사용자 canonical workflow** — Path B → extrude → Boolean | 정상 동작 |
| **ADR-094 Path B default ON 사용자 Boolean inconsistency** | 해소 — Path B 가 canonical 인데 Boolean 만 호환 안 됨 architectural gap |

### Tier 2 — Boolean 진행 후 **cascade 해소** (간접)

| 항목 | cascade 메커니즘 |
|---|---|
| Boolean 결과 face 의 surface inheritance | 이미 `split_faces_by_intersections` 의 parent_surface 전파 (line 522) 정합 |
| Boolean 결과 face 의 owner-id grouping | ADR-093 패턴 cross-cut 자연 활성 |
| Sheet Boolean Path B 호환 | `Mesh::sheet_boolean` 의 path 확장 (별도 sub-step) |
| Group selection Boolean (ADR-074) | dispatch UI 자연 정합 |

### Tier 3 — Boolean 진행 후 **발견될 새 결함** (예상)

| 항목 | 예상 trigger |
|---|---|
| Boolean 결과 의 visual baseline | ADR-077 V-3 cross-cut |
| Boolean 결과 wireframe smooth-group | ADR-089 A-τ 자동 정합 (Cylinder 부여 후) |

## 4. Path Z atomic plan

### 4.1 Step roadmap

| Step | Title | 회귀 (예상) | Risk |
|---|---|---|---|
| **π-α** | Spec only (본 commit 의 docs 부분) | 0 | 0 |
| **π-β** | Engine fix — `polygonize_path_b_for_boolean` helper + Mesh::boolean entry 통합 | axia-geo +2~4 | 낮음 (additive, ADR-101 helper 재사용) |
| **π-γ** | 미리보기 시연 — Path B cylinder × Path B cylinder Boolean reproduce + 정상 결과 검증 (자연 해소 evidence) | (cascade audit) | 낮음 |
| **π-δ** | Cross-link — ADR-101 § / CLAUDE.md amendment | 0 | 낮음 |

**누적 회귀 예상**: **+2~4** (절대 #[ignore] 금지 100% 준수).

### 4.2 사용자 결재 시점

- 본 PR — π-α + π-β + π-γ 통합 (사용자 결재 (β) 2026-05-16)
- π-δ closure 는 commit 마지막

## 5. Out-of-scope (deferred)

- **Sheet Boolean Path B 호환** — Mesh::sheet_boolean 의 별도 path. 본 ADR 의 자연 sibling, 별도 sub-step (π-ε 가칭)
- **Boolean 결과 face 의 face count unification** (Path B-full 의 single side face 통합 답습) — multi-week architectural surgery, 별도 ADR
- **NURBS Boolean (ADR-064/066) 의 Path B 호환** — NURBS dispatch 의 별도 영역
- **Sheet Boolean / Group selection** 의 Path B 호환 검증 — 사용자 후속 시연 시
- **Boolean visual baseline (ADR-077 V-3)** — Boolean fix 후 별도 PR

## 6. 회귀 영향 예측

- **기존 회귀 자산**: 영향 0 (additive only — polygonize 가 polygonal face 에 no-op, Path B 만 변환)
- **새 회귀 자산**: +2~4 (axia-geo)
  - `adr110_pi_beta_path_b_cylinder_boolean_activates` — Path B cylinder Union 후 face count 변경 검증
  - `adr110_pi_beta_polygonal_unchanged` — polygonal face 영향 0 (regression guard)
  - `adr110_pi_beta_helper_returns_substituted_face_ids` — helper unit
- **사용자 facing 변화**: ✨ Path B cylinder Boolean 활성 (silent fail → 정상). Path B canonical workflow 완성.

## 7. Acceptance criteria (π-α 시점)

본 ADR commit 이 만족해야:
- ✅ `docs/adr/110-boolean-path-b-compat.md` 신설
- ✅ §1 Anchor (사용자 통찰) / §2 Decision / §3 자연 해소 매트릭스 / §4 Path Z plan / §5 Out-of-scope / §6 회귀 영향 / §7 Acceptance criteria
- ✅ L1~L5 lock-ins 명시
- ✅ ADR-089/094/101/107/064/066/076 cross-link
- ✅ 메타-원칙 #14 / #15 + "기능 확보 → 결함 자연 해소" canonical strategy 명시

## 8. Cross-link

- **ADR-089** (Path B closed-curve face) — canonical Layer B
- **ADR-094** (Path B-full default ON) — production canonical
- **ADR-101 Phase A** (`polygonize_closed_curve_face`) — 본 fix 의 prerequisite helper
- **ADR-101 §3.1** — architectural gap 의 명시 evidence (loop_verts.len()==1 short-circuit)
- **ADR-107 ζ-β** (`*AsShape` → Path B) — 본 fix 의 자연 sibling (Boolean 영역)
- **ADR-076** (Boolean Path Sunset) — Mesh::boolean canonical entry 보존
- **메타-원칙 #14** — "면은 닫힌 경계로부터 유도된다" Boolean 영역 deepest realization
- **메타-원칙 #15** — split contract uniformity
- **"기능 확보 → 결함 자연 해소" canonical strategy** — 사용자 통찰 2026-05-16

---

*ADR-110 π-α + π-β + π-γ — Boolean Path B Compatibility. 사용자 통찰
"기능 확보 → 결함 자연 해소" architectural strategy 의 first application.
ADR-101 Phase A helper 재사용으로 minimal scope 진행.*
