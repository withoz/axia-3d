# ADR-177 — Curved-Surface Kernel-Native Ops (E3 α spec + ground-truth audit)

**Status**: Accepted (α spec — 사용자 결재 2026-06-01: **E3-A Surface offset**
첫 sub-track, Q1=a + Q2~Q5 추천 defaults)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 결재 (2026-06-01): 기능 확장 방향 **"E3 곡면 커널"** —
곡면(Cylinder/Sphere/Cone/Torus/NURBS) 위 offset/push-pull/Boolean 을
kernel-native 화 (현재 mesh 로 후퇴한다는 audit 가정).
**Precursors**: ADR-079 (Create Solid), ADR-080 (Offset dimension-aware),
ADR-064/066 (NURBS Boolean DCEL), ADR-089 (closed-curve face), ADR-094/113/
114/115 (Path B primitives), ADR-031/033 (AnalyticSurface/NURBS).

---

## 1. Ground-truth audit (audit-first canonical, ADR-131 패턴)

**중요 발견 — E3 의 상당 부분은 이미 kernel-native 로 구현됨.** 초기 audit
agent 의 "곡면 비활성" 진단은 코드 주석(deferred 마커) 오독이었음. 실제
production 동작을 browser ground-truth (faceSurfaceKind) + LOCKED 정책
이력으로 검증.

### 1.1 (연산 × 곡면) 실제 상태 매트릭스

