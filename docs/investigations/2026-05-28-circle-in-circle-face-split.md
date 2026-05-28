# Investigation — 원안에 작은 원 면분할 검토 + 문제점 분석

**Date**: 2026-05-28
**Trigger**: 사용자 시연 요청 ("원안에 작은원을 그려서 면분할이 되는 지 검토하고 문제점 검토")
**Author**: WYKO + Claude
**Scope**: 큰 원 + 작은 원 (concentric containment) face split engine 동작 검증
**Status**: Investigation completed (docs only, code 변경 0)
**Cross-link anchors**:
- LOCKED #1 ADR-021 P7 (closed edge divides face) — Superseded by ADR-139
- LOCKED #28 ADR-145 (Circle annulus 명시 promote)
- LOCKED #41 ADR-101 (coplanar partial overlap auto-intersect)
- LOCKED #64 ADR-139 (Boundary-only face synthesis — 자동 trigger 폐기)
- 메타-원칙 #16 (자동화 antipattern — 명시 trigger only)

## 1. 사전 audit — 정책 매트릭스 (architectural cross-cut)

| 정책 | Default | Trigger condition |
|---|---|---|
| **LOCKED #1 ADR-021 P7** (자동 containment split) | **Superseded by ADR-139** — auto trigger 폐기 | Boundary tool 명시 only |
| **LOCKED #12 ADR-025 P11** (자동 cycle face 합성) | **Superseded by ADR-139** — auto trigger 폐기 | Boundary tool 명시 only |
| **LOCKED #41 ADR-101** (자동 coplanar overlap 3 sub-face) | **default OFF** (LOCKED #64 ADR-139 B-β-1) | `auto_intersect_on_draw=true` opt-in |
| **`auto_face_synthesis_on_draw`** | **default OFF** (B-β-2/3) | localStorage opt-in |
| **LOCKED #28 ADR-145** (Circle annulus 명시 promote) | **명시 호출만** | `promoteCirclesToAnnulus(outer, inner)` |
| **ADR-107 AsShape → Path B canonical** | Default activated (segments>=12) | DrawCircleAsShape internal |

**핵심**: 메타-원칙 #16 정합으로 모든 자동 trigger default OFF. 사용자 *명시* 호출만 face split.

## 2. 시연 결과 — 4 시나리오 측정 매트릭스

Test setup: `crates/axia-core/tests/investigation_circle_in_circle.rs`
(작업 완료 후 삭제 — docs-only investigation).

큰 원 (radius=10) center=(0,0,0) + 작은 원 (radius=3) center=(0,0,0)
**concentric containment** 시나리오.

| 시나리오 | Input | auto_intersect_on_draw | 결과 (active faces) | 분석 |
|---|---|---|---|---|
| **S1** | drawCircleAsShape × 2 (concentric) | **OFF** (ADR-139 default) | **2** (2 simple faces, overlap) | ❌ 면 분할 안 됨 |
| **S2** | drawCircleAsShape × 2 (concentric) | **ON** (opt-in) | **2** | ❌ **auto-intersect ON 도 containment 처리 못 함** |
| **S3** | drawCircleAsCurve × 2 (Path B, concentric) | **ON** | **2** | ❌ Path B 도 동일 — containment 면분할 안 됨 |
| **S4** | drawCircleAsShape × 2 + **명시 `promoteCirclesToAnnulus`** | (무관) | **1** (ring with hole) | ✅ **annulus 생성 — ADR-145 명시 호출 only** |

## 3. 핵심 발견

### 3.1 자동 trigger 4 시나리오 모두 containment 면 분할 안 됨

| 정책 | 적용 가능성 | 실제 동작 |
|---|---|---|
| **ADR-101 자동 coplanar overlap → 3 sub-face** | *partial overlap* 만 (containment 아님) | S2/S3 에서 동작 안 함 |
| **ADR-021 P7 자동 containment hole punching** | LOCKED #1 amendment 로 비활성 (ADR-015 B1) | S2/S3 에서 동작 안 함 |
| **LOCKED #64 ADR-139** | 모든 자동 trigger default OFF | S1 default 결과 정합 |

→ **`containment` 시나리오에 자동 trigger 가 *전혀 존재 안 함*** (architectural gap 의 *의도된* 상태).

### 3.2 ADR-101 §B-3b/B-4b algorithm 의 containment 한계 명시

ADR-101 algorithm (`axia-geo/operations/coplanar.rs`) 가 *partial overlap* 만
처리하도록 설계됨:

