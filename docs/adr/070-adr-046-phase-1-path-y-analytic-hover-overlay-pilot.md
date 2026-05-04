# ADR-070 — ADR-046 Phase 1 Path Y: Analytic Hover Overlay Pilot

**Status**: Draft (Path Z 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-046 P31 Phase 1 PR-4 (Debug Panel) §D5 sub-feature C
**Parent**: ADR-046 §Phase 1 PR-4
**Prerequisites**: ADR-038 P23 (Surface-Aware Normals), ADR-040 P25
(AnalyticCurve hover), ADR-060 Step 6 (`getFaceSurfaceJson`,
`getEdgeCurveJson`), ADR-068/069 (Path Z 패턴)
**Related**: ADR-061 (cache hot-path), ADR-062 (validated attach)

---

## 0. Summary (4 lines)

> ADR-046 PR-4 sub-feature C. DOM overlay 의 surface/curve kind label
> hover — Three.js helper 통합 미루고 가벼운 floating tooltip pilot.
> ADR-062 attach 검증 + ADR-038 cache 가시화. 사용자 7번째 Path Z
> 일관. 5-step / 5 회귀 / 1-2주.

---

## 1. Context — Path Z 채택 이유

### 1.1 사용자 선택 패턴 (7번째 Path Z)

| ADR | 사용자 선택 |
|-----|-----------|
| ADR-061~063 / 067(Step 1) / 068 / 069 | Path Z |
| **ADR-070** | **Path Z (DOM overlay label only)** |

### 1.2 ADR-070 가 풀 사용자 pain

**P1 (디자이너)**: "이 면이 Cylinder 인가 Plane 인가?" 즉시 확인
**개발자**: ADR-038 cache hit/miss 가시 검증
**P3 (AI)**: face-surface-info action 의 sibling — passive surface

### 1.3 Three.js 통합 미루기 — 핵심 결정

ADR-070 의 풀 scope 는 **face vertex normal arrows** (Three.js helper)
포함. 본 pilot 은 **DOM overlay only** — Three.js Viewport.ts 변경 0.

→ Path Y/X 는 Three.js 통합 후속 ADR (ADR-071+) 에서 결정.

---

## 2. Decision — Path Z scope + 7개 D + 4 영구 Lock-in

### 2.1 §A — Path Z scope

**채택**:
- DOM overlay (absolute-positioned div, pointer-events: none)
- Hover face: surface kind + 주요 params 텍스트
- Hover edge: curve kind + 주요 params 텍스트
- localStorage 토글 영구 (off by default — debug feature)
- 메뉴 항목 + Debug Panel UI 토글

**제외 (별도 ADR)**:
- Three.js helper objects (normal arrows, parameter wireframe boxes) — ADR-071+
- Cache hit/miss 색상 코드 (ADR-061 Z.1 통합) — ADR-072+
- Trim loop 시각화 (Phase L₂ Path Y 의존)

### 2.2 §B — 7개 D 결정 (확정)

| D | 결정 | 비고 |
|---|------|------|
| **D-A** | A label-only Path Z scope | Three.js helper 별도 ADR |
| **D-B** | DOM overlay layer | Viewport.ts 변경 0 |
| **D-C** | Mouseover 자동 trigger | 명시 키 미요구 |
| **D-D** | localStorage 영구 토글 (default off) | Tier 3 toggle 패턴 (ADR-063 Step 5) |
| **D-E** | kind + 주요 params (radius/center) | full JSON 미적용 (가독성) |
| **D-F** | Edge hover 포함 (curve kind + 주요 params) | 자연 대칭 |
| **D-G** | 메뉴 + Debug Panel UI 토글 | 둘 다 (이전 패턴 일관) |

### 2.3 §C — 4 영구 Lock-in

```
1. DOM overlay only — Three.js helper objects 본 ADR scope 외.
   ArrowHelper / WireframeGeometry 등 Path Y/X 별도 ADR.

2. localStorage 토글 영구 — default off (debug feature).
   ADR-063 Step 5 Tier 3 toggle / Phase P-narrow 패턴 일관.

3. Hover read-only — 기존 hover (ADR-039 P24) 와 충돌 0.
   Overlay 는 raycast 결과만 사용. selection / preselect 미수정.

4. WASM throttle — debounce 시점에만 evaluate (60fps 환경).
   raf-throttle + hover 정지 시점 감지로 매 프레임 WASM call 회피.
```

---

## 3. Acceptance — 5-step + 5 회귀

### 3.1 Step 분해 (예상 1-2주)

| Step | 영역 | 회귀 | 위험 |
|------|------|------|------|
| 1 | `core/AnalyticHoverOverlay.ts` core (state machine + WASM call + DOM) | 2 | 저 |
| 2 | mouse hover detection (Viewport pickEdgeOrFace 활용) | 1 | 중 |
| 3 | DOM overlay 렌더 (face/edge label, follow cursor) | 1 | 저 |
| 4 | localStorage toggle + 메뉴 항목 | 1 | 저 |
| 5 | 종합 + WASM throttle (raf debounce) | 0 | 저 |
| **합계** | — | **5** | — |

### 3.2 5 회귀 invariants (절대 #[ignore] 금지)

1. `analytic_hover_overlay_renders_surface_kind_on_face_hover`
2. `analytic_hover_overlay_renders_curve_kind_on_edge_hover`
3. `analytic_hover_overlay_disabled_when_toggle_off`
4. `analytic_hover_overlay_pointer_events_none` (R5 self-overlay 차단)
5. `analytic_hover_overlay_throttles_wasm_calls` (R4 — debounce/raf)

---

## 4. References

- ADR-038 P23 (Surface-Aware Normals — analytic evaluate 활용)
- ADR-040 P25 (AnalyticCurve hover — 별도 채널)
- ADR-046 P31 Phase 1 PR-4 §D5 sub-feature C
- ADR-060 Step 6 (`getFaceSurfaceJson` / `getEdgeCurveJson` — overlay 데이터 출처)
- ADR-061 Z.1 (cache hot-path — 후속 통합)
- ADR-068/069 (Path Z 5/6번째 일관 패턴)
- 사용자 사전 검토 + Path Z 채택 (7번째) 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Draft — 즉시 implementation 진행
