# ADR-090 — True Kernel-Native Cylinder (Path B, deferred)

**Status**: **Deferred** (spec only — 구현은 트리거 조건 만난 후 사용자 결재 필요)
**Date**: 2026-05-08
**Author**: AXiA team (사용자 결재 + Claude spec)
**Anchor**: 사용자 결재 (2026-05-08, ADR-089 A-Β closure 후):
> "🅱 보류 + 🅲 ADR-090 spec 작성 (architectural decision 명시, 향후
> 트리거 시 즉시 진입 가능)."

**Parent**: ADR-089 (True Kernel-Native Closed Edges), 메타-원칙 #14
("면은 닫힌 경계로부터 유도된다")
**Cross-cut**: LOCKED #35 L4 (Path A 잠정 / Path B 별도 future ADR),
LOCKED #1 P7 / #12 P11 (face split / closed edge → face)
**Future trigger**: STEP/IGES round-trip 정확도 / 메모리 효율 / 산업 CAD
interop / Boolean 정확도 — §6 정량 트리거 조건 참조

---

## 0. Summary

> ADR-089 가 closed-curve 시민권 4 곡선 type (Circle/Bezier/BSpline/NURBS)
> 의 **Path A** (DCEL polygon 보존 + render-only 매끈도) 를 완성. 사용자
> 결재 (2026-05-08) 로 **Path B (DCEL 진정한 kernel-native cylinder)** 는
> 트리거 조건 만난 후 별도 시즌 진입으로 deferred.
>
> **Path B 의 architectural 목표**: 산업 CAD parity — cylinder = 3 face
> (top + bottom + side) + 2 edge (top circle + bottom circle, self-loop)
> + 2 vert (anchor on each). Side face 는 **annulus topology** (2
> boundary loops) + Cylinder analytic surface attached.
>
> **현재 상태 (Path A)**: cylinder = 25 face + 70 edge + 46 vert
> (tessellate-then-extrude 결과 polygonal). visual 은 매끈 (A-ρ/A-φ
> uv-slice tessellation), 그러나 DCEL = polygon strip.
>
> 본 ADR 은 Path B 의 **architectural decision space, 위험 매트릭스,
> 구현 옵션, 트리거 조건** 명시. 코드 변경 0 — spec only.

---

## 1. Background — Path A 와 Path B 의 본질 차이

### 1.1 Path A (현재, ADR-089 LOCKED #35)

| 항목 | 값 |
|---|---|
| Cylinder DCEL | 25 face / 70 edge / 46 vert (R=400, 23-segment) |
| Top/Bottom face | Plane surface, polygonal boundary |
| Side face | 23 × {4-vert quad with Cylinder surface} |
| Visual quality | 매끈 (A-ρ uv-slice + A-τ smooth-group hide) |
| Boolean | NURBS dispatch 활성 (face surface = Cylinder) |
| Push-Pull | 활성 (tessellate-then-extrude) |

**핵심 한계**: DCEL topology 가 polygon strip. STEP/IGES export 시 cylinder
가 polygon 으로 강등. 메모리 8x. Boolean SSI 의 chord 오차 누적.

### 1.2 Path B (목표, 본 ADR deferred)

| 항목 | 값 |
|---|---|
| Cylinder DCEL | **3 face / 2 edge / 2 vert** (산업 CAD parity) |
| Top/Bottom face | Plane surface, 1 self-loop edge boundary (closed-curve, 이미 활성) |
| Side face | **1 face with 2 boundary loops + Cylinder surface** (annulus) |
| Visual quality | 매끈 (analytic surface tessellation) |
| Boolean | Native analytic SSI (chord 오차 0) |
| Push-Pull | Native cylinder 직접 생성 |

**핵심 도전**: DCEL Face struct 의 boundary 모델 — 현재 1 outer + N hole 가정.
Cylinder side face 의 annulus topology (2 boundary loops, 둘 다 외부) 미지원.

---

## 2. Architectural 도전 — Annulus Topology

### 2.1 산업 CAD 참조

