# AXiA 3D ↔ AixxiA Engine 융합 가능성 분석 (힌트)

**날짜**: 2026-05-15
**상태**: Hint / 결재 대기 — 내일 작업 진입 anchor
**Decision Owner**: WyKo
**관련**: ADR-031 Hybrid-Lite (AixxiA), 메타-원칙 #10 (ADR 불변), LOCKED #26 Two-Layer Citizenship

---

## 0. 두 엔진 요약 (1 줄)

> **AXiA 3D**: *DCEL-first + AnalyticSurface attach* — 위상은 DCEL 의 truth, 곡면은 analytic 정확도 보강. Web (Rust WASM + Three.js + TS), NURBS interchange.
>
> **AixxiA**: *Form-first + implicit ShapeParams* — primitive 는 mesh 없이 ShapeParams 만, mesh 는 tessellate 의 부산물. Native (Rust + wgpu + egui), RBF freeform + IFC.

두 패러다임의 **truth 위치 자체가 다름** — 단순 merge 불가능.

---

## 1. 공통 기반 (즉시 공유 가능)

- Rust + slotmap-based DCEL
- Z-up canonical (AXiA: LOCKED #43 2026-05-15 / AixxiA: 정합)
- glam math (Vec3 / Mat4 / Quat / Aabb)
- 단독 작가 (WyKo) + Claude
- AI Native 사상
- Form / Xia citizenship 모델 (다른 shape, 같은 intent)

## 2. 5 가지 융합 옵션

### 옵션 A — 완전 통합 ❌
- 작업량 6-12개월, 사상 충돌 (DCEL-first vs Form-implicit), LOCKED 정책 57개 보존 어려움
- **거부**

### 옵션 B — 공유 커널 crate `xia-kernel` ⭐⭐ (장기 권장)
```
xia-kernel/                        ← 신설
  ├─ entities/                    DCEL (Vertex / HalfEdge / Edge / Face)
  ├─ math/                        Vec3 / Mat4 / Quat / Aabb / LocalFrame / Transform
  ├─ surfaces/                    AnalyticSurface 8 variants (NURBS-class 포함)
  ├─ curves/                      AnalyticCurve 6 variants (NURBS 포함)
  ├─ tolerance/                   LOCKED #5 1.5μm + chord_tol policy
  └─ citizenship/                 Form / Xia / Reference 3-Layer

axia-geo/                          ← AXiA 3D 전용 추가 (depends on xia-kernel)
  - operations/ (Boolean / Push-Pull / Offset)
  - ssi/ (NURBS SSI 4-stage)
  - mesh.rs (DCEL + AnalyticSurface attach)

xia-form/                          ← AixxiA 전용 추가 (depends on xia-kernel)
  - inflection / rbf (organic freeform)
  - circle_face / fillet_* (SecondaryMap pattern)
  - wall / coating / ifc (BIM-specific)
  - implicit ShapeParams (Form-first)
```

- 작업량 2-4개월
- 위험 낮음 (각 엔진 시험 자산 보존)
- 단독 작가 유지보수 50%+ 감소
- 두 product 정체성 100% 보존

### 옵션 C — 단방향 자산 이식 (즉시) ⭐⭐⭐ (단기 권장)

| 방향 | 자산 | 가치 | 비용 |
|---|---|---|---|
| **AXiA → AixxiA** | AnalyticSurface NURBS-class | 산업 CAD parity, STEP export unlock | 2-3 sprint |
| AXiA → AixxiA | AnalyticCurve NURBS-class | sketch_line 진정 symbolic 확장 | 1-2 sprint |
| AXiA → AixxiA | NURBS SSI 4-stage pipeline (ADR-034) | Boolean 정확도 | 3-4 sprint |
| AXiA → AixxiA | OCCT.js STEP/IGES import (ADR-082) | 산업 CAD 호환 | 2-3 sprint |
| AXiA → AixxiA | LOCKED 정책 명시 거버넌스 | ADR 진화 안정성 | 1 sprint |
| **AixxiA → AXiA** | LocalFrame + Form-local 좌표 | numerical precision (큰 building) | 2-3 sprint |
| AixxiA → AXiA | Inflection + RBF Gaussian | Organic freeform | 3-4 sprint |
| AixxiA → AXiA | SecondaryMap symbolic primitive (ADR-028) | CircleFace/Fillet 패턴 | 2 sprint |
| AixxiA → AXiA | IFC4.3 export | BIM 워크플로우 진입 | 4-6 sprint |
| AixxiA → AXiA | Wall + Coating layer | Form-mode 워크플로우 | 4-5 sprint |
| 양쪽 ↔ | Two-Layer / 3-Layer Citizenship 통일 | 사상 통일 | 2 sprint |

### 옵션 D — 파일 포맷 브릿지 (`.axia ↔ .xia`)
- 보조 가치, 옵션 B/C 와 보완
- Lossy 영역 명시 필요

### 옵션 E — Status Quo (분리 유지)
- AXiA 3D = "AI 협업 CAD" (P1+P3, web/MCP-first, NURBS)
- AixxiA = "AI Native BIM" (BIM 작가, native, RBF/IFC)
- 단독 작가 2배 부담 누적

---

## 3. 권장 단계적 로드맵

### Phase 0 (즉시) — 옵션 C 단방향 이식 ⭐
**1-2 sprint, 위험 0, 즉각 가치 unlock**

**우선 2건 검토**:

1. **AXiA → AixxiA**: AnalyticSurface NURBS-class 이식
   - AixxiA `ShapeKind` 옆에 SecondaryMap pattern 으로 부속:
     ```rust
     // xia-form 에 추가
     pub analytic_surfaces: SecondaryMap<FaceId, AnalyticSurface>,
     ```
   - ADR-028 CircleFace 패턴 답습 (`circle_faces`, `fillet_edges` 같은 SecondaryMap)
   - AixxiA implicit form 사상 보존 + AXiA NURBS 정확도 unlock
   - **Hybrid-Lite ADR-031 priority #5 (STEP export) 직접 unlock**

2. **AixxiA → AXiA**: LocalFrame + Form-local 좌표
   - AXiA `Shape` struct 에 optional `local_frame: Option<LocalFrame>` 추가
   - 큰 building (수 km) numerical precision 향상
   - ADR-050 P-1 답습 패턴 (additive only, bincode 호환 보존)
   - **별도 Map 으로 분리** (ADR-091 §E L1 답습): `Scene.shape_local_frames: HashMap<ShapeId, LocalFrame>` — bincode legacy 호환

### Phase 1 (3-6개월) — 옵션 B 공유 커널 ⭐⭐
**옵션 C 검증 후 진입**

- `xia-kernel` crate 신설 — entities / math / surfaces / curves / tolerance / citizenship
- 두 엔진 operations / file format / 운영 layer 는 독립 유지
- 단독 작가 유지보수 부담 절감 anchor

### Phase 2 (장기, 12개월+) — 옵션 D 파일 포맷 브릿지 (선택적)

xia-kernel 공유 후 자연 가능.

---

## 4. 내일 (2026-05-16) 진입 시 결재 anchor

### 결재 옵션 매트릭스

| # | 옵션 | 시점 | 결재 anchor | 위험 |
|---|---|---|---|---|
| **(a)** | **Phase 0 — AnalyticSurface 이식 (AXiA → AixxiA)** | 즉시 | Hybrid-Lite ADR-031 #5 unlock | 낮음 |
| **(b)** | **Phase 0 — LocalFrame 이식 (AixxiA → AXiA)** | 즉시 | 큰 building precision | 낮음 |
| **(c)** | **ADR-105 작성 — Kernel Sharing Strategy spec** | 즉시 | 결정 lock-in 우선 | 0 (docs only) |
| (d) | Phase 1 직접 진입 — xia-kernel crate 신설 | 6개월 후 | 단독 작가 부담 절감 | 중간 |
| (e) | Status Quo 유지 | 무한 | 차별화 보존 | 0 |
| (f) | ADR-104 β-1-β-2 (WASM bridge) 우선 + 융합 보류 | 즉시 | Sphere Path B closure 우선 | 0 |

### 권장 시작 순서

```
2026-05-16 옵션 (c): ADR-105 spec 작성 (사용자 결재 anchor)
  ↓
2026-05-16~17 옵션 (a) 또는 (b) 중 하나 진입 (단방향 이식 1건)
  ↓
2026-05-18~ ADR-104 β-1-β-2 (WASM bridge) 병행
```

---

## 5. 사상 충돌 우려 사항

### 5.1 DCEL Half-Edge convention 차이

| | AXiA 3D | AixxiA |
|---|---|---|
| Twin pair | `next_rad` (radial chain) | `twin` (전통적) |
| Self-loop | ADR-089 Phase 2 (1 anchor + 1 self-loop edge) | 미지원 |

**xia-kernel** 진입 시 canonical 선택 필요. **권장: AXiA 의 `next_rad` 채택** — multi-fan vertex (3+ face) 자연 지원, ADR-089 closed-curve face 가능.

### 5.2 Surface representation 차이

| | AXiA 3D | AixxiA |
|---|---|---|
| Surface location | `Face.surface: Option<AnalyticSurface>` | Form 의 `shape_kind + shape_params` (mesh 외부) |
| Implicit mesh | 없음 (DCEL 항상 보유) | ✅ mesh 비어있음 가능 |

**xia-kernel** 의 `AnalyticSurface` 는 *데이터 enum* 만 공유. 부착 방식 (face attach vs Form param) 은 각 엔진 자유.

### 5.3 Inflection / RBF — AixxiA only

AXiA 3D 에 RBF 이식 시 *render path* + *tessellation* + *surface evaluate* 모두 변경. 신중 진입 필요. 옵션 C 의 후순위.

### 5.4 NURBS — AXiA 3D only

AixxiA 에 NURBS 이식 시 `xia-form` 의 `curve_kind.rs` 확장. SecondaryMap pattern 답습. 옵션 C 의 첫 후보.

---

## 6. 메모리 / 정체성 보존 정합

- **AXiA 3D 정체성**: "AI 협업 CAD + 산업 CAD interchange (NURBS/STEP/IGES)"
- **AixxiA 정체성**: "AI Native BIM + Organic freeform (RBF) + IFC"

두 정체성 **모두 보존** 가능 — 옵션 C / 옵션 B 모두 정체성 영향 0. 옵션 A 만 정체성 손실.

---

## 7. ADR-031 Hybrid-Lite 정합

AixxiA 의 ADR-031 (Hybrid-Lite) 가 명시: "산업 호환은 layer 추가". **옵션 C 의 AXiA → AixxiA 이식이 ADR-031 의 정확한 실현**:

| ADR-031 priority | 우선순위 | 이식 자산 (AXiA → AixxiA) |
|---|---|---|
| 1 — BRep Fillet/Chamfer | 진행 중 (ADR-031.1) | AXiA 의 fillet 자산 검토 |
| 2 — IFC4.3 export | 진행 중 | AixxiA 자체 |
| 3 — Sketch constraints UI | 진행 중 | AXiA 의 constraint solver |
| 4 — Shell / Hollow | 미정 | — |
| **5 — STEP / IGES export** | **미정** | ⭐ **AXiA 의 AnalyticSurface + OCCT.js 자산 (옵션 C)** |

---

## 8. 결재 대기 사항 (내일)

다음 중 선택:

1. **ADR-105 작성** — Kernel Sharing Strategy spec (옵션 B/C 의 architectural anchor)
2. **옵션 (a) 진입** — AnalyticSurface 이식 첫 sub-step
3. **옵션 (b) 진입** — LocalFrame 이식 첫 sub-step
4. **ADR-104 β-1-β-2 우선** — Sphere Path B WASM bridge (현재 진행 중 작업 closure 우선)
5. **Status quo** — 옵션 E (분리 유지)

---

## 9. Cross-link

- AXiA 3D LOCKED #1 ~ #43
- AXiA 3D 메타-원칙 #1 ~ #14 (특히 #10 ADR 불변, #14 면 = 닫힌 경계)
- AixxiA ADR-021 (citizenship), ADR-028 (symbolic primitive), ADR-031 (Hybrid-Lite)
- AixxiA 헌장 12원칙 (ADR-025)
- 본 분석 자체 docs only (코드 변경 0) — Phase 0/1 진입 시 별도 ADR 작성

---

**자세한 비교 분석 (13 영역)**:
대화 transcript 2026-05-15 후반 — *"D:\AixiAcad\engine 의 커널과 비교해주세요"* 응답 참조.