| 연산 | 곡면 상태 | 증거 |
|---|---|---|
| **Push-Pull (createSolidExtrude)** | ✅ **kernel-native** | DrawCircleAsCurve → createSolidExtrude → 측면 face kind=2 (Cylinder). ground-truth 확인 |
| **Boolean** | ✅ **surface 상속 작동** | Sphere×Sphere → 100% kind=Sphere (ADR-089 A-χ, LOCKED #35) |
| **Curve offset on curved host** | ✅ **done** | Plane/Cyl/Sphere/Cone/Torus host (ADR-080 V-β-γ, LOCKED #27) |
| **Primitive 생성** | ✅ **kernel-native** | Sphere=2 face kind=3, Cylinder/Cone/Torus Path B (ADR-094/113/114/115) |
| **Surface boundary offset (offset_face)** | ❌ **GAP** | Path B circle/sphere face → `offset_face` "Face has fewer than 3 vertices" (offset.rs:1666). Self-loop boundary (1 anchor) 가 polygon code 와 비호환 |
| **Revolve / Sweep / Loft → NURBS surface** | ⚠️ **polygonal only** | create_solid.rs `GeneralSweep`/`RevolutionSolid` W-3/W-4 deferred |
| **NURBS Boolean (rational / multi-loop / 깊은 containment)** | ⚠️ **제한** | rational NURBS 미지원, multi-loop 거부 (ADR-016 Q2), containment depth ≤ 1 (ADR-064) |

### 1.2 결론 — E3 의 진짜 gap 은 좁다

대부분의 곡면 op (push-pull / Boolean / primitive / curve-offset) 는 이미
kernel-native. **진짜 남은 gap 은 4개:**

- **G1 — Surface boundary offset on closed-curve faces** (offset_face 가 Path
  B circle/sphere/cylinder face 에서 실패). *가장 명확·tractable.*
- **G2 — Revolve/Sweep/Loft → kernel-native NURBS surfaces** (현재 polygonal,
  W-3/W-4).
- **G3 — NURBS Boolean robustness** (rational NURBS + multi-loop + containment
  depth ≥ 2).
- **G4 — Multi-loop face ops** (offset/push-pull/boolean 이 hole 가진 face 거부,
  ADR-016 Q2).

---

## 2. Refined scope (제안)

| Sub-track | 내용 | 위험 | 가치 | 비고 |
|---|---|---|---|---|
| **E3-A (G1)** | Surface boundary offset kernel-native — Path B circle → 작은 circle, sphere/cylinder/cone/torus face boundary offset | 🟢 저~중 | 높음 (offset 곡면 wall) | 가장 tractable, 첫 sub-step 추천 |
| **E3-B (G2)** | Revolve/Sweep/Loft → NURBS surface (W-3/W-4 활성) | 🔴 고 | 높음 (진짜 NURBS 생성) | multi-week, Piegl A8.1/2 |
| **E3-C (G3)** | NURBS Boolean robustness (rational + 깊은 containment) | 🔴 고 | 중 (import CAD interop) | ADR-064 후속 |
| **E3-D (G4)** | Multi-loop face ops (ADR-016 Q2 완화) | 🔴 고 | 중 | manifold 안전성 재검토 필요 |

---

## 3. Q1~Q5 결재 포인트

- **Q1 — E3 진입 sub-track 순서**: (a) E3-A(offset) 먼저 / (b) E3-B(revolve/
  sweep) 먼저 / (c) E3-C(NURBS Boolean) 먼저. **추천 (a)** — 가장 tractable +
  명확한 사용자 가치 (곡면 offset).
- **Q2 — E3-A offset 의미**: closed-curve face boundary offset 결과는 (a)
  kernel-native (circle → 작은 circle, self-loop 보존) / (b) polygonized
  fallback. **추천 (a)** — 메타-원칙 #14 (면은 닫힌 경계로부터) 정합.
- **Q3 — 곡면 종류 범위**: E3-A 를 (a) Circle 먼저 → Sphere/Cylinder/Cone/
  Torus 점진 / (b) 5종 동시. **추천 (a)** — Path Z atomic.
- **Q4 — Multi-loop (G4) 처리**: ADR-016 Q2 (multi-loop offset 거부) 를 (a)
  보존 (E3 scope 외) / (b) E3-D 에서 완화. **추천 (a)** — manifold 안전성
  별도 검토.
- **Q5 — engine default vs production**: 곡면 offset 활성화를 (a) 즉시 production
  default / (b) localStorage opt-in (Path B 패턴). **추천 (a)** — additive,
  기존 polygon offset 회귀 보존.

---

## 4. E3-A sub-step roadmap (Q1=a 결재, Path Z atomic)

**결재 (2026-06-01)**: Q1=a (E3-A 첫) / Q2=a (kernel-native) / Q3=a (Circle
먼저) / Q4=a (multi-loop 거부 보존) / Q5=a (production default).

**설계 — 기존 인프라 재사용 (ADR-131 lesson)**:
- ADR-080 V-β-β 의 Circle *curve* offset (`offset_arc_on_plane` Circle 분기,
  `dd31694`) 으로 작은 동심 circle 경계 계산
- ADR-145 `promote_circles_to_annulus` 로 ring(annulus) + inner circle 생성
- 즉 offset_circle_face = 작은 circle 생성 + annulus promote. **새 알고리즘
  최소화**.

| Sub-step | 내용 | 예상 회귀 |
|---|---|---|
| α | 본 spec + Q1~Q5 결재 (본 commit) | +0 |
| β-1 | `offset_closed_curve_circle_face` engine — 작은 동심 circle (ADR-080) + annulus promote (ADR-145) | axia-geo +6 |
| β-2 | `offset_face` dispatch — closed-curve Circle face 감지 → kernel-native 경로 (polygon path 보존) | axia-geo +4 |
| β-3 | WASM bridge + TS wrapper + OffsetTool 통합 | axia-wasm +2 / vitest +5 |
| β-4 | Sphere/Cylinder/Cone/Torus face boundary offset 확장 (V-β-γ curve offset 재사용) | axia-geo +8 |
| γ | 사용자 시연 게이트 + closure docs + LOCKED 등재 | Playwright +2 |

---

## 5. Lock-ins (proposed)

- **L-177-1** Ground-truth audit canonical — push-pull/Boolean/curve-offset 이미
  kernel-native (ADR-131 audit-first 패턴, 새 작업 0)
- **L-177-2** E3-A (surface boundary offset) 첫 sub-track (Q1=a)
- **L-177-3** Closed-curve offset = kernel-native (메타-원칙 #14)
- **L-177-4** Path Z atomic (Circle → 곡면 점진)
- **L-177-5** 기존 polygon offset 회귀 보존 (additive)
- **L-177-6** ADR-016 Q2 multi-loop 거부 보존 (E3 scope 외, Q4=a)
- **L-177-7** 절대 #[ignore] 금지

---

## 6. Cross-link

- **E3 결재** (사용자 2026-06-01) — 곡면 커널 방향
- **ADR-080** V-β-γ (curve offset on curved host — 이미 done) / V-γ (face dim 의미)
- **ADR-079** Create Solid (W-2/W-3/W-4 deferred — E3-B source)
- **ADR-064/066** NURBS Boolean DCEL (E3-C source)
- **ADR-089** Path B closed-curve face (offset 입력 형태) / A-χ (Boolean surface 상속)
- **ADR-094/113/114/115** Path B primitives (곡면 face source)
- **ADR-016 Q2** multi-loop face op 거부 (G4)
- **ADR-131** audit-first canonical (E3 "이미 구현됨" 발견 패턴)
- **메타-원칙 #14** 면은 닫힌 경계로부터 / **#6** Preventive (ground-truth 우선)
- **ADR-087 K-ζ** 사용자 시연 게이트