| Engine | 표현 |
|---|---|
| Parasolid | Face 의 LOOP 가 OUTER / INNER / PERIPHERY 중 하나, periodic surface 는 PERIPHERY |
| ACIS | LOOP 의 sense (HOLE / OUTER) + surface periodicity |
| OCCT | TopoDS_Face 의 Wire list — 의미는 surface parametric 공간에서 결정 |
| AXiA 현재 | `Face::outer: LoopRef` + `inners: Vec<LoopRef>` (1 outer + N hole) |

### 2.2 Cylinder side face 의 본질

- Cylinder unrolled = strip (rectangle in (u, v) parametric space)
- u ∈ [0, 2π] (longitude), v ∈ [v_lo, v_hi] (axial)
- Boundary in (u, v):
  - Top: v = v_hi line, u ∈ [0, 2π] (periodic)
  - Bottom: v = v_lo line, u ∈ [0, 2π] (periodic)
- 두 line 모두 **boundary** — 어느 쪽도 hole 이 아님 (3D 에서는 두 circle, parametric 에서는 두 평행선)

**DCEL 표현 결정**:
- 두 self-loop edge (top, bottom) 가 face 의 boundary loop
- Face surface = Cylinder analytic
- Surface metadata 가 어느 loop 가 어느 v 에 위치하는지 결정 (DCEL 자체는 무관)

---

## 3. 구현 옵션 비교

### 옵션 B-α — "hole semantics 확장" (3-4주)

**아이디어**: 기존 `inners` 를 hole + periphery 통합 의미로 격상. 기존 hole face 처리 코드 의미 변경 (review 필수).

| 장점 | 단점 |
|---|---|
| DCEL schema 변경 최소 | hole 의미 변경 — 모든 face 처리 코드 review 필수 |
| migration cost 중간 | 회귀 자산 245+ 의 hole 가정 위험 |

**회귀**: +30~50, 일수 3-4주

### 옵션 B-β — "multi-loop face" 신규 schema (4-6주, 권장)

**아이디어**: `Face::outer + inners` → `Face::boundary_loops: Vec<LoopRef>`.
Surface 가 의미 결정 — Plane 은 "outer + holes", Cylinder 는 "annulus boundaries".

| 장점 | 단점 |
|---|---|
| 깨끗한 architectural — 산업 CAD parity | Schema 변경 — snapshot serde + 모든 face 코드 review |
| 회귀 자산 점진 갱신 가능 (compat layer) | 회귀 +50~80, 4-6주 |

**회귀**: +50~80, 일수 4-6주

### 옵션 B-γ — "seam edge" 우회 (2주)

**아이디어**: top circle 과 bottom circle 사이에 1 line "seam edge" 추가
→ side face 가 단일 boundary loop 로 표현됨 (Möbius-like 경로).

| 장점 | 단점 |
|---|---|
| DCEL 변경 0 | Seam edge 가 분석적 cylindrical surface 와 mismatch |
| 빠른 구현 | 산업 CAD parity 미달 — Path A 대비 의미 차이 미미 |

**회귀**: +10~20, 일수 2주

**비고**: 옵션 B-γ 는 Path A 의 visual 차이만 미미하게 개선 — **권장하지 않음**.

---

## 4. 위험 매트릭스

| 위험 | 영향 | 평가 | 완화 |
|---|---|---|---|
| **LOCKED #1 P7** (face split) 회귀 | 매우 높음 | 245+ 회귀 자산 모두 1-outer-N-inner 가정 | 옵션 B-β 의 compat layer + atomic 회귀 검증 (별도 sub-step) |
| **LOCKED #12 P11** (closed edge → face) 회귀 | 매우 높음 | annulus side face 는 1 closed boundary 위 face 가 아님 | P11 변형 정의 — multi-boundary closed face 의 face 합성 의미 명시 |
| **Boolean SSI** 의 multi-loop face | 매우 높음 | NURBS Boolean (ADR-064/066) 모두 single-loop face 가정 | SSI boundary intersection 처리 재설계 — 별도 sub-step |
| **Render path** (export_buffers) | 중간 | A-ρ/A-φ uv-slice 가 4-vert quad 가정 | Cylinder 전체 surface tessellation + boundary clamp |
| **Snapshot serde** (.axia 파일) | 중간 | Face schema 변경 시 legacy 파일 호환성 | A-μ (Snapshot legacy migration) 와 함께 진행 — 사전 작업 권장 |
| **MCP / WASM API** | 낮음 | 외부 surface 영향 미미 | API 호환성 유지 |
| **3-5주 atomic 컨텍스트 손실** | 낮음 | 회귀 자산 누적이 가드레일 | Path Z atomic + 사용자 multi-gate (각 sub-step 결재) |

