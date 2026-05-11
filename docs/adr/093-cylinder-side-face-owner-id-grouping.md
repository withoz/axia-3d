# ADR-093: Cylinder Side Face Owner-ID Grouping (B-MVP — Path B Light) — **Accepted**

- **Status**: Accepted (D-α ~ D-ε closure 2026-05-09)
- **Date**: 2026-05-09
- **Anchor**: ADR-090 §6.3 결함 2 (Side hover/select N quads) — primary
  trigger 활성. 사용자 결재 (2026-05-09) 로 🅺 path 의 첫 단계.
- **Pattern reference**: ADR-088 (curve_owner_id grouping) — 동일
  architecture 의 Face/surface 변형
- **Sibling**: ADR-090 (Path B full — annulus DCEL, 4-6주 deferred)

## 1. Context

ADR-092 closure (2026-05-09) 후 결함 1 (top rim polygon) architectural
closure. 잔존 결함 2 (side hover/select 시 N quads 중 1개만 선택)
는 ADR-090 §6.3 의 새로운 primary trigger.

ADR-090 Path B full (annulus DCEL `Face.boundary_loops` schema) 은
4-6주 multi-week atomic. 결함 2 의 사용자 facing 가치 80% 가
**selection layer** 에서 발현 — DCEL schema 변경 없이도 selection +
group enforcement 만으로 사용자 인식 "측면 = 1 entity" 활성 가능.

ADR-088 의 `Edge.curve_owner_id` 패턴이 동일 문제를 Edge 차원에서
이미 closure (DrawCircle 의 N segments 통일 선택). Face 차원의 동일
pattern 답습이 본 ADR.

## 2. Decision

**Cylinder side N quad faces 가 동일 `surface_owner_id` 공유**. SelectTool
의 face click 결과를 walker 로 자동 promote → 같은 surface_owner_id
가진 모든 active face 일괄 선택. DCEL schema 변경 없음 — Face struct
에 `Option<u32>` 1 필드 추가 (`#[serde(default)]` legacy 호환).

### 2.1 Lock-ins

- **L1 — ID schema**: `Face.surface_owner_id: Option<u32>` (ADR-088
  Edge.curve_owner_id 답습). `#[serde(default)]` ensures bincode legacy
  snapshot 호환.
- **L2 — Allocation**: `Mesh.next_surface_owner_id: u32` (sequential).
  Cylinder 생성 시 N side faces 모두 동일 ID 부여. 미부여 (None) 면
  레거시 polygon strip / non-cylinder 동작.
- **L3 — Walker API**: `Mesh::walk_face_owner_siblings(face_id) ->
  Vec<FaceId>` — 같은 surface_owner_id 가진 모든 active face 수집.
  None ID 인 face 는 자기 자신만 반환.
- **L4 — Allocation site**: `extrude_planar_cylinder` 가 N side faces
  생성 직후 동일 owner_id 부여. `extrude_closed_curve_face_via_
  tessellation` 의 recursion 후 자연 활성.
- **L5 — Selection layer integration**: SelectTool 의 pickFace 결과를
  walkOwnerSiblings 로 자동 promote. SelectionManager.selectFaces
  가 group 단위로 입력.
- **L6 — Boolean / Push-Pull / Offset**: 본 ADR scope 외 — Selection
  only MVP. 후속 sub-step 또는 별도 ADR 진행.
- **L7 — Render layer unchanged**: A-τ smooth-group hide 가 이미 visual
  통합 처리. owner_id 는 selection 만 사용.
- **L8 — Inspector display**: 그룹 인식 시 "Cylinder Side (22 faces)"
  meta 표시 — UX nice-to-have, scope 마지막 sub-step (선택적).
- **L9 — Path B-full 트리거 재평가 anchor**: 본 ADR closure 후 사용자
  시연으로 결함 2 의 selection 측면 closure 만족도 측정. 만족 시
  ADR-090 Path B-full 보류 유지, 불만족 시 진입 결재 활성.
