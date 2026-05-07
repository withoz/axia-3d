# ADR-083 — BRepMesh Tessellation MVP (Visual Verification Unlock)

**Status**: **Accepted** (T-α spec only — code 변경은 후속 T-β ~ T-ε
별도 atomic commits)
**Date**: 2026-05-08
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: 사용자 가치 평가 결정 (2026-05-08):
> "ADR-082 C-ε amendment closure 후 demo readiness 0% — viewport 가
> 비어 있어 사용자가 import 결과를 *볼 수 없음*. BRepMesh tessellation
> MVP 가 visual verification 의 첫 unlock. 사용자 검증의 진짜 의미는
> '표현된 결과를 보는 것'."
**Parent**: ADR-082 (OCCT.js 실설치 + Real Runtime Activation), ADR-081
(STEP/IGES NURBS-class Import)
**Cross-cut**: ADR-035 P20.C #2 (initial bundle 0MB), ADR-046 P31 (P1
+ P3 페르소나 가치), ADR-038 P23 (Surface-Aware Normals)

---

## 0. Summary (6 lines)

> ADR-082 C-ε amendment closure 후 OCCT 가 production build 에서 실
> 사용 가능하지만 `StepIgesImporter._convertToThreeGroup` placeholder 가
> 빈 THREE.Group 만 반환 → viewport 표시 0건 → demo readiness 0%.
> 본 ADR 은 OCCT 의 BRepMesh_IncrementalMesh + TopExp_Explorer 를
> 활용해 BRep face 를 Three.js BufferGeometry 로 tessellate 하는 MVP.
> 첫 사용자 facing visual verification unlock — STEP/IGES 파일 열면
> 실제로 viewport 에 mesh 표시. 5 sub-atomic 분해 (T-α/β/γ/δ/ε).
> Initial bundle 0MB strict 유지 (P20.C #2).

---

## 1. Context

### 1.1 ADR-082 closure 가 unblock 한 것

ADR-082 C-α ~ C-ε amendment (commits `fb11a8d` ~ `5cbf137`, 2026-05-07~08):
- OCCT.js 가 production build 에 정상 통합 (Drift #3 architectural fix)
- `opencascade-deps-{hash}.js` lazy chunk + 50+ WASM static assets
- `loadOcct` container entry — Vite static analysis 활용 access point
- Wrapper drift 5건 모두 진단 + 해결/봉인 (Drift #1~#5)

**누적 회귀**: vitest +8, Playwright +2. **Initial bundle 724.84 kB**
(+80 bytes, P20.C #2 spirit 유지).

### 1.2 ADR-082 §알려진 한계 #2 의 자연 closure 트리거

ADR-082 spec §2.2 (Out of scope):
> "BRepMesh tessellation — `_convertToThreeGroup` 본체 별도 ADR."

ADR-082 LOCKED #29 §사용자 검증 가능 범위:
> "⏸️ Visual verification: `_convertToThreeGroup` placeholder — viewport
> 빈 group → demo readiness 0% 유지"

본 ADR 이 그 자연 closure.

### 1.3 사용자 가치 anchor (ADR-046 P31)

**진짜 user verification 의 의미**:
- ❌ "Toast 메시지 보기" — 작동 신호 만, 실제 결과 부재
- ❌ "DevTools console 검증" — 개발자 영역
- ✅ **"viewport 에 STEP 파일 mesh 표시"** — 사용자가 직접 본다
  - P1 (건축/디자인): SolidWorks 모델 가져와서 보고 편집
  - P3 (AI 협업자): AI agent 가 import 결과를 시각적으로 확인

**Demo readiness 0% → 80%+** 는 본 ADR 의 핵심 unlock.

### 1.4 OCCT BRepMesh API 핵심

- `BRepMesh_IncrementalMesh(shape, lineDeflection, isRelative=false,
  angleDeflection=0.5, isInParallel=false)`:
  - Shape 의 모든 face 에 mesh 부착 (in-place)
  - lineDeflection: chord tolerance (단위: shape 단위 — STEP 은 mm)
  - angleDeflection: angle tolerance (radians)
- `BRep_Tool::Triangulation(face, location)`:
  - face 의 mesh 추출 (Handle_Poly_Triangulation)
- `Poly_Triangulation`:
  - `NbNodes()` / `Node(i)` — vertices (gp_Pnt)
  - `NbTriangles()` / `Triangle(i)` — triangle 인덱스 (1-based)
  - `Normal(i)` — vertex normals (선택적)

---

## 2. Decision

### 2.1 Lock-ins L1 ~ L7

- **L1 — BRepMesh entry**: `BRepMesh_IncrementalMesh` 사용. shape 단위
  in-place mesh 부착. lineDeflection default **0.1 mm** (1e-1, 산업
  표준 visual quality), angleDeflection default **0.5 rad** (~28.6°).
- **L2 — Tessellation 시점**: `StepIgesImporter._convertToThreeGroup`
  내부에서 `_readShape` 직후 + `traverseBrep` 직후 (W-δ 결과 활용).
  Mesh 부착 후 face 별 BufferGeometry 생성.
- **L3 — Three.js 매핑**:
  - Each `TopoDS_Face` → `THREE.Mesh` with `BufferGeometry`
  - position attribute: `Float32Array` (vertex 3 × N)
  - normal attribute: `Float32Array` (vertex normal 3 × N) — analytic
    surface 가용 시 ADR-038 P23 적용 가능 (별도 sub-step)
  - index attribute: `Uint32Array` (triangle index 3 × M)
  - 재질: ADR-046 default style (TwoTone Two-tone — 외부 #e8e8e8 / 내부
    #9898b4) 적용
- **L4 — Tessellation tolerance**: 사용자 settings 불필요 (MVP). 향후
  ADR 에서 LOD / quality slider 추가 가능. 본 ADR 은 fixed default 만.
- **L5 — Failure mode** (P21.7 답습): `BRepMesh_IncrementalMesh` 실패
  / `Triangulation` null 시 face 별 `ImportResult.warnings` 누적,
  fatal 아님. Empty Mesh 도 valid output (placeholder 보다 honest).
- **L6 — Initial bundle 0MB strict** (P20.C #2 답습): tessellation
  코드는 `StepIgesImporter` chunk 영역만 변경. initial bundle 영향 0.
- **L7 — Visual verification** (사용자 결재 가치 anchor): 본 ADR closure
  시 사용자가 STEP 파일 열면 viewport 에 mesh **표시**. demo readiness
  의 *visual* 측면 unlock.

### 2.2 Out of scope (별도 ADR)

- **WasmBridge owner-ID 매핑**: `bridge.setFaceSurface*` + axia FaceId
  attach. 본 ADR 은 *visual rendering only* (Three.js 측). 별도 ADR.
- **Edge wireframe rendering**: BRep edge 를 별도 LineSegments 로
  표시. 별도 ADR (ADR-038 P23 cross-cut 가능).
- **Real init slow channel**: ADR-082 Drift #5 (180s+ init) 의 사용자
  facing UX 개선. 별도 ADR.
- **Corpus fixture (NIST/SolidWorks/etc)**: ADR-082 §3.5.1. 별도 ADR.
- **LOD / quality slider**: chord/angle tolerance UI. 별도 ADR.
- **Material / texture mapping**: STEP 의 색상/material 정보 활용. 별도
  ADR.
- **Edge metadata visualization**: import 후 면/엣지 선택 → analytic
  surface/curve 정보 표시. 별도 ADR.

### 2.3 Decision matrix (사전 검토 §83-A ~ §83-E)

본 ADR 진입 직전 사용자 결재 (2026-05-08) 의 권장값 모두 채택:
- **§83-A**: BRepMesh_IncrementalMesh 사용 (OCCT 표준 tessellation)
- **§83-B**: lineDeflection 0.1 mm + angleDeflection 0.5 rad (산업
  표준 visual quality)
- **§83-C**: Per-face BufferGeometry (W-δ stable index 활용 가능)
- **§83-D**: ADR-046 default two-tone 재질 (우리 프로덕션 일관성)
- **§83-E**: 5 sub-atomic (T-α/β/γ/δ/ε) — minimum scope

---

## 3. Implementation Plan (post-acceptance)

### 3.1 T-α — ADR-083 spec only — ✅ 본 commit

본 commit 이 T-α. spec docs 작성만, 코드 변경 0.

### 3.2 T-β — `BRepMesh_IncrementalMesh` 적용 + Triangulation 추출

- `StepIgesImporter._convertToThreeGroup` 의 placeholder 제거
- `_readShape` 결과 (TopoDS_Shape) 를 `BRepMesh_IncrementalMesh` 인자
  로 전달 → in-place mesh 부착
- `TopExp_Explorer` 로 face 순회 + `BRep_Tool.Triangulation(face,
  location)` 로 mesh 추출
- 각 face 의 vertex / normal / index buffer 추출 (Float32Array /
  Uint32Array)
- 실패 시 warnings 누적

회귀: vitest +2 (mock-based — Triangulation API surface 검증), 별도
real-runtime 검증은 T-δ Playwright.

### 3.3 T-γ — Three.js BufferGeometry + Mesh 생성

- Per-face BufferGeometry 생성:
  - `setAttribute('position', new BufferAttribute(positions, 3))`
  - `setAttribute('normal', new BufferAttribute(normals, 3))`
  - `setIndex(new BufferAttribute(indices, 1))`
- `THREE.Mesh(geometry, defaultStyle.frontMat)` + back mesh
  (defaultStyle.backMat) 답습
- THREE.Group 에 추가 → `_convertToThreeGroup` 반환
- Edge wireframe / texture 등은 별도 ADR

회귀: vitest +2 (mock-based geometry 생성 검증).

### 3.4 T-δ — Playwright real Chromium round-trip

- ADR-082 Playwright 인프라 답습 (`web/e2e/occt-runtime.spec.ts`)
- 사용자 자체 STEP 파일 fixture 또는 minimal hand-crafted STEP file
  (~1 face)
- `traversal.faces.length >= 1` + `group.children.length >= 1`
  + `group.children[0] instanceof THREE.Mesh` ground truth
- ADR-082 Drift #5 (init timing) 우회 — slow channel 또는 timeout 확장
  (180s+)

회귀: Playwright +1 (real round-trip ground truth).

### 3.5 T-ε — 사용자 시연 + LOCKED #30 갱신

- 사용자 manual verification (npm run preview + STEP 파일 import)
- Demo readiness 평가 (visual quality / 사용자 만족도)
- LOCKED #30 (ADR-083 closure) 거버넌스 등재
- 회고 commit (docs only)

회귀: 0 (docs only)

### 3.6 누적 회귀 예상

- vitest **+4** (T-β 2 + T-γ 2)
- Playwright **+1** (T-δ)
- Rust / Bundle: 0 (TS-only 변경, P20.C #2 strict)

---

## 4. Acceptance Criteria

T-α 본 commit 으로 만족:

- [x] ADR-083 spec 작성 (§0 ~ §6)
- [x] ADR-082 / ADR-081 / ADR-035 / ADR-046 cross-link 명시
- [x] L1 ~ L7 lock-ins 명시
- [x] §83-A ~ §83-E 사전 검토 결과 정합
- [x] T-α ~ T-ε 5 sub-atomic 로드맵 명시
- [x] Out of scope (WasmBridge / Edge wireframe / slow channel /
  corpus / LOD / material) 명시
- [x] 사용자 가치 anchor (P1 / P3 페르소나, demo readiness) 명시
- [x] BRepMesh API 핵심 정리

본 ADR 의 commit 만으로 T-α 완료. 후속 T-β ~ T-ε 별도 atomic +
별도 결재.

---

## 5. Cross-references

- **ADR-082** (OCCT.js 실설치 + Real Runtime) — 본 ADR 의 직접 trigger.
  C-ε amendment 가 OCCT 통합 architecture 를 unlock 했고, 본 ADR 이
  visual layer 의 자연 연장.
- **ADR-081** (STEP/IGES NURBS-class Import) — `traverseBrep` (W-δ)
  의 stable index 가 본 ADR 의 face → Three.js Mesh 매핑 base. ADR-037
  P22.7 owner-ID 매핑은 별도 ADR.
- **ADR-035 P20.C #2** (initial bundle 0MB) — strict 유지. 본 ADR 의
  코드는 `StepIgesImporter` chunk 영역만 변경.
- **ADR-046 P31** (UI/UX Strategy) — P1 (건축/디자인) + P3 (AI 협업자)
  두 페르소나의 *visual verification* 가치 anchor.
- **ADR-038 P23** (Surface-Aware Normals) — analytic surface 가용 시
  vertex normal 의 정확도 향상 가능. 본 ADR 은 BRepMesh 의 normal 만
  사용 (MVP), P23 통합은 별도 sub-step 또는 ADR.

---

## 6. Lessons (작성 시점)

- **Architecture vs Visual gap**: ADR-082 가 OCCT 통합 architecture 를
  완성했으나 *사용자 facing demo* 는 0%. "구조적 완성도" 와 "사용자
  체감 가치" 의 분리 명시. Path Z atomic 패턴이 architectural 진척을
  잘 잡지만, *user verification* 은 visual layer 까지 가야 의미 있음.
- **MVP 의 가치**: 본 ADR 은 BRepMesh + Three.js 의 가장 단순한 매핑
  만. Material / texture / edge wireframe / LOD 등은 모두 deferred.
  이 minimal scope 가 *demo unlock* 의 충분 조건이라는 결정 — 80%+
  user value 를 20% effort 로 unlock.
- **Path Z atomic 의 일관 적용**: ADR-079/080/081/082 모두 5~7 sub-
  atomic 으로 진행. 본 ADR 도 동일 패턴 — *consistency* 가 거버넌스
  부담을 minimum 으로 유지.
- **OCCT BRepMesh 의 표준성**: `BRepMesh_IncrementalMesh` 는 OCCT 의
  industry-standard tessellation API. 우리가 자체 mesher 를 만들지
  않고 OCCT 를 신뢰하는 결정 — *우리 가치 (P1+P3)* 에 집중하는 trade-off.

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: **Accepted**
(T-α spec only commit 2026-05-08). T-β ~ T-ε 별도 commit 으로 구현.