---

## 5. Path Z atomic decomposition (옵션 B-β 기준)

| Sub-step | 변경 | 예상 회귀 | 일수 | 사용자 결재 |
|---|---|---|---|---|
| **B-α** spec | architectural ADR + LOCKED 정책 분석 + 트리거 조건 정량화 | +0 | 3-5일 | ✅ 본 ADR (2026-05-08) |
| **B-β** Snapshot pre-migration (A-μ) | .axia schema versioning, legacy ↔ kernel-native bidirectional | +5~8 | 1주 | 별도 결재 |
| **B-γ** DCEL Face schema 확장 | `boundary_loops: Vec<LoopRef>` + serde + invariants | +20~30 | 5-7일 | 별도 결재 |
| **B-δ** Cylinder primitive kernel-native | extrude_cylinder 의 native path (3 face / 2 edge / 2 vert) | +10~15 | 3-5일 | 별도 결재 |
| **B-ε** Boolean dispatch 확장 | 2-loop face 의 NURBS SSI 처리 | +15~25 | 5-7일 | 별도 결재 |
| **B-ζ** Render path 확장 | uv-slice 변형, multi-loop annulus tessellation | +10~15 | 3-5일 | 별도 결재 |
| **B-η** LOCKED 회귀 자산 재검증 | 245+ 회귀 자산 PASS 확인 + LOCKED #1/#12 변형 정의 | +0 | 3-5일 | 별도 결재 |
| **B-θ** 사용자 시연 + closure | E2E (cylinder 생성, Boolean, Push-Pull) | +5 | 2-3일 | 별도 결재 |

**누적**: +65~95 회귀, **24-37일 (3-5주)**

---

## 6. 트리거 조건 — 언제 Path B 가 worth it?

Path A 가 이미 visual + functional closure 달성. Path B 진입은 다음 정량
트리거 중 하나 이상이 명시 활성될 때:

### 6.1 정량 트리거 (A-Γ audit 측정 결과 — 2026-05-08)

| 트리거 | Path A 한계 (측정) | Path B 가치 | 임계 활성 시점 |
|---|---|---|---|
| **Cylinder chord error** | R × (1 - cos(π/N)) mm — R=100mm/N=8: **7.6mm**, R=1000mm/N=64: **1.2mm** | 분석적 정확 | R > 100mm + 0.1~0.5mm 정밀도 |
| **STEP/IGES export 정확도** | polygon strip → cylinder 손실 (analytic 미보존) | 1:1 매핑 | STEP export 구현 후 |
| **메모리 효율 (per-cylinder)** | N=64: 192 face / 320 edge / 130 vert | 3 face / 2 edge / 2 vert (theoretical) | **98%+ 절감** |
| **Large model 메모리** | 1000-cyl × N=32: ~96k face / ~19.5MB | ~3k face / ~0.42MB | **47x 절감** (1000+ cylinder model) |
| **사용자 facing 의미** | "23-segment polygon strip" | "cylinder (analytic)" | AI agent / 정밀 가공 |
| **산업 CAD interop** | SolidWorks/Fusion/CATIA STEP import 시 1:1 매핑 partial | full (모든 element kernel-native) | AP242 export 사용자 |
| **Boolean 정확도** | chord 오차 누적 (~0.01mm scale) | analytic SSI: ~0 | 0.1mm 이하 정밀 Boolean |
| **PMI / dimension 정확도** | "Φ200mm ± chord 오차" | 정확히 Φ200mm | ANSI/ISO 정밀 dimension |

