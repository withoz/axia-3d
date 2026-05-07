# ADR-086 — WasmBridge Owner-ID Mapping for Imported BRep (Architectural Spec)

**Status**: **Accepted** (O-α spec only — code 변경은 후속 O-β ~ O-? 별도
atomic commits, **approach decision matrix 사용자 결재 필요**)
**Date**: 2026-05-08
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: 사용자 권장 path 결정 (2026-05-08, ADR-085 closure 후):
> "WasmBridge owner-ID 매핑 — import 결과 (face/edge) 를 axia engine
> ops (offset / extrude / push-pull / Boolean) 의 입력으로 사용 가능 →
> ADR-079/080 활용 unlock. *최대 architectural value*."
**Parent**: ADR-083 (T-γ userData.faceIndex), ADR-084 (E-γ userData.
edgeIndex), ADR-081 W-δ (BRep traversal stable index), ADR-037 P22
(Pick → Promote owner ID)
**Cross-cut**: ADR-079 (Create Solid 7 SolidKind), ADR-080 (Offset 8
host kinds × 6 curve types), ADR-046 P31, ADR-035 P20.C #2

---

## 0. Summary (8 lines)

> ADR-083/084 closure 로 import 된 STEP/IGES geometry 는 viewport 표시
> 가능하지만 axia engine DCEL 에 없음 — `THREE.Group { userData.faceIndex,
> userData.edgeIndex }` 만으로는 offset / extrude / push-pull / Boolean
> 등 engine ops 의 입력 불가. 본 ADR 은 import 결과를 axia engine 의
> *first-class entity* 로 승격하는 architectural 결정. 3 approach
> trade-off (A: full DCEL injection / B: lossy redraw / C: virtual face
> + surface-only) 결재 필요. 본 commit (O-α) 는 spec only — sub-atomic
> 분해는 approach 채택 후 결정.
> **Initial bundle 0MB strict (P20.C #2) 유지**.

---

## 1. Context

### 1.1 ADR-081~085 closure 후 현재 상태

| Layer | 상태 | Owner |
|---|---|---|
| OCCT chunk + WASM | ✅ Production build 통합 | ADR-082 C-ε |
| BRep traversal | ✅ stable index (W-δ) | ADR-081 W-δ |
| Surface promotion | ✅ AnalyticSurface enum 매핑 (W-γ) | ADR-081 W-γ |
| Trim loops | ✅ TrimCurve2D 변환 (W-ε) | ADR-081 W-ε |
| Face mesh (Three.js) | ✅ THREE.Group + userData.faceIndex | ADR-083 T-γ |
| Edge wireframe (Three.js) | ✅ LineSegments + userData.edgeIndex | ADR-084 E-γ |
| **axia engine DCEL face/edge** | ❌ **없음** — Three.js only | (본 ADR scope) |

### 1.2 사용자 facing impact

현재 (ADR-085 closure 후):
- ✅ STEP 파일 import → viewport 에 face mesh + edge 표시
- ✅ Stage progress Toast 안내
- ❌ 사용자가 import 된 face 선택 → 기능 없음 (axia FaceId 부재)
- ❌ 사용자가 import 된 face 에 offset / extrude → 동작 안 함
- ❌ 사용자가 import 된 face 에 Boolean union/subtract → 입력 불가

**Gap**: import 된 geometry 는 *display only* — *editable* 아님.

### 1.3 ADR-079 / ADR-080 의 제약

ADR-079 W-3-δ:
> "BezierPatch / BSplineSurface / NURBSSurface host 활성. Tessellation-
> based representative normal 재사용."

ADR-080 V-β-δ:
> "NURBS-class curves on Plane — chord-based Line perpendicular offset"

이 두 ADR 의 NURBS-class 활성은 *axia engine 에 face 가 존재* 하는 전제.
import 된 face 는 axia engine 부재 → 활성 의미 없음.

### 1.4 ADR-037 P22 owner-ID 정합

ADR-037 P22.7 (Pick → Promote, STEP/IGES 통합):
> "import 후 face/edge/vertex 에 axia owner ID 즉시 부여."

본 ADR 이 P22.7 의 자연 closure.

### 1.5 산업 CAD 기대치

산업 CAD viewer (SolidWorks/Fusion/CATIA) 사용자는:
- import 된 STEP face 클릭 → 선택됨
- 선택된 face 에 offset/extrude/Boolean → 정상 동작
- import 된 face 와 자체 그린 face 구분 없음 (first-class equality)

AXiA 가 P1 (건축/디자인) + P3 (AI 협업자) 페르소나에 부응하려면 이 부분
필수.

---

## 2. Decision

### 2.1 Approach trade-off (사용자 결재 필요)

본 ADR 의 핵심 결정은 *어떤 방식으로 import 결과를 axia 에 attach 하는가*.

#### Approach A — Full DCEL Injection

**Concept**: import 된 face/edge tessellation 결과를 axia engine 의
DCEL 로 변환 → 새 axia FaceId/EdgeId/VertexId 할당.

**Rust API 신규**:
```rust
// crates/axia-geo/src/operations/import_mesh.rs
pub fn inject_external_face(
    mesh: &mut Mesh,
    positions: &[f64],         // xyz × N
    triangles: &[u32],         // triangle × 3 (0-based)
    surface: Option<AnalyticSurface>,
    boundary_edges: &[BoundaryEdgePolyline],
) -> Result<FaceId, ImportError>;
```

**Pros**:
- Import 된 face 가 *완전한 first-class axia entity* — offset/extrude/
  Boolean 모두 동작
- ADR-079/080 NURBS-class 활성 자연 활용
- ADR-037 P22 owner-ID 완전 정합
- 사용자 facing equality (자체 그린 face 와 구분 없음)

**Cons**:
- **큰 scope** — Rust 측 새 API + manifold validation + edge stitching
  + non-manifold graceful 처리
- **회귀 위험** — DCEL invariant (ADR-007 / ADR-021 / ADR-025) 와 정합
  필요. 외부 mesh 의 임의 형태 (triangle soup / non-manifold) 처리
- **시간**: 5+ commits (Rust core / WASM bridge / TS wrapper /
  StepIgesImporter integration / 회귀 + corpus 검증)
- **번역 손실** — OCCT BRep → DCEL 변환 시 일부 정보 손실 (e.g.,
  trim loops 의 정확한 boundary curve 가 polyline 으로 단순화)

#### Approach B — Lossy Redraw

**Concept**: import 된 face 의 boundary 를 기존 `bridge.drawRect /
drawCircle / drawLine` API 로 재구성 → axia 에 새 face 생성.

**Pros**:
- 기존 API 재사용 — 새 Rust 코드 거의 없음
- DCEL invariant 자연 보장 (기존 draw path 가 처리)

**Cons**:
- **Lossy** — analytic surface (NURBS / B-spline) 는 그릴 수 없음.
  primitive (Plane + boundary 원/직선) 만 가능
- 산업 CAD 의 핵심 (curved surfaces) 처리 불가
- ADR-079 W-3-δ NURBS-class 활성 의 의의 상실
- **사실상 minimum scope** — primitive face 만 unlock

#### Approach C — Virtual Face (Surface-Only)

**Concept**: import 된 face 마다 axia FaceId 만 *예약* (DCEL 부재).
analytic surface 를 attach. Edge 도 EdgeId 예약 + analytic curve attach.
DCEL boundary 는 *없음* — face 는 virtual.

**Rust API 신규**:
```rust
pub fn allocate_virtual_face(
    mesh: &mut Mesh,
    surface: AnalyticSurface,
) -> FaceId;
pub fn allocate_virtual_edge(
    mesh: &mut Mesh,
    curve: AnalyticCurve,
) -> EdgeId;
```

**Pros**:
- **최소 scope** — DCEL 변환 없이 ID + surface/curve 만 할당
- ADR-079/080 NURBS-class 의 surface evaluation 부분만 활성 가능
  (offset/extrude 의 일부 path 가 surface-only 사용)
- 사용자 selection 가능 (FaceId 존재)

**Cons**:
- **불완전한 first-class** — Boolean / merge / split 같이 *DCEL boundary
  접근* 필요한 op 는 동작 안 함
- 사용자 expectation gap — "선택은 되는데 일부 op 만 됨" 의 혼란
- ADR-007 / ADR-016 / ADR-025 invariant 와 conflict 가능 (face 가
  DCEL 에 없으면 invariant verifier 가 실패)

#### Approach 비교 매트릭스

| 차원 | A: DCEL Injection | B: Lossy Redraw | C: Virtual Face |
|---|---|---|---|
| Engine ops 활성 범위 | **All** (offset/extrude/Boolean) | Primitive 만 (Plane + 원/직선) | Surface-only ops 일부 |
| NURBS-class import 가치 | ✅ 완전 | ❌ 손실 | ⚠️ 부분 |
| 코드 scope | **큼** (5+ commits) | 작음 (2-3 commits) | 중 (3-4 commits) |
| 회귀 위험 | **높음** (DCEL invariant) | 작음 | 중 (invariant conflict) |
| 사용자 expectation 정합 | ✅ Industry CAD parity | ❌ "왜 Boolean 안 됨?" | ⚠️ 부분적 혼란 |
| ADR-037 P22.7 정합 | ✅ 완전 | ⚠️ primitive 만 | ⚠️ 부분 |

### 2.2 Lock-ins L1 ~ L7 (approach-agnostic)

본 ADR 의 lock-in 은 approach 결정에 *무관* 하게 적용:

- **L1 — userData → axia ID 매핑 책임**: `StepIgesImporter._convertToThreeGroup`
  결과의 `userData.faceIndex` / `userData.edgeIndex` 가 axia
  FaceId / EdgeId 로 *변환* 가능해야 함. 변환 mapping 은 별도
  Map<traversalIndex, axiaFaceId> 로 관리.
- **L2 — Backward compat**: 기존 ADR-083 T-γ / ADR-084 E-γ 의 group
  구조 (face-N + edges sub-group) 보존. owner-ID attach 는 *추가
  정보* 만 (userData 확장 또는 별도 metadata).
- **L3 — Initial bundle 0MB strict** (P20.C #2 답습).
- **L4 — Failure mode**: 어떤 approach 든 P21.7 답습 — 부분 실패 시
  warnings 누적, fatal 아님. 일부 face 가 axia 에 attach 실패해도
  나머지는 성공.
- **L5 — ADR-007 / ADR-016 / ADR-021 / ADR-025 invariant 정합**:
  Approach A 채택 시 import 된 face 가 axia DCEL invariant 모두 충족
  필요. Approach C 는 virtual face 가 invariant verifier 에 *제외*
  되어야 함.
- **L6 — Selection / pick UX**: 사용자가 import 된 face 클릭 →
  axia FaceId 반환 (ADR-037 P22.4 highlight by owner ID 정합).
- **L7 — Engineering note**: 본 ADR 은 *opinionated* — approach 간
  명확한 trade-off 가 있음. 사용자 결재 후 한 approach 채택 + 명시적
  out-of-scope 처리. 다른 approach 는 future ADR 에서 (필요 시) 활성.

### 2.3 Out of scope (approach 결정 후 별도 ADR)

- **OBJ/STL/glTF import** owner-ID 매핑 — 본 ADR 은 STEP/IGES 한정.
  다른 mesh 포맷은 별도 ADR.
- **Persistence** — import 결과 axia state 의 .axia 저장. ADR-078
  pattern 답습 가능 — 별도 ADR.
- **Edge selection / hover** — owner-ID 매핑 후 사용자 facing pick UX.
  ADR-037 P22 cross-cut 별도.
- **Material / texture metadata** — STEP 의 색상 / material 정보를
  axia material slot 에 매핑. ADR-046 cross-cut 별도.
- **ADR-007/016/021/025 invariant 충족 검증 corpus** — Approach A
  채택 시 산업 CAD 코퍼스 round-trip 검증.

---

## 3. Implementation Plan (post-acceptance, approach-dependent)

### 3.1 O-α — ADR-086 spec only — ✅ 본 commit

본 commit 이 O-α. spec docs 작성만, 코드 변경 0. **사용자 approach
결재 (A / B / C) 필요**.

### 3.2 후속 sub-step (approach-dependent)

#### Approach A — Full DCEL Injection (권장 anchor — first-class)

- O-β: `Mesh::inject_external_face` Rust core (positions/triangles/
  surface/boundary) — manifold validation + ADR-007 winding 정합
- O-γ: WASM bridge + TS wrapper (`bridge.injectExternalFace`)
- O-δ: `StepIgesImporter` integration — `_convertToThreeGroup` 결과
  + traversal 결과를 사용해 inject 호출 + faceIndex → FaceId map
- O-ε: 회귀 corpus + invariant 검증
- O-ζ: LOCKED #33 + closure
- 예상 commit: 5+ atomic, vitest +15~25, axia-geo +10~20
- 예상 시간: 큰 트랙 (1-2 sessions)

#### Approach B — Lossy Redraw (작은 scope)

- O-β: `StepIgesImporter` 가 import 결과의 Plane primitive + boundary
  를 기존 `bridge.drawRect/drawLine` API 로 재구성
- O-γ: faceIndex → FaceId map 유지
- O-δ: LOCKED #33 + closure
- 예상 commit: 2-3 atomic, vitest +5~10, axia-* 0
- 예상 시간: 작은 트랙 (single session)
- 한계: NURBS-class 의 의의 상실

#### Approach C — Virtual Face (중간 scope)

- O-β: `Mesh::allocate_virtual_face / virtual_edge` Rust core
- O-γ: `Mesh::set_virtual_face_surface / set_virtual_edge_curve`
- O-δ: ADR-007 invariant verifier 에 virtual face 제외 (skip flag)
- O-ε: WASM + TS bridge
- O-ζ: StepIgesImporter integration
- O-η: LOCKED #33 + closure
- 예상 commit: 4-5 atomic, vitest +10~15, axia-geo +5~10
- 예상 시간: 중 트랙 (1 session)

### 3.3 누적 회귀 예상 (approach 결정 후 정확)

- vitest: approach A +15-25 / B +5-10 / C +10-15
- axia-geo: approach A +10-20 / B 0 / C +5-10
- Initial bundle: 0MB strict (P20.C #2) — 모든 approach
- 시간: A=multi-session / B=single / C=single

---

## 4. Acceptance Criteria

O-α 본 commit 으로 만족:

- [x] ADR-086 spec 작성 (§0 ~ §6)
- [x] 3 approach 의 trade-off 매트릭스 명시
- [x] L1 ~ L7 lock-ins (approach-agnostic) 명시
- [x] Out of scope 5항목 명시
- [x] approach-dependent sub-atomic 로드맵 3개 모두 제시
- [x] 누적 회귀 예상 + 코드 scope 비교
- [x] 사용자 가치 anchor (engine ops 활성 + first-class equality)

본 ADR 의 commit 만으로 O-α 완료. **후속 O-β ~ O-? 는 사용자 approach
결재 (A/B/C) 후 별도 atomic + 별도 결재**.

---

## 5. Cross-references

- **ADR-083 LOCKED #30 T-γ** — userData.faceIndex 가 본 ADR 의 source
- **ADR-084 LOCKED #31 E-γ** — userData.edgeIndex 가 본 ADR 의 source
- **ADR-081 W-δ** — BRep traversal stable index 는 axia ID 매핑의 base
- **ADR-037 P22.7** — STEP/IGES import 통합 owner-ID 정합 의 자연 closure
- **ADR-079 / ADR-080** — NURBS-class 활성의 *사용자 가치 unlock* 의존
  (Approach A 만 완전 활성)
- **ADR-007 / ADR-016 / ADR-021 / ADR-025** — DCEL invariant — Approach A
  의 회귀 위험 source
- **ADR-046 P31** — P1+P3 페르소나 가치 anchor — *industry CAD parity*
  은 Approach A 만 충족

---

## 6. Lessons (작성 시점)

- **Architectural trade-off 의 명시화**: 3 approach 의 trade-off 가
  *기술적으로* 명확하나 *제품 가치적으로* 다르다. 사용자 결재 없이는
  채택 결정 불가 — *최단 path* 와 *최대 가치 path* 가 다름.
- **Layer 분리의 결과**: ADR-083 (face mesh) / ADR-084 (edge wireframe)
  / ADR-085 (Toast) 는 모두 *display only* layer. 본 ADR 이 처음으로
  *engine state* layer 와의 bridge 를 다룬다 — 더 깊은 architectural
  decision.
- **MVP 의 layered 진행 한계**: ADR-083~085 의 layered approach (각
  ADR 이 작은 incremental value) 가 본 ADR 에서는 한계 — *first-class
  equality* 는 partial 로 의미 없음. Approach 결정이 binary.
- **의도적 spec-only commit**: 본 commit 은 O-α 로 closure 가능하지만
  실제 가치는 후속 O-β 부터. *사용자 결재의 명시적 분리* — architectural
  decision 을 implementation 시작 전에 lock-in.
- **Sub-atomic 분해의 approach-dependence**: 동일 ADR 의 sub-atomic
  로드맵이 approach 별로 다름. 본 ADR 의 § 3.2 가 3개 path 모두 제시
  — 사용자가 path 선택 후 path-내 sub-atomic 진행.

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: **Accepted**
(O-α spec only commit 2026-05-08). Approach (A/B/C) 결재 후 O-β ~ O-?
별도 commit 으로 구현.

**사용자 결재 요청**:
1. **Approach A (Full DCEL Injection)** — 권장 anchor (first-class
   equality + industry CAD parity). 큰 scope, 5+ commits, 회귀 위험 중.
2. **Approach B (Lossy Redraw)** — 최소 scope. 2-3 commits, NURBS-class
   의의 상실.
3. **Approach C (Virtual Face)** — 중간. 4-5 commits, 사용자 facing
   부분 혼란 가능.
4. **Defer** — 본 ADR closure cap, 다른 트랙 (e.g., LOCKED #31/#32 의
   다른 cross-trigger) 진입.

권장: **A** (architectural value 가장 큼, 사용자 expectation 정합).