- **L10 — additive only (ADR-046 P31 #4)**: 메뉴/단축키/툴바 외부 ID
  unchanged. SelectTool 의 동작은 *확장* (단일 face → group 자동 promote).

### 2.2 Stack

```
사용자 측면 click (SelectTool)
  ↓ pickFace → faceId
walkFaceOwnerSiblings(faceId)         ← D-γ TS bridge
  ↓
WasmBridge.getFaceOwnerSiblings        ← D-γ typed wrapper
  ↓
walk_face_owner_siblings WASM export   ← D-γ
  ↓
Mesh::walk_face_owner_siblings         ← D-β core
  ├─ get face.surface_owner_id
  ├─ if None → return [face_id]
  └─ if Some(id) → iterate active faces, collect those with same id
  ↓
SelectionManager.selectFaces(siblings)  ← D-δ
  ↓
Inspector / Toast 등 group 단위 인식
```

### 2.3 Decision Matrix (D-A ~ D-H)

| ID | 결정 | 채택 |
|----|------|------|
| D-A | ID schema | `Face.surface_owner_id: Option<u32>` (ADR-088 답습) |
| D-B | Allocation counter | `Mesh.next_surface_owner_id: u32` |
| D-C | DCEL schema 변경 | minimum — 1 Option field add (#[serde(default)]) |
| D-D | Selection enforcement | SelectTool pickFace 후 자동 walk + promote |
| D-E | Boolean/Push-Pull/Offset | scope 외 — selection only MVP |
| D-F | Allocation site | extrude_planar_cylinder N sides 직후 동일 ID |
| D-G | Render layer | unchanged (A-τ smooth-group 답습) |
| D-H | Inspector display | "Cylinder Side (N faces)" meta — 선택적 마지막 sub-step |

## 3. Path Z Atomic Decomposition (5 sub-step)

| sub-step | 영역 | 회귀 예상 |
|---|---|---|
| **D-α** | spec only (본 commit) | 0 |
| **D-β** | Rust core — `Face.surface_owner_id` + `Mesh.next_surface_owner_id` + `walk_face_owner_siblings` API + `extrude_planar_cylinder` 통합 | axia-geo +6~8 |
| **D-γ** | WASM bridge — `getFaceOwnerSiblings(faceId): Uint32Array` + TS bridge wrapper | axia-wasm +1~2, vitest +2~3 |
| **D-δ** | SelectTool 통합 — pickFace 후 walkOwnerSiblings 자동 promote | vitest +3~4 |
| **D-ε** | closure — LOCKED #35 amendment + ADR-090 §6.3 trigger 재평가 + 사용자 시연 게이트 | 0 |

**누적 예상**: axia-geo +6~8, axia-wasm +1~2, vitest +5~7 = **+12~17**.
절대 #[ignore] 금지 정책 준수.

## 4. ADR-088 (curve_owner_id) 와의 비교

| 측면 | ADR-088 (curve_owner_id) | ADR-093 (surface_owner_id) |
|---|---|---|
| Schema | `Edge.curve_owner_id: Option<u32>` | `Face.surface_owner_id: Option<u32>` |
| Allocation | DrawCircle/Arc/Bezier/BSpline 시 1 ID | Cylinder 생성 시 N sides 동일 1 ID |
| Walker | `walk_edge_owner_siblings` | `walk_face_owner_siblings` |
| Selection | edge click → 같은 ID edge 들 일괄 | face click → 같은 ID face 들 일괄 |
| 회귀 | +10 (axia-core 3 + axia-geo 3 + vitest 4) | +12~17 (예상) |
| 일수 | 2일 (5-step Path Z) | 2-3일 (5-step Path Z) |
| LOCKED #15 ADR-037 P22.5 정합 | ✅ direct | ✅ Face owner-id 자연 확장 |

## 5. ADR-090 §6.3 trigger 매트릭스 갱신

ADR-093 closure 후:

**해결되는 잔존 trigger**:
- ✅ **결함 2 의 selection 측면** — 사용자가 cylinder 측면 = 1 entity 인식

**잔존 trigger** (ADR-090 Path B-full 트리거 anchor):
- ❌ 메모리 비용 (N quad faces 누적, large model)
- ❌ STEP/IGES export 정확도 (DCEL 자체가 polygon strip)
- ❌ 산업 CAD parity (analytic cylindrical face)
- ❌ Push-Pull again 시 측면 누적 (cumulative cost)

**다음 결재 anchor**: 사용자 시연 후
- 만족 ("측면 1 entity 인식 충분") → ADR-090 Path B-full 보류 유지
- 불만족 ("memory / export / parity 추가 closure 필요") → ADR-090 Path
  B-full 진입 결재 활성 (B-γ ~ B-θ, 4-6주)

## 6. 위험 분석

- **L1 (낮음)**: bincode 신규 필드 — `#[serde(default)]` + `Option<u32>`
  추가는 ADR-091 §E L1 의 위험 카테고리 (bincode 신규 필드). **그러나
  ADR-088 이 동일 패턴 (Edge.curve_owner_id) 으로 이미 검증** — bincode
  legacy 호환성 PASS. surface_owner_id 도 동일 위험 프로파일.
- **L2 (낮음)**: Walker 의 무한 루프 — face.surface_owner_id 가
  None / 일치 안 함 시 자기 자신만 반환. iteration 단조 종료.
- **L3 (낮음)**: Boolean / Push-Pull 후 owner_id 보존 — face split 시
  parent owner_id inherit (LOCKED #35 L9 ADR-089 A-χ 답습 — surface
  metadata inherit 의 일반 패턴).
- **L4 (중간)**: SelectTool drag-select / shift-select 와 group selection
  의 정합 — group 자동 promote 가 명시 click 만 적용 (drag 영역 안의
  faces 는 개별 promote). UX 일관성 검증 필요 (D-δ).
- **L5 (낮음)**: 사용자 시연 결과 trigger — 측면 1 entity 인식이 너무
  강제적이라 사용자가 "1 quad 만 선택하고 싶다" 하면 modifier key (Alt)
  로 group skip 옵션 — 후속 sub-step 또는 ADR-046 P31 #4 패턴.

## 7. ADR-046 P31 정합

- #1 (P1+P3 가치): ✅ — 사용자가 cylinder 측면 = 1 entity 직관 인식
- #4 (additive only): ✅ — Face struct 에 Option 필드 추가, 기존 동작
  unchanged. SelectTool 동작은 *확장* (단일 face 가 group 자동 promote).

## 8. 회귀 방지 (절대 #[ignore] 금지)

D-β 단계 신규:
- `face_surface_owner_id_default_none`
- `next_surface_owner_id_starts_at_1_and_increments`
- `walk_face_owner_siblings_returns_self_for_none_id`
- `walk_face_owner_siblings_collects_all_with_same_id`
- `extrude_planar_cylinder_assigns_same_owner_id_to_n_sides`
- `extrude_planar_cylinder_owner_id_unique_per_cylinder`
- `face_split_inherits_surface_owner_id` (LOCKED #35 L9 cross-cut)

D-γ: WASM endpoint wiring + TS wrapper graceful fallback.

D-δ: SelectTool integration — single click promote / group click 일관 / Inspector group meta.

## 9. Out of Scope

- ADR-090 Path B-full (annulus DCEL `Face.boundary_loops` schema) —
  본 ADR 의 Sibling, 별도 결재 시 진입.
- Boolean / Push-Pull / Offset 의 group-aware semantics — 후속 sub-step
  또는 별도 ADR.
- Modifier key (Alt) 로 group skip 옵션 — 후속 sub-step 또는 ADR-046
  P31 추가 사용자 토글.
- Sphere / Cone / Torus side face owner_id grouping — 자연 확장 가능,
  별도 sub-step 또는 ADR.

## D. Acceptance Log

### D-α (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — 🅺 path B-MVP 첫 단계.
- **변경**: 본 ADR 작성. ADR-090 §6.3 trigger 의 결함 2 selection
  측면 우선 closure 명시.
- **회귀**: +0 (docs only).

### D-β (본 commit)
- **사용자 결재**: 2026-05-09, "승인".
- **사전 검토 architectural 정정 (canonical)**: 원안 ("Face struct 에
  surface_owner_id: Option<u32> 추가, ADR-088 답습") 가 **ADR-091 §E L1
  canonical guidance 위반** 발견 — bincode struct field 추가 금지,
  Mesh/Scene-level HashMap 사용 강제. 결정 정정: `Mesh.face_to_surface_
  owner_id: FxHashMap<FaceId, u32>` 신규 (Face struct UNCHANGED — bincode
  legacy snapshot 호환 보존).
  > Note: ADR-088 (Edge.curve_owner_id) 의 동일 패턴 (Edge struct field
  > 추가) 은 ADR-091 §E L1 canonical 이전 결정. 본 ADR 가 처음으로 L1
  > 명시 적용. ADR-088 의 retroactive migration 은 별도 트랙.
- **변경**:
  * `crates/axia-geo/src/mesh.rs`:
    - `Mesh.face_to_surface_owner_id: FxHashMap<FaceId, u32>` (`#[serde
      (default)]` legacy 호환) + `Mesh.next_surface_owner_id: u32`
      (start at 1).
    - `next_surface_owner_id() -> u32` (monotonic, ADR-088 답습)
    - `set_face_surface_owner_id(face_id, Option<u32>) -> bool` (active
      face 만 설정, false on inactive)
    - `face_surface_owner_id(face_id) -> Option<u32>` (active 검증 포함)
    - `faces_by_surface_owner(owner) -> Vec<FaceId>` (group enumeration)
    - `walk_face_owner_siblings(face_id) -> Vec<FaceId>` (selection-layer
      entry point — None ID 시 자기 자신만, Some(id) 시 group 전체)
  * `crates/axia-geo/src/operations/create_solid.rs::extrude_planar_
    cylinder` — N side faces 생성 직후 fresh `next_surface_owner_id()`
    + 모든 side faces 에 동일 ID 부여 (Lock-in D-F).
- **회귀** (axia-geo 1207 → 1215, +8):
  * `adr093_d_beta_face_surface_owner_id_default_none`
  * `adr093_d_beta_next_surface_owner_id_starts_at_1_and_increments`
  * `adr093_d_beta_walk_returns_self_for_none_id`
  * `adr093_d_beta_walk_collects_all_with_same_id`
  * `adr093_d_beta_extrude_planar_cylinder_assigns_same_owner_to_n_sides`
    (architectural anchor — N sides 가 1 group)
  * `adr093_d_beta_extrude_planar_cylinder_owner_unique_per_cylinder`
    (cross-cylinder isolation)
  * `adr093_d_beta_set_owner_on_inactive_face_returns_false`
    (defensive — soft-deleted face)
  * `adr093_d_beta_polygonal_circle_path_also_gets_owner_id` —
    extrude_planar_cylinder 가 통합 진입점이라 폴리곤 / closed-curve
    둘 다 활성 (D-F lock-in 명시 검증)
  * 합계 **+8**, 절대 #[ignore] 금지 8/8 준수
- **누적** (D-α ~ D-β): axia-geo +8.
- **Architectural 의의**:
  * ADR-091 §E L1 canonical guidance 의 첫 명시 적용
  * ADR-088 의 Edge owner-id 패턴 위에 Face owner-id 자연 확장
  * Selection layer enforcement 는 D-γ/D-δ 에서 활성 — engine 자료는
    D-β 로 완전 봉인

### D-γ (본 commit)
- **사용자 결재**: 2026-05-09, "승인".
- **변경**:
  * `crates/axia-wasm/src/lib.rs` — 2 신규 export:
    - `walkFaceOwnerSiblings(face_id: u32) -> Vec<u32>` (selection-layer
      entry point, single face → group siblings)
    - `getFaceSurfaceOwnerId(face_id: u32) -> i32` (-1 = no owner,
      mirrors getEdgeCurveOwnerId from ADR-088)
  * `crates/axia-wasm/tests/export_baseline.txt` — 2 entries 추가
    (`getFaceSurfaceOwnerId`, `walkFaceOwnerSiblings`, alphabetical 위치)
  * `crates/axia-wasm/tests/step6_additive_only.rs` — 2 wiring tests
    (signature + return type + delegation 검증)
  * `web/src/bridge/WasmBridge.ts`:
    - `AxiaEngineExtended` interface 에 `walkFaceOwnerSiblings` /
      `getFaceSurfaceOwnerId` 추가
    - `WasmBridge.walkFaceOwnerSiblings(faceId): number[]` typed wrapper
      — endpoint missing 시 graceful fallback `[faceId]` (single-face
      selection 보존, additive only)
    - `WasmBridge.getFaceSurfaceOwnerId(faceId): number` — endpoint
      missing 시 -1
- **회귀**:
  * axia-wasm 36 → 38 (+2 wiring)
  * vitest WasmBridge.test.ts 139 → 143 (+4 wrapper tests:
    success / graceful fallback / owner-id success / owner-id missing)
  * 합계 **+6**, 절대 #[ignore] 금지 6/6 준수
- **누적** (D-α ~ D-γ): axia-geo +8, axia-wasm +2, vitest +4 = **+14**.

### D-δ (본 commit)
- **사용자 결재**: 2026-05-09, "승인".
- **변경**:
  * `web/src/tools/SelectTool.ts::onMouseDown` — face single-click 분기
    (clickCount === 1) 에 ADR-093 surface_owner walk 추가:
    - `getFaceSurfaceOwnerId(fid) >= 0` 시 `walkFaceOwnerSiblings(fid)`
      호출 → 첫 face 는 caller modifiers, 나머지는 additive (shift=true)
    - ADR-088 curve_owner walk 패턴 답습
    - **Defensive guard**: bridge mock 이 미구현 시 (`typeof !== 'function'`)
      legacy 단일 face 동작 보존 (다른 테스트 fixtures 호환)
    - Multi-click (double/triple) 분기는 변경 없음 — single-click 만
      group promote 적용 (Lock-in D-D minimal scope)
  * `web/src/tools/SelectTool.test.ts`:
    - default mock 에 `getFaceSurfaceOwnerId: -1` + `walkFaceOwnerSiblings:
      [fid]` 추가 (legacy 동작 보존)
    - 4 신규 D-δ 테스트:
      * single-click cylinder side → 5 group faces 모두 선택
      * standalone face (no group) → 단일 face 만 (legacy)
      * shift modifier → 첫 face shift, 나머지 additive
      * stale owner_id (group=[fid] only) → 단일 face fallback
- **회귀**:
  * vitest SelectTool.test.ts 40 → 44 (+4)
  * 합계 **+4**, 절대 #[ignore] 금지 4/4 준수
  * 전체 vitest 1650 → 1654 (D-γ +4 + D-δ +4 = +8 total since D-α
    baseline)
- **누적 회귀** (D-α ~ D-δ): axia-geo +8, axia-wasm +2, vitest +8 =
  **+18**, 절대 #[ignore] 금지 18/18 준수.
- **사용자 facing 변화**:
  * Cylinder 측면 click → 22 quad faces 일괄 선택 (사용자 intent: "측면
    = 1 entity")
  * 비-cylinder face click → 단일 face (기존 동작 보존)
  * shift / ctrl / alt modifier 정합성 보존

### D-ε (본 commit — closure)
- **사용자 결재**: 2026-05-09, "🅸 (D-ε closure) 먼저 — ADR-093 의
  architectural sealing".
- **사용자 시연 게이트 PASSED** (real Chromium, 2026-05-09):
  - Cylinder r=5, h=8 생성 → 25 faces (1 closed-curve self-loop +
    1 top + 1 bottom + ... 23 sides)
  - 측면 face id=11 click → walk → siblings 23 (모두 선택)
  - Inspector "체적 면 그룹" 으로 group 인식 + bounding box 10×10×8
  - Screenshot: cylinder 측면 light blue tint (23 quad faces 일괄 선택)
- **변경**:
  * `CLAUDE.md` LOCKED #35 — ADR-093 amendment entry (B-MVP closure
    + 누적 회귀 +18 + 사용자 facing 변화 + Path B-full trigger 갱신)
  * `docs/adr/090-true-kernel-native-cylinder-path-b.md` §6.3 —
    결함 2 selection 측면 ADR-093 으로 closure 표시
  * `docs/adr/README.md` — ADR-093 status `Proposed` → `Accepted`
  * 본 ADR §E Lessons 추가 (L1~L4)
- **회귀**: +0 (docs only).

## E. Lessons

### L1 — ADR-091 §E L1 canonical guidance 의 첫 명시 적용

**관찰**: 원안 (Face struct 에 surface_owner_id 추가, ADR-088 답습) 가
ADR-091 §E L1 ("bincode 로 직렬화되는 기존 struct 에 신규 필드 추가
**금지**, Mesh/Scene-level HashMap 사용") 위반. D-β 진입 사전 검토에서
즉시 발견 + 정정.

**정정**: `Mesh.face_to_surface_owner_id: FxHashMap<FaceId, u32>`
신규. Face struct UNCHANGED. Bincode legacy snapshot 호환 자연 보존.

**향후 ADR 가이드** (cumulative):
- ADR-088 (Edge.curve_owner_id struct field) 은 ADR-091 L1 canonical
  *이전* 결정 — 본 ADR 이 처음으로 L1 canonical 명시 적용 사례.
- ADR-088 의 retroactive migration (Edge struct field → Mesh-level
  map) 은 별도 트랙 (L1 canonical 의 backwards 적용).
- 향후 모든 owner-id / linkage 데이터는 *struct field 가 아닌 Mesh /
  Scene 레벨 map* 로 시작.

### L2 — ADR-088 패턴의 자연 확장 (curve → surface)

**관찰**: ADR-088 (Edge.curve_owner_id) 의 5-step Path Z atomic 패턴이
거의 1:1 답습 가능. ID type 만 다른 동일 architecture:

| 측면 | ADR-088 | ADR-093 |
|---|---|---|
| Schema | `Edge.curve_owner_id` | `Mesh.face_to_surface_owner_id` |
| Allocation | DrawCircle/Arc 시 1 ID | Cylinder 생성 시 N sides 동일 1 ID |
| Walker | `walk_edge_owner_siblings` | `walk_face_owner_siblings` |
| Selection | edge click → 같은 ID 일괄 | face click → 같은 ID 일괄 |
| 일수 | 2일 (5-step) | 2-3일 (5-step) |

**향후 ADR 가이드** — 같은 패턴이 *Vertex owner-id* (예: shared
endpoint of 다중 edges) 또는 *Volume owner-id* (다중 cylinder 가
하나의 boolean union solid 등) 로도 자연 확장 가능. 본 ADR 의 5-step
Path Z 답습.

### L3 — Defensive bridge guard (test fixture 호환)

**발견**: D-δ SelectTool 변경 후 다른 test fixture (SegmentVsCurveSelection,
IntegratedAnalyticHoverFlow) 의 bridge mock 이 ADR-093 methods 미구현
→ 4 tests fail.

**정정**: SelectTool 가 `typeof bridge.getFaceSurfaceOwnerId !==
'function'` 체크 후 legacy 단일 face 동작 fallback. WasmBridge wrapper
의 graceful fallback 패턴을 한 단계 위 (caller) 에서도 적용.

**향후 ADR 가이드** — bridge interface 확장 시 *caller layer 에서도
defensive guard* 활용. WasmBridge wrapper 의 `endpoint missing →
fallback` 만으로는 부족 (mock fixtures 가 typed wrapper 미통과 시).

### L4 — Path B-full 트리거 anchor 활성

**의의**: ADR-093 closure 후 ADR-090 §6.3 의 잔존 trigger 매트릭스가
정량 anchor 로 활성:
- ✅ 결함 2 selection 측면 — ADR-093 으로 closure
- ❌ 메모리 비용 (large model, 1000+ cylinder × N quads)
- ❌ STEP/IGES export 정확도 (DCEL 자체 polygon strip)
- ❌ 산업 CAD parity (analytic cylindrical face)
- ❌ Push-Pull again 누적 비용

**다음 결재 anchor**:
- 사용자 시연 만족 ("측면 = 1 entity 인식 충분") → Path B-full 보류
  유지, ADR-090 deferred 상태 유지
- 사용자 시연 불만족 ("memory / export / parity 등 추가 closure
  필요") → ADR-090 Path B-full 진입 결재 활성 (B-γ ~ B-θ, 4-6주)

**향후 ADR 가이드** — multi-week atomic 트랙 진입 전 *MVP atomic 으로
가치 확보 → 사용자 시연 → trigger 재평가* 패턴 권장 (🅺 path 답습).
ADR-091 §E L2 의 "사전 검토 가치" 와 함께 architectural risk 감소
canonical 패턴.