**Audit 참조**: `docs/audits/2026-05-08-path-b-trigger-quantification.md`

### 6.2 사용자 시점 트리거

- 사용자가 STEP 파일 export 후 다른 CAD 에서 정확도 손실 항의
- AI agent (MCP 트랙) 가 cylinder 의 정확한 분석적 표현 요구
- 메모리 사용량 audit — large model 에서 Path A 누적 비용 확인
- ~~사용자 demo 에서 "이건 진짜 cylinder 가 아니라 polygon"~~ — **ADR-092
  로 partial 해결**: Top rim polygon 결함 (결함 1) closure (2026-05-09).
- **NEW primary trigger (ADR-092 후 2026-05-09)**: 사용자가 cylinder 측면
  hover 시 *전체 cylinder* 가 한 면으로 인식되어야 — 현재 Path A 에서는
  N quads 중 1개 quad 만 선택됨 (결함 2 잔존).

### 6.3 ADR-092 후 trigger 매트릭스 갱신 (2026-05-09)

**해결된 trigger** (ADR-092 partial Path B atomic 으로 결함 1 closure):
- ✅ Top rim polygon 시각 결함 — Arc curves 부착 + render path Arc fast-
  path 확장 으로 매끈 ring
- ✅ Boolean SSI 시 top edge 의 analytic 메타데이터 활용 — top Arc 가
  ADR-064/066 NURBS dispatch 의 Circle 인식 path 통과
- ✅ Offset (ADR-080) 의 top edge Plane Arc 자연 활성

**잔존 trigger** (Path B 본격 활성 시 closure):
- ❌ **결함 2** — Side hover/select 시 N quads 중 1개만 선택 (사용자
  intent: "cylinder 측면 = 1개 entity")
- ❌ Side faces 의 메모리 비용 — N quad faces 누적 (LOCKED #16 ADR-038
  P23 의 surface metadata 본래 의도와 충돌)
- ❌ STEP/IGES export 시 cylinder 정확 표현 — Path B 의 single
  cylindrical face 가 자연 NURBS export 가능, Path A 는 polygon
- ❌ Push-Pull again 시 측면이 N quads 로 누적 (cumulative cost)

### 6.4 ADR-093 closure 후 trigger 매트릭스 갱신 (2026-05-09)

**ADR-093 (B-MVP) 으로 closure** — selection 측면:
- ✅ **결함 2 의 selection 측면** — 사용자 cylinder 측면 click → 22~23
  quad faces 일괄 선택 (사용자 intent: "측면 = 1 entity"). real
  Chromium 시연 PASS. surface_owner_id grouping (Mesh-level HashMap) +
  SelectTool walk + Inspector "체적 면 그룹" 인식.

**Path B-full 진입 결재 anchor (잔존 trigger)** — **ADR-094 으로 모두
closure (2026-05-09)**:
- ✅ **메모리 비용** — ADR-094 으로 closure (88% face / 97% edge / 96%
  vert reduction, real Chromium 시연 PASS)
- ✅ **STEP/IGES export 정확도** — ADR-094 으로 closure (annulus single
  cylindrical face 자연 analytic export 가능 — 별도 export 트랙으로
  활용 시 활성)
- ✅ **산업 CAD parity** — ADR-094 으로 closure (Parasolid/ACIS/OCCT 와
  동급 multi-loop face annulus topology)
- ✅ **Push-Pull again 누적 비용** — ADR-094 으로 closure (single
  cylindrical face 보존)

### 6.5 ADR-094 closure 후 trigger 매트릭스 final (2026-05-09)

**모든 잔존 trigger closure**:
- ✅ 결함 1 (top rim polygon) — ADR-092 (2026-05-09)
- ✅ 결함 2 (side hover N quads) — ADR-093 (2026-05-09)
- ✅ 메모리 비용 — ADR-094 B-η/θ (2026-05-09)
- ✅ STEP/IGES export 정확도 — ADR-094 (export 별도 트랙에서 활용)
- ✅ 산업 CAD parity — ADR-094 B-δ-prep (3 face / 2 edge / 2 vert)
- ✅ Push-Pull again 누적 — ADR-094 (single face 보존)