```rust
// coplanar_intersection_segments
if raw_crossings.is_empty() && !lens_polygon.is_empty() {
    // ADR-128: vertex-on-edge fallback
    let detected = detect_vertex_incidence_crossings(...);
    raw_crossings.extend(detected);
}
```

**Containment** (작은 원이 큰 원 *내부*) 의 algorithmic 특성:
- `raw_crossings` (boundary edges 교차점) = **0** (boundary 가 안 만남)
- `lens_polygon` (intersection 영역) = **작은 원 자체** (큰 원 영역 *내부*)
- ADR-128 fallback (vertex-on-edge) 도 동작 안 함 (boundary 안 만남)
- → ADR-101 path skip → 자동 split 안 됨

### 3.3 명시 trigger 유일 path: ADR-145 promoteCirclesToAnnulus ✅

S4 결과:
- **명시 호출**: `promote_circles_to_annulus(outer_face, inner_face)` → 성공
- **결과**: 큰 원 face → ring (annulus) topology, 작은 원이 hole 로 합성
- **결과 face 수**: **1** (큰 원의 ring face, 작은 원 face deactivated)
- **UI 노출**: ContextMenu "annulus 만들기" (LOCKED #28 ADR-145 production)
- **Engine 4-validation**: active / Circle face / coplanar / contained 강제

### 3.4 메타-원칙 #16 정합 — 의도된 architectural 동작

ADR-139 결재 (Q1=Path A Pure Boundary only) + 메타-원칙 #16 정합:
- **사용자 의도 모호**: containment 가 *hole 의도* 일지 *별개 도형 의도* 일지 미정
- **해결**: 자동 추측 회피 → 사용자 명시 trigger 강제 (ADR-145 ContextMenu)
- **현재 동작 정합** ✅

## 4. 문제점 매트릭스

| 문제 | 심각도 | Architectural status | 후속 |
|---|---|---|---|
| **P1** — Containment 자동 면 분할 path 없음 | 🟢 의도된 동작 (메타-원칙 #16 정합) | ADR-139 lock-in | 변경 0 |
| **P2** — partial overlap 자동 path 도 default OFF | 🟢 의도된 동작 (LOCKED #64) | localStorage opt-in 가능 | 변경 0 |
| **P3** — 사용자가 "원 안 원" 그리면 hole 자동 안 됨 | 🟡 UX gap (사용자 의도 모호) | ADR-145 명시 promote 필요 | UX hint 검토 |
| **P4** — UI ContextMenu "Annulus 만들기" 가시성 (2 face 선택) | 🟢 정상 노출 | ADR-145 β-4 production | 변경 0 |

## 5. 검토 결론

✅ **Engine 동작 정합**:
- 자동 trigger default OFF (메타-원칙 #16)
- 명시 ADR-145 promoteCirclesToAnnulus path 동작 확인 (S4)
- ADR-021 P7 / ADR-101 / ADR-145 cross-cut 정합

⚠️ **UX gap 존재** (P3):
- 사용자가 직관적으로 "원 안 원 = hole" 의도 가질 수 있음
- 현재 명시 우클릭 → "Annulus 만들기" 필요
- 학습 곡선 acceptable (CAD 표준 BOUNDARY 명령 패턴 정합)

## 6. 개선 옵션 매트릭스 (별도 ADR trigger 시 고려)

| 옵션 | 작업 | trade-off |
|---|---|---|
| **(A) ⭐ 현재 동작 유지** | 변경 0 — 메타-원칙 #16 정합 best | 사용자 학습 필요 |
| (B) 자동 hole detect 옵션 추가 | localStorage `auto_annulus_on_containment=true` opt-in (default OFF) — 별도 ADR 필요 | 메타-원칙 #16 일부 완화 — *명확* 한 containment 시나리오만 |
| (C) ContextMenu UX polishing | 2 face 선택 시 *Hint* 자동 표시 ("Annulus 만들기 가능?") — UI only | UX 친화, engine 변경 0 |
| (D) Boundary tool 명시 면분할 통합 | ADR-148 Point-Localized BoundaryTool 활용 — 사용자가 작은 원 영역 클릭 → boundary 합성 검증 필요 | ADR-148 자연 연장 — closed curve face split 처리 검증 후 |

**추천**: **(A) 현재 동작 유지 + (C) UX polishing** (메타-원칙 #16 정합 보존).

## 7. Sprint 5 baseline 가치

본 investigation 은 **Sprint 5 (곡면 face + Sketch + Ellipse + Surface Push/Pull)** 진입 전 baseline evidence:
- 곡면 face 의 *coplanar containment* 동작 정합 검증 anchor
- ADR-101 algorithm 의 containment 한계 명시 → Sprint 4.5 (Curve-to-Curve Face Split, ADR-155) 의 *명시 trigger* 필수성 anchor
- ADR-145 promoteCirclesToAnnulus path 가 다른 closed curve 통합 patterns (DrawEllipse, DrawBezier closed) 의 reference

## 8. Test 자산

Investigation test 작성: `crates/axia-core/tests/investigation_circle_in_circle.rs`
(4 시나리오, axia-core API 직접 호출). 결과 측정 후 **삭제 (docs-only investigation, 회귀 자산 commit 0)**.

회귀 자산 가치는 *future* 별도 ADR (옵션 B 또는 D 진입 시) baseline 으로 활용.

## 9. Production-evidence amendment (2026-05-28 후속)

**Trigger**: 사용자 스크린샷 evidence "면이 안잘림" + 직접 시연 요청
("직접 테스트") 후 Playwright Chromium production-like build E2E 진행.

### 9.1 Production E2E 결과

`web/e2e/direct-test-circle-in-circle-annulus.spec.ts` (diagnostic only,
실행 후 삭제) — production build 에서 3 시나리오 측정:

| 시나리오 | 결과 |
|---|---|
| **S1** drawCircle × 2 concentric (containment) | ✅ 2 active faces (Investigation S1 정합) |
| **S2** promoteCirclesToAnnulus 명시 호출 | ⚠️ **첫 진단**: silent failure 의심 (`faceCount`=2 그대로) → ✅ **재해석**: 실제 동작 정상 (face 1 deactivated, slot 보존) |
| **S3** ContextMenu "Annulus 만들기" DOM 항목 | ✅ exists + correct className + text |

### 9.2 False alarm 정정 evidence

`bridge.faceCount()` = `Mesh::face_count()` = `self.faces.len()` —
**total SlotStorage slot count** (active+inactive 모두 포함).

`set_active(false)` 는 slot 그대로 보존 + active flag 만 변경 →
`face_count()` 변화 없음.

**증거 (production E2E diagnostic)**:
```
attempts[0]: (0, 1) → error="" ✅ promote 성공
attempts[1]: (1, 0) → "outer face 1 is inactive or not found"
                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                       → 첫 promote 가 face 1 (inner) deactivate 완료 evidence
afterStats: { faces: 2 (slot count), verts: 2, edges: 2 }
triangleCount: 50 (mesh tessellation 정상)
```

→ **ADR-145 `promoteCirclesToAnnulus` 가 production 에서 정상 동작** ✅

### 9.3 사용자 실제 워크플로우 재해석

사용자 스크린샷:
- 큰 원 + 작은 원 그림 ✅
- 빨간색 outline = hover/selection
- **ContextMenu "Annulus 만들기" 명시 호출 안 함** → 면분할 안 됨 (정상)

→ Investigation **P3 UX gap 실증 confirmed** — 사용자가 명시 trigger
인지 못 함.

### 9.4 미해결 architectural 의문 (별도 ADR future)

| 의문 | 우선순위 |
|---|---|
| **`bridge.faceCount()` semantic** — slot count vs active count? 별도 `activeFaceCount()` 추가? | 🟡 low (binary export 등 활용 cross-cut audit 필요) |
| **UX hint 강화** (옵션 A1/A2 from investigation) — 단축키 + Toast | 🟢 high → **ADR-165 진입** |
| **자동 hole detect opt-in** (옵션 B) — 메타-원칙 #16 보완 | 🟡 medium |

→ **ADR-165 (Containment Annulus UX Hint)** 진입 결재 (별도 ADR α spec
동시 commit, 5-step variant TS-only — ADR-164 답습).

## 10. Cross-link

- ADR-021 P7 LOCKED #1 (canonical anchor — closed edge loop divides face)
- ADR-101 LOCKED #41 (coplanar partial overlap auto-intersect)
- ADR-128 (vertex-on-edge fallback — containment 안 처리)
- ADR-139 LOCKED #64 (Boundary-only face synthesis — Superseded LOCKED #1/12/41 자동 trigger)
- ADR-145 LOCKED #28 (Circle annulus 명시 promote)
- ADR-148 (Point-Localized BoundaryTool — 명시 boundary)
- ADR-155 (Sprint 4.5 reserve — Curve-to-Curve Face Split, future)
- 메타-원칙 #14 (면 = closed boundary byproduct)
- 메타-원칙 #16 (자동화 antipattern — 명시 trigger only)
- LOCKED #44 (Complete Meaning per Merge — investigation docs single PR)
