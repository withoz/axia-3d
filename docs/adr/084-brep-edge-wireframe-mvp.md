# ADR-084 — BRep Edge Wireframe Rendering MVP (Visual Topology Unlock)

**Status**: **Accepted** (E-α spec only — code 변경은 후속 E-β ~ E-δ
별도 atomic commits)
**Date**: 2026-05-08
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: 사용자 권장 path 결정 (2026-05-08):
> "ADR-083 visual unlock 후 demo quality 추가 향상 — face mesh 만으로
> 는 BRep topology (edge) 가 명시적으로 안 보임. CAD 사용자에게 *edge*
> 는 critical visual cue (chamfer/fillet/sharp boundary 식별).
> 최단 demo 가치 path 의 첫 보강."
**Parent**: ADR-083 (BRepMesh Tessellation MVP), ADR-082 (OCCT.js
Real Runtime), ADR-081 W-δ (BRep traversal)
**Cross-cut**: ADR-035 P20.C #2 (initial bundle 0MB), ADR-046 P31
(P1+P3 visual 가치), ADR-018 (render policy)

---

## 0. Summary (6 lines)

> ADR-083 closure 후 STEP/IGES import 시 face mesh 는 표시되지만
> BRep edge 가 명시적으로 표현 안 됨 → 산업 CAD 사용자가 기대하는
> *edge wireframe* 부재 (chamfer/fillet 식별 불가). 본 ADR 은 OCCT
> `BRep_Tool.Polygon3D(edge, location)` 로 BRep edge 별 polyline 추출
> + Three.js `LineSegments` 변환 + `_convertToThreeGroup` 의 edges
> sub-group 에 추가. ADR-018 edge render policy (#333366 기본 색상)
> 답습. 4 sub-atomic 분해 (E-α/β/γ/δ).

---

## 1. Context

### 1.1 ADR-083 closure 가 unblock 한 visual layer

ADR-083 T-γ (commit `26e51ae`):
- `_convertToThreeGroup` 본체 활성 — face 별 Three.js Mesh 표시
- ADR-046 two-tone 재질 적용 (front #e8e8e8 / back #9898b4)
- W-δ stable index → `face-{N}` Group 명명

**그러나**: face Mesh 만으로는 다음이 부재:
- BRep edge boundary 의 명시적 표시 (face 와 face 의 경계선)
- chamfer / fillet / sharp edge 의 시각적 식별
- Engineering 의도 (예: "이 boundary 는 직선/원호/스플라인" 인지)

이는 demo readiness 80%+ 의 *quality* 측면에서 추가 보강 필요.

### 1.2 산업 CAD 의 edge rendering 표준

SolidWorks / Fusion / FreeCAD / Onshape — 모든 산업 CAD viewer 는:
- BRep face shading + **BRep edge wireframe** 동시 표시
- Edge 색상: 보통 검은색 / 짙은 회색 (대비 강조)
- Sharp edge (각도 > threshold) 와 silhouette edge 구분 (선택적)

AXiA 의 ADR-018 정책 (FileImporter.applyDefaultStyle 답습):
- Edge wireframe `LineMaterial #333366` 일관

### 1.3 OCCT BRep edge polyline API

OCCT 가 BRepMesh_IncrementalMesh 적용 후 face mesh 에 부착하는 부산물:
- `BRep_Tool.Polygon3D(edge, location) -> Handle_Poly_Polygon3D` —
  edge 의 3D polyline (vertex 시퀀스)
- `Poly_Polygon3D`:
  * `NbNodes()` — vertex 개수
  * `Nodes()` — TColgp_Array1OfPnt
  * `Node(i)` — gp_Pnt (1-based)

대안:
- `BRep_Tool.PolygonOnTriangulation(edge, triangulation, location)` —
  face mesh 와 정합되는 polygon. 본 ADR 의 MVP 는 Polygon3D 로 충분.

### 1.4 사용자 가치 anchor (ADR-046 P31)

- **P1 (건축/디자인)**: import 후 BRep edge 시각 → 모델 구조 즉각
  파악
- **P3 (AI 협업자)**: AI agent 가 import 결과 시각 검증 시 edge 정보
  도 화면에 가시 → debugging 용이

**Demo readiness 80% → 90%+** 가 본 ADR 의 incremental gain.

---

## 2. Decision

### 2.1 Lock-ins L1 ~ L7

- **L1 — Edge polyline source**: `BRep_Tool.Polygon3D(edge, location)`
  사용 — BRepMesh_IncrementalMesh 부산물 (T-β 의 mesh 적용 후 가용).
  PolygonOnTriangulation 은 face mesh 정합 필요 시 future ADR.
- **L2 — Per-edge BufferGeometry**: 각 BRep edge → `THREE.LineSegments`
  with `BufferGeometry` (position attribute only). W-δ stable index
  답습 (`edge-{N}` 명명).
- **L3 — Edge material**: `THREE.LineBasicMaterial` 색상 **#333366**
  (ADR-018 + FileImporter.defaultEdgeMat 일관).
- **L4 — Group 구조**: `_convertToThreeGroup` 결과에 `edges` sub-group
  추가:
  - 본 group: `THREE.Group { name: 'STEP: foo.step' }`
    - `face-{N}` (T-γ 답습)
    - `face-{M}` ...
    - **`edges`** (NEW): `face-N` 외부에 별도 sub-group
      - `edge-{0}` LineSegments
      - `edge-{1}` ...
- **L5 — Failure mode** (P21.7 답습): per-edge Polygon3D null →
  edge-level warning, skip. Empty polyline → skip mesh creation.
  Fatal 아님.
- **L6 — Initial bundle 0MB strict** (P20.C #2 답습): `tessellateEdges`
  코드는 `occtTessellate.ts` 확장 + `StepIgesImporter` chunk 영역만.
- **L7 — `traverseBrep` (W-δ) 와의 정합**: stable edge index 0-based
  답습 — caller 가 `userData.edgeIndex` 로 axia EdgeId 매핑 가능
  (별도 ADR 의 owner-ID attach 와 cross-cut).

### 2.2 Out of scope (별도 ADR)

- **PolygonOnTriangulation** — face mesh 정합 edge polyline. 본 ADR 의
  Polygon3D 가 단독 polyline 으로 충분. 향상은 future.
- **Edge selection / hover** — pick to edge. ADR-037 P22 wiring 별도.
- **Sharp edge vs silhouette edge 구분** — 색상 / 두께 차별화. 본
  ADR 은 단일 색상 #333366.
- **Edge thickness slider / LOD** — 별도 UI ADR.
- **WasmBridge owner-ID 매핑** — `userData.edgeIndex` 를 axia EdgeId
  로 attach. ADR-037 P22.7 trajectory.
- **Curve metadata visualization** — analytic curve (Line/Arc/Circle/
  NURBS) 정보 표시. ADR-040 hover 와 cross-cut.

### 2.3 Decision matrix (사전 검토 §84-A ~ §84-D)

본 ADR 진입 직전 사용자 결재 (2026-05-08, 권장 path) 의 권장값:
- **§84-A**: BRep_Tool.Polygon3D 사용 (Polygon3D 단독 polyline)
- **§84-B**: Per-edge LineSegments (선별 stable index 답습)
- **§84-C**: Edge color #333366 (ADR-018 + FileImporter 일관)
- **§84-D**: 4 sub-atomic (E-α/β/γ/δ) — minimum scope

---

## 3. Implementation Plan (post-acceptance)

### 3.1 E-α — ADR-084 spec only — ✅ 본 commit

본 commit 이 E-α. spec docs 작성만, 코드 변경 0.

### 3.2 E-β — `tessellateEdges` API + tests

`occtTessellate.ts` 에 함수 추가:

```typescript
export interface EdgeTessellation {
  /** 0-based traversal index (W-δ 답습). */
  index: number;
  /** Polyline positions (xyz × N). */
  positions: Float32Array;
}

export interface EdgesTessellateResult {
  edges: EdgeTessellation[];
  warnings: string[];
}

export function tessellateEdges(
  occt: unknown,
  shape: unknown,
): EdgesTessellateResult;
```

알고리즘:
- BRepMesh_IncrementalMesh 가 이미 적용된 shape (T-β tessellateShape
  와 같은 시점에 호출 가능)
- `TopExp_Explorer(shape, TopAbs_EDGE)` 로 edge 순회
- 각 edge → `BRep_Tool.Polygon3D(edge, location)` → Handle_Poly_Polygon3D
- `Nodes()` 또는 `Node(i)` 로 polyline 추출
- 인접 vertex 쌍 → `LineSegments` index (`[0,1, 1,2, 2,3, ...]`)
- Empty / null → warning, skip

회귀: vitest +3~5 (mock-based — Polygon3D mock + edge 순회 + W-δ stable
index).

### 3.3 E-γ — `_convertToThreeGroup` wiring (edges sub-group)

`StepIgesImporter._convertToThreeGroup` 본체 갱신:
1. 기존 face mesh 생성 후
2. `tessellateEdges(occt, shape)` 호출
3. `edges` sub-group 생성:
   - per edge: `THREE.LineSegments` with `BufferGeometry` (positions
     only, indexed)
   - LineBasicMaterial 단일 인스턴스 공유 (#333366)
   - `userData.edgeIndex` (W-δ stable index 답습)
4. `group.add(edgesGroup)` — face-N siblings 외부에 별도 sub-group
5. tessellation warnings 누적

회귀: vitest +2~3 (StepIgesImporter test 답습 — edges sub-group 검증).

### 3.4 E-δ — LOCKED #31 + closure (docs only)

- LOCKED #31 (ADR-084 closure) 거버넌스 등재 — LOCKED #28~#30 패턴 답습
- 사용자 visual demo (선택적) → 별도 follow-up
- 회고 commit (docs only)

회귀: 0.

### 3.5 누적 회귀 예상

- vitest **+5~8** (E-β 3~5 + E-γ 2~3)
- Playwright: T-δ slow channel 의 기존 회귀가 자동 검증 (edges 추가 →
  group.children 수 증가 → 기존 invariant ≥ 1 영향 없음)
- Initial bundle: 0MB strict 유지 (P20.C #2). occtTessellate.ts 확장
  분만 chunk 영향.

---

## 4. Acceptance Criteria

E-α 본 commit 으로 만족:

- [x] ADR-084 spec 작성 (§0 ~ §6)
- [x] ADR-083 / ADR-082 / ADR-081 / ADR-035 / ADR-018 cross-link 명시
- [x] L1 ~ L7 lock-ins 명시
- [x] §84-A ~ §84-D 사전 검토 결과 정합
- [x] E-α ~ E-δ 4 sub-atomic 로드맵 명시
- [x] Out of scope (PolygonOnTriangulation / selection / sharp-edge /
  thickness / owner-ID / curve metadata) 명시
- [x] 사용자 가치 anchor (P1 / P3 페르소나, demo 80%→90%) 명시
- [x] OCCT BRep edge API 핵심 정리

본 ADR 의 commit 만으로 E-α 완료. 후속 E-β ~ E-δ 별도 atomic +
별도 결재.

---

## 5. Cross-references

- **ADR-083** (BRepMesh Tessellation MVP) — 본 ADR 의 직접 trigger.
  T-γ visual unlock 위에 edge layer 자연 연장. tessellateShape 와
  같은 occtTessellate.ts 모듈 확장.
- **ADR-082** (OCCT.js Real Runtime) — drift #1~#5 fix 위에 진행.
  Polygon3D API 가 OCCT 정상 init 후 가용.
- **ADR-081 W-δ** (BRep traversal) — stable edge index (`edge-{N}`)
  답습.
- **ADR-035 P20.C #2** (initial bundle 0MB) — strict 유지. 본 ADR 코드
  는 StepIgesImporter chunk 영역만.
- **ADR-046 P31** P1+P3 페르소나 visual 가치 — edge wireframe 이
  CAD 사용자 facing 표준.
- **ADR-018** (Two-tone render policy) — edge color #333366 일관.

---

## 6. Lessons (작성 시점)

- **MVP layer 분리**: ADR-083 (face mesh) → ADR-084 (edge wireframe)
  → 다음 (material / texture / selection) 의 layered 진행. 각 layer
  가 *independently demo-able* — minimum scope 가 maximum incremental
  value.
- **OCCT 부산물 활용**: BRepMesh_IncrementalMesh 적용 후 edge polygons
  도 자동 생성. 별도 algorithm 없이 *기존 작업 결과를 second pass 로
  추출* — 가성비 최대.
- **Three.js LineSegments vs Line**: 본 ADR 은 LineSegments (indexed
  pair) — Line 보다 explicit. 향후 dashed / colored gradient 도 지원
  가능.
- **Sub-atomic 4 vs 5**: ADR-083 은 5 (T-α/β/γ/δ/ε), 본 ADR 은 4
  (E-α/β/γ/δ). MVP 의 minimum scope 가 작아짐 — *layer 추가는 작은
  ADR 가치 안정 패턴* 의 첫 사례.

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: **Accepted**
(E-α spec only commit 2026-05-08). E-β ~ E-δ 별도 commit 으로 구현.