**현재 (2026-05-09) 상태**: ADR-090 의 모든 trigger closure. Path B
인프라 활성. **Engine default OFF + Production ON via localStorage**
(ADR-094 B-η, ADR-049 P-5e-α 답습) — 사용자 explicit ON 으로
production-grade Path B 사용 가능. ADR-090 의 multi-week atomic
spec 으로서의 역할 종료.

---

## 7. Pre-trigger 준비 작업 (선행 권장)

Path B 진입 전 다음 작업이 ROI 향상:

### 7.1 A-μ Snapshot legacy migration (권장 — 1주)
- .axia 파일 schema versioning
- legacy polygon ↔ kernel-native bidirectional 변환
- Path B 진입 시 Face schema 변경의 snapshot 호환성 자연 보장

### 7.2 STEP/IGES round-trip audit (3일)
- 5 코퍼스 (NIST 2 + SolidWorks/Fusion/CATIA 1씩) 의 cylinder export
- Path A 의 polygon 강등 측정 (정확도 / 메모리)
- Path B 의 정량 트리거 명시화

### 7.3 메모리 audit (2일)
- Large model (1000+ cylinder) 의 Path A 메모리 사용량
- Path B 의 8x 절감 가치 정량화

---

## 8. 결정 — Deferred

**현 시점 (2026-05-08) Path B 진입 보류**. 트리거 조건 (§6) 만난 후 사용자
명시 결재 + 별도 시즌 (3-5주 atomic) 진입.

### 8.1 Path B 가 활성화되면

본 ADR 의 §5 sub-step 순서대로 진입. 각 sub-step 별도 사용자 결재 + 회귀
자산 PASS 검증 (LOCKED #35 의 봉인 정합성 유지).

### 8.2 Path B 가 영구 deferred 가능성

만약 트리거 조건이 영구 미만족 (사용자 demand 미발생) — Path A 가 사실상
정답. ADR-090 은 architectural 자료 보존.

---

## 9. Cross-link

- **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다") — Path B 의 strict
  closure (annulus topology 도 닫힌 경계 의미)
- **ADR-089** (True Kernel-Native Closed Edges) — Path A 의 모든 산출물
  (24 sub-step tracks, +76 회귀, LOCKED #35 sealed)
- **ADR-019** (Line is Truth, Face is Byproduct) — annulus side face
  의 byproduct 의미 (2 closed boundary edges → 1 cylindrical face)
- **ADR-064/066** (NURBS Boolean DCEL Multi) — Path B 의 SSI 변형 의존성
- **ADR-027** (NURBS Kernel) — Path B 의 analytic infrastructure
- **LOCKED #1 (ADR-021 P7)** / **#12 (ADR-025 P11)** — Path B 진입 시
  invariant 변형 정의 필수
- **LOCKED #35 L4** — "Path A 잠정 — Path B 별도 future ADR" 의 ADR
  pointer 가 본 문서

---

## 10. Acceptance criteria (B-α spec only commit)

본 commit 이 만족해야:
- ✅ `docs/adr/090-true-kernel-native-cylinder-path-b.md` 신설
- ✅ §1~§9 모든 section 명시 (background / 도전 / 옵션 / 위험 / 트리거 /
  pre-trigger 준비 / decision / cross-link)
- ✅ 3 구현 옵션 (B-α / B-β / B-γ) 비교
- ✅ Path Z 8 sub-step 분해
- ✅ 트리거 조건 정량 매트릭스
- ✅ 사용자 결재 명시 + Status: Deferred
- ✅ Code 변경 0 — spec only

---

*ADR-090 architectural decision 명시. 향후 Path B 진입 시 본 문서가 anchor.
사용자 결재 (2026-05-08): "보류 + spec 작성, 트리거 시 즉시 진입 가능".*
