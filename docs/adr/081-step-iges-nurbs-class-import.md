# ADR-081 — STEP / IGES NURBS-class Import 활성

**Status**: **Accepted** (W-α spec only — code 변경은 후속 W-β ~ W-η
별도 atomic commits)
**Date**: 2026-05-06
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: 사용자 architectural 결정 (2026-05-06):
> "ADR-079 W-3-δ 가 NURBS-class hosts 활성, ADR-080 V-β-δ 가 NURBS-
> class curves 활성. 외부 CAD 파일 (STEP / IGES) 의 NURBS-class 표면
> 이 이제 axia-engine 의 모든 op (offset / extrude / push-pull /
> Boolean) 의 입력으로 가능. STEP/IGES import 의 BRep traversal +
> AnalyticCurve / AnalyticSurface promotion 본체를 활성화하여 사용자
> facing CAD interop 의 첫 메이저 milestone 마무리."
**Parent**: ADR-035 (STEP/IGES Hybrid Strategy), ADR-036 (Curve &
Surface Promotion P21)
**Cross-cut**: ADR-079 (Create Solid — surface-aware), ADR-080
(Offset Dimension-Aware Semantics — V-β-δ NURBS-class), ADR-027
(NURBS Kernel), ADR-037 (Pick → Promote P22 — Owner ID), ADR-038 P23
(Surface-Aware Normals)

---

## 0. Summary (6 lines)

> ADR-079 (Create Solid 7 SolidKind) + ADR-080 (Offset 8 host kinds /
> 6 curve types) closure 후 STEP/IGES NURBS-class import 의 모든
> downstream blocker 해소. ADR-035 의 Stage 4-A scaffolding (OCCT.js
> dynamic loader, occtCurvePromote/occtSurfacePromote stub) 위에
> ADR-036 P21 11 curve + 12 surface mapping 본체 활성. BRep traversal
> + face/edge owner ID promotion + trim loop 동기화 + 5-corpus
> round-trip 검증. 6 sub-atomic 점진 (W-β ~ W-η).
> Initial bundle 0MB 증가 강제 유지 (ADR-035 P20.C #2).

---

## 1. Context

### 1.1 ADR-079 / ADR-080 closure 가 unblock 한 것

ADR-079 W 트랙 closure (`f368d42`, 2026-05-06):
- 7 SolidKind 모두 활성 — Box / Cylinder / SmoothGroupOffset /
  RevolutionSolid / SweptSolid / LoftSolid / **GeneralSweep** (NURBS-
  class profile extrude)

ADR-080 V-β-δ closure (`f9bd24d`, 2026-05-06):
- **8 host kinds** 모두 활성 — Plane / Cylinder / Sphere / Cone /
  Torus / **BezierPatch / BSplineSurface / NURBSSurface**
- **6 curve types** on Plane — Line / Arc / Circle / **Bezier / BSpline
  / NURBS**

이로써 STEP/IGES import 후 임의의 NURBS-class face 가 axia-engine 의
모든 op (offset / extrude / push-pull / smooth-group offset / Boolean)
의 입력으로 자연 통과. import 본체 활성화의 모든 downstream blocker
해소.

### 1.2 ADR-035 Stage 4-A scaffolding (이미 commit됨)

`crates/axia-wasm` 빌드 외에 별도 의존성 (OCCT.js) 의 dynamic loading
scaffold:
- `web/src/import/StepIgesImporter.ts` — singleton + lazy load +
  graceful fallback (8 tests)
- `web/src/import/occtCurvePromote.ts` — ADR-036 P21.1 curve 매핑 stub
  (12 TODO markers)
- `web/src/import/occtSurfacePromote.ts` — ADR-036 P21.2 surface 매핑
  stub (13 TODO markers)
- `web/src/import/occtAccessors.ts` — wrapper 호환 헬퍼 (16 tests)
- `web/package.json` `opencascade.js` optional dep
- `vite.config.ts` `opencascade-deps` chunk

**Initial bundle 619 kB 동일 (P20.C #2 0MB 증가 강제)** — OCCT 미설치
환경에서도 build 정상.

### 1.3 ADR-036 P21 lock-ins (이미 결재됨)

- **P21.1 Curve mapping 11항목**: Direct 6 (Line/Circle/Arc/Bezier/
  BSpline/NURBS) + Conic conversion 3 (Ellipse/Parabola/Hyperbola) +
  Fitting 1 (OffsetCurve) + TrimmedCurve
- **P21.2 Surface mapping 12항목**: Direct 8 + Sweep 2 (Revolution /
  Extrusion) + Fitting 1 (OffsetSurface) + Trim 1 (RectangularTrimmed
  Surface)
- **P21.3 Trim loops**: PCurve + Phase G2 trim_loops 동기화
- **P21.5 Parameter range** OCCT trim ↔ AnalyticCurve range 매핑
- **P21.6 Round-trip**: 5 corpus 양방향 < 1e-3 mm 검증
- **P21.7 Failure handling**: 6 case → ImportResult.warnings 누적
- **P21.8 Stage 4-A / 4-B 일관성**: 두 경로 동일 매핑 enum 재사용

### 1.4 사용자 가치 anchor

ADR-046 P31 (UI/UX Long-term Strategy) 의 P3 페르소나 (AI 협업자) +
P1 (건축/디자인) 양쪽 모두에 가치:
- P1: 기존 CAD 파일 (SolidWorks / Fusion / CATIA / Rhino export STEP)
  를 AxiA 에서 직접 편집 — workflow 통합
- P3: AI agent 가 STEP file 을 입력으로 받아 axia-engine 의 모든 op
  를 적용 가능 (ADR-041 MCP capability surface 자연 확장)

---

## 2. Decision

### 2.1 Lock-ins L1 ~ L7

- **L1 — Format priority** (ADR-035 P20.A 답습): STEP AP242 primary,
  AP203/AP214 secondary, IGES 5.3 legacy. AP238 / IFC 별도 ADR.
- **L2 — OCCT.js Stage 4-A activation**: ADR-035 의 dynamic loader
  scaffold 위 BRep traversal + promote 본체 활성. Initial bundle 0MB
  증가 강제 유지 (P20.C #2 strict).
- **L3 — ADR-036 P21 mapping reuse**: occtCurvePromote / occtSurface
  Promote 의 stub 본체 활성화 — `SUPPORTED_CURVE_KINDS` (11) /
  `SUPPORTED_SURFACE_KINDS` (12) drift guard 회귀 유지.
- **L4 — Tolerance default 1e-3 mm**: round-trip 검증 (ADR-036 P21.6
  답습). 사용자 settings 향후 override 가능.
- **L5 — Failure mode ImportResult.warnings** (ADR-036 P21.7 답습):
  6 failure case (DownCast 실패 / 정확도 미달 / fitting tolerance 초과
  / rational NURBS surface SSI / PCurve missing / self-intersection)
  → warnings 누적, fatal 아님.
- **L6 — Owner ID promotion** (ADR-037 P22 정합): import 후 face /
  edge / vertex 에 axia owner ID 즉시 부여. raw OCCT TopoDS_Face
  pointer 절대 selection state 에 저장 금지.
- **L7 — ADR-079 W-3-δ + ADR-080 V-β-δ 활성 의존**: import 된 NURBS-
  class face 가 즉시 offset / extrude / push-pull 가능. 본 ADR 의
  user-visible 가치는 ADR-079/080 closure 후에만 의미.

### 2.2 Out of scope (별도 ADR)

- **Export to STEP/IGES**: ADR-035 P20.B Non-goals 답습 — Stage 4
  scope 외.
- **Assembly hierarchy**: STEP AP203 의 AssemblyComponent → axia
  Group 매핑. 별도 ADR.
- **PMI / GD&T metadata**: dimensional / tolerance annotation. 별도
  ADR.
- **Material metadata**: STEP material → axia MaterialId 매핑. 별도
  ADR.
- **Drawing views**: 2D drawing entities. 별도 ADR.

### 2.3 Decision matrix (사전 검토 §81-A ~ §81-E 답습)

본 ADR 작성 직전 사전 검토 (사용자 결재 2026-05-06) 의 권장값 모두
채택:
- **§81-A**: STEP AP242 priority + AP203/AP214 secondary + IGES legacy
- **§81-B**: OCCT.js Stage 4-A activation (Stage 4-B 의 axia-foreign
  자체 spike 는 별도 트랙 — ADR-035 의 12개월 default decision 시점에
  검토)
- **§81-C**: 6 sub-atomic 분해 (W-α / W-β / W-γ / W-δ / W-ε / W-ζ /
  W-η)
- **§81-D**: 1e-3 mm tolerance
- **§81-E**: ImportResult.warnings 6 case

---

## 3. Implementation Plan (post-acceptance)

### 3.1 W-α — ADR-081 spec only — ✅ Closed (본 commit)

본 commit 이 W-α. spec docs 작성만, 코드 변경 0.

### 3.2 W-β — occtCurvePromote 본체 활성

`web/src/import/occtCurvePromote.ts` 의 11 stub TODO markers 활성:
- Direct 6: Line / Circle / Arc / Bezier / BSpline / NURBS
- Conic 3: Ellipse / Parabola / Hyperbola → Bezier / NURBS 변환
  (Piegl A7.1/4/5)
- Fitting 1: OffsetCurve → 동일 base + offset_distance
- TrimmedCurve: parameter range mapping (P21.5)

회귀: vitest +11 (각 curve kind round-trip 1개씩) + 1 SUPPORTED_CURVE_
KINDS drift guard.

### 3.3 W-γ — occtSurfacePromote 본체 활성

`web/src/import/occtSurfacePromote.ts` 의 12 stub TODO markers 활성:
- Direct 8: Plane / Cylinder / Sphere / Cone / Torus / BezierSurface /
  BSplineSurface / NURBSSurface
- Sweep 2: Revolution / Extrusion (Piegl A8.1/2 surface generation)
- Fitting 1: OffsetSurface
- Trim 1: RectangularTrimmedSurface (uvBounds field 활용)

회귀: vitest +12 + 1 drift guard.

### 3.4 W-δ — BRep traversal + face/edge ID promotion

`StepIgesImporter` 의 `import_step()` / `import_iges()` 본체:
- OCCT TopoDS_Shape → TopExp_Explorer 로 face / edge 순회
- 각 face/edge 의 Geom_Surface / Geom_Curve → promote* 호출
- 결과 AnalyticCurve / AnalyticSurface 를 axia EdgeId / FaceId 에
  attach
- ADR-037 P22.7 정합: import 직후 metadata rebuild

회귀: vitest +5 (BRep traversal smoke + face count + edge count +
material default + warnings collection).

### 3.5 W-ε — Trim loop handling (PCurve)

ADR-036 P21.3 PCurve mapping. NURBSSurface.trim_loops field 채우기.

회귀: vitest +3 (RectangularTrimmedSurface + general TrimmedSurface +
nested trim).

### 3.6 W-ζ — Round-trip 검증 (5 corpus, 1e-3 mm)

ADR-036 P21.6 답습. 5 corpus:
- 공개: NIST 2 (test_part_1.step, test_part_2.step)
- 벤더 1: SolidWorks
- 벤더 2: Fusion 360
- 벤더 3: CATIA

각 corpus 의 face / edge metadata 가 import → export (별도 ADR) →
import 라운드트립에서 1e-3 mm 정확도. (Export 미구현 시 import →
analytic evaluate → vertex distance 비교.)

회귀: vitest +5 corpus tests.

### 3.7 W-η — UI integration (FileImporter)

`web/src/import/FileImporter.ts` 에 STEP/IGES 진입점 활성. Toast progress
notification (큰 파일 대비). 사용자 facing UX.

회귀: vitest +3 (UI dispatch + progress + error).

### 3.8 누적 회귀 예상

- vitest +39 (W-β 12 + W-γ 13 + W-δ 5 + W-ε 3 + W-ζ 5 + W-η 3 - 2
  retitled)
- axia-geo / axia-core / axia-wasm: 0 (TS-only 변경)
- vite build: bundle size monitoring (P20.C #2 0MB 증가 strict)

---

## 4. Acceptance Criteria

W-α 본 commit 으로 만족:

- [x] ADR-081 spec 작성 (§0 ~ §6)
- [x] ADR-035 / ADR-036 / ADR-079 / ADR-080 cross-link 명시
- [x] L1 ~ L7 lock-ins 명시
- [x] §81-A ~ §81-E 사전 검토 결과 정합
- [x] W-α ~ W-η 7 sub-atomic 로드맵 명시
- [x] Out of scope (Export / Assembly / PMI / Material / Drawing) 명시
- [x] 사용자 가치 anchor (P1 / P3 페르소나) 명시

본 ADR 의 commit 만으로 W-α 완료. 후속 W-β ~ W-η 별도 atomic +
별도 결재.

---

## 5. Cross-references

- **ADR-035** (STEP/IGES Hybrid Strategy) — Stage 4-A / 4-B 12개월
  default decision matrix. 본 ADR 은 Stage 4-A 본체 활성.
- **ADR-036** (Curve & Surface Promotion P21) — 11 + 12 mapping table.
  본 ADR 은 stub → 본체 활성.
- **ADR-079** (Create Solid) — 7 SolidKind 모두 활성. import NURBS-
  class face 가 모든 mode 의 profile 가능.
- **ADR-080** (Offset Dimension-Aware) — 8 host kinds × 6 curve types
  활성. import NURBS-class face/edge 가 모든 dispatch 자연 통과.
- **ADR-027** (NURBS Kernel) — Phase A~G 의 NURBS surface / curve
  storage. 본 ADR 의 import 결과는 ADR-027 storage 에 저장.
- **ADR-037 P22** (Pick → Promote owner ID) — import 후 face/edge owner
  ID 즉시 부여 의무.
- **ADR-038 P23** (Surface-Aware Normals) — import face 의 analytic
  surface 활용한 정확 normal evaluate (`tessellate_face_surface`).
- **ADR-041 P26** (MCP Surface) — STEP file 을 AI agent 가 import 후
  capability tier 1 (constructive) 진입.
- **ADR-046 P31** (UI/UX Strategy) — P1 (건축/디자인) + P3 (AI
  협업자) 페르소나 양쪽 가치 anchor.

---

## 6. Lessons (작성 시점)

- **ADR closure cascade**: ADR-079 W 트랙 + ADR-080 V-β-δ closure 가
  ADR-081 의 모든 downstream blocker 를 자연 해소. 단일 ADR 진입의
  cognitive load 가 prerequisite ADR 의 closure 로 minimize 됨.
- **Stage 4-A scaffolding 의 가치**: ADR-035 시점 (2026-04-30) 에 OCCT.js
  dynamic loader + stub 만 commit 했던 결정이 6 일 후 (2026-05-06)
  본체 활성 시점에 직접적 도움. "spec only commit + scaffolding"
  패턴이 큰 트랙의 점진 진입에 유효.
- **Mapping enum SSOT (ADR-036 P21.8)**: SUPPORTED_CURVE_KINDS / SUPPORTED
  _SURFACE_KINDS 회귀가 stub 단계에서 이미 cover. 본체 활성 시 enum
  은 변경 없음 — drift guard 가 이미 ADR ↔ 코드 정합 강제.
- **Path Z atomic 패턴 일반화**: 본 ADR 도 W-α (spec) → W-β/γ (lib
  layer) → W-δ (integration) → W-ε (refinement) → W-ζ (corpus) → W-η
  (UI) 의 7-단계 분해. ADR-079 / ADR-080 의 11 / 14 commits 패턴 답습.
- **NURBS-class import 의 user value**: ADR-046 P31 의 두 페르소나
  (P1 / P3) 양쪽에 의미 — 외부 CAD interop + AI agent capability
  확장. 단일 트랙으로 두 페르소나 unblock.

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: **Accepted**
(W-α spec only commit 2026-05-06). W-β ~ W-η 별도 commit 으로 구현.
