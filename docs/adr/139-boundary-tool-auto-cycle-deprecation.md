# ADR-139 — Boundary Tool + Auto-cycle Deprecation (α spec)

**Status**: Accepted (α spec + B-β-1 ~ B-γ MVP closed — β implementation 진행 중, B-γ' / B-δ / B-ε / B-ζ / B-ι / B-μ 별도 PR)
**Date**: 2026-05-18
**Author**: WYKO (사용자 통찰) + Claude
**Supersedes candidates**:
- LOCKED #12 ADR-025 P11 ("닫힌 엣지 = 반드시 면" — 자동 합성)
- LOCKED #1 ADR-021 P7 (containment auto-split)
- LOCKED #41 ADR-101 (partial overlap auto-intersect)
- 메타-원칙 #14 (amendment — "닫힌 경계 + **사용자 의도**")

## Canonical anchor (사용자 통찰 누적, 2026-05-18)

> "현재 자동 cycle detection + auto-punching 접근이 cascading 이슈 만들고
>  있습니다 (P5.UX.39-45가 모두 이전 자동화의 부작용 처리). CAD 표준
>  BOUNDARY 명령 방식이 더 안정적입니다."
>
> "지금까지 rect를 많이 그려 테스트해본 결과 구멍이 난부분이 많았습니다.
>  결론은 z=0도 중요하고 면과 공간을 만드는 바운더리생성도 중요한것
>  같습니다."

PR #101 (LOCKED #63 z=0 invariant closure) + ADR-138 (Path B multi-loop
회피) 의 architectural finding 이어진 *근본 자동화 antipattern* 인정.
P5.UX.39-45 cascading fixes 패턴 evidence + 사용자 RECT 시연 시 *구멍
발생* evidence = **자동화 자체가 문제 source**.

## 1. Problem statement

### 1.1 P5.UX.39-45 cascading fixes 패턴 (사용자 evidence)

| Sprint | 시도 | 발생 부작용 |
|---|---|---|
| **P5.UX.39** | Line cycle 자동 face | 중간 단계 잘못된 face 생성 |
| **P5.UX.40** | Line 교차 자동 split | 더 많은 잘못된 cycle |
| **P5.UX.41** | Stale face 제거 | inner_loops 있으면 remove 실패 |
| **P5.UX.42** | 중앙 pentagon 자동 | CCW 정규화 필요 |
| **P5.UX.43** | Vertex 공유 push 왜곡 | clean push 검사 추가 |
| **P5.UX.44/45** | 자동 punching | extrude/remove 거부 |

**각 단계가 이전 단계의 부작용 fix** — 자동화는 사용자 의도를 미리 알 수 없음.

### 1.2 사용자 시연 evidence (PR #101 closure 후)

사용자가 RECT 다수 그린 후 화면 결과:
- **구멍이 난 부분이 많았다** — 자동 합성 fail
- 일부 영역 face 생성 안 됨 (auto-cycle detection 휴리스틱 한계)
- 일부 잘못된 winding (CCW 정규화 timing 충돌)

### 1.3 근본 root cause

자동화 = 휴리스틱 = 사용자 의도 추측 → **모호한 케이스에서 잘못된 결정**.

**예시 (휴리스틱 한계)**:
- Self-intersecting X자 4 line → 4 sub-region 중 *어느* 가 face?
- Pentagon 5 line → 중앙 region winding 어떻게 결정?
- Multi-RECT containment + overlap → ring + hole vs 두 simple vs ?
- Push/Pull 후 inner detail → 어떤 sub-region 분리?

각 경우 사용자가 *명시* 결정해야 정확. 자동화 = 잘못된 가정 → cascading fixes.

## 2. Architectural insight — 메타-원칙 직교 (WHAT vs WHEN)

### 2.1 메타-원칙 #14 는 *불변* (기하학적 진리)

**사용자 결재 정정 (2026-05-18)**:
> "메타-원칙 #14 (면은 닫힌 경계로 유도된다) 이것은 바뀌지 않습니다.
>  중요한것은 바운더리를 만들어 생성을 할수있느냐지?"

**메타-원칙 #14 (WHAT — 결과 invariant)**:
> "면은 닫힌 경계로부터 유도된다."

이것은 *기하학적 진리* — **불변**. ADR-139 는 이 원칙을 *변경하지 않음*.
ADR-139 는 *어떻게* 그 닫힌 경계를 인식하는지의 **trigger 정책 layer**
변경.

### 2.2 메타-원칙 #16 (WHEN — trigger 정책, 신설 후보)

> **메타-원칙 #16 (가칭)**: "자동화는 사용자 의도를 미리 알 수 없다.
> 휴리스틱 자동화는 cascading 부작용의 source."
>
> ("Automation cannot infer user intent. Heuristic automation is the
> source of cascading side-effects.")

메타-원칙 #5 ("명확하면 자동, 모호하면 명시 동의") 의 *강화* — *모호함의
정의 자체* 가 "휴리스틱 = 모호" 인 것.

### 2.3 두 메타-원칙 직교 분석

| 메타-원칙 | 측면 | 의미 | ADR-139 영향 |
|---|---|---|---|
| **#14** | WHAT (결과) | 닫힌 경계 → 면 | **불변** (보존) |
| **#16** (신설) | WHEN (trigger) | 자동화 antipattern → 명시 우선 | **신설** (trigger 정책) |

**ADR-139 의 핵심**:
- **결과 = 동일** (메타-원칙 #14 보존 — 닫힌 경계 → 면)
- **Trigger = 다름** (메타-원칙 #16 신설 — 자동 → 명시)

**사용자 의도**:
- "**바운더리를 만들어 생성할 수 있는 도구**" — 메타-원칙 #14 의 자연
  결과 (닫힌 경계 → 면) 를 *사용자 명시 시점* 에 활성
- 자동 trigger 의 *모호함* 제거, 명시 trigger 의 *예측 가능성* 확보

## 3. 제안 — CAD BOUNDARY 방식

### 3.1 기본 원칙

- **Line 그리기 = line only** — face 자동 생성 안 함
- **사용자 명시 BOUNDARY 도구** 로 face 생성:
  - 2D BOUNDARY: 닫힌 영역 내부 click → 둘러싸는 경계 자동 추적 → face 합성
  - 3D BOUNDARY: 닫힌 face 그룹 선택 → volume 합성

### 3.2 CAD parity

| CAD | 도구 | 동작 |
|---|---|---|
| **AutoCAD** | `BOUNDARY` (BO) | 빈 영역 click → closed polyline / region 생성 |
| **Rhino** | `Curve.Boundary` | 평면 closed curve → planar surface |
| **Revit** | `Pick Boundary` | edges 선택 → boundary 정의 |
| **AxiA (제안)** | `B` 키 + BOUNDARY 도구 | click → planar graph face traversal → face |

## 4. Algorithm (DCEL planar graph face traversal)

### 4.1 2D BOUNDARY (평면)

```
입력:
  - Click point P (3D)
  - Mesh: planar DCEL (half-edge structure)

알고리즘:
  1. Cardinal projection (LOCKED #63):
     P.z := 0 force (3d/top/bottom view) — z=0 invariant 자연 보장

  2. BVH 검색 (closest edge to P):
     E_closest = nearest half-edge to P (O(log N))

  3. Left-side half-edge 결정 (CCW winding 기준):
     HE_start = E_closest 의 P 쪽 half-edge

  4. Cycle traversal (HE.next 따라):
     HE_cur = HE_start
     loop {
       boundary.push(HE_cur)
       HE_cur = HE_cur.next
       if HE_cur == HE_start: break (cycle closed)
     }

  5. Point-in-polygon test (Jordan curve):
     P inside boundary cycle? → ✅

  6. Face 합성 (Path B 정합 — simple, single closed loop):
     face.outer = boundary (HE list)
     face.inners = [] (multi-loop 회피)

  7. 시각 update: gray fill 표시
```

**복잡도**: O(N) per query (N = boundary edges traversed). Planar graph
Euler formula (F = E - V + 2) 자연 보장.

### 4.2 3D BOUNDARY (입체)

```
입력:
  - Click point P (3D, 빈 공간 = closed chamber 내부)
  - Mesh: closed shell DCEL

알고리즘:
  1. Closest face 검색 (BVH O(log N))
  2. Face-edge-face graph traversal:
     - Closed shell 의 모든 face 발견
     - Genus 0 check (manifold + closed = volume)
  3. Volume 합성 (closed shell → solid)
```

**복잡도**: O(F) per query (F = shell faces).

## 5. AxiA 현재 자산 활용 (새 알고리즘 0)

| 자산 | 위치 | 활용 |
|---|---|---|
| **DCEL Half-edge mesh** | `axia-geo/src/mesh.rs` | 이미 planar graph |
| **`resolve_planar_free_faces`** | `axia-geo/src/operations/face_synthesis.rs` (Step 4.99) | Cycle finder 본체 — *자동 trigger 만 제거*, 명시 호출 가능 |
| **`mop_up_orphan_cycles_via_dfs`** | 동일 (Phase 5) | DFS cycle finder |
| **`detect_free_edge_loop`** | 동일 | Free edge cycle 감지 |
| **`split_face_by_chain`** | mesh.rs | Face 분할 |
| **BVH spatial accel** | three-mesh-bvh + axia-wasm | Click point 근처 edge 빠른 검색 |
| **Cardinal projection** | LOCKED #63 `ToolManager.get3DPoint` | Click point z=0 강제 |

→ **새 알고리즘 0 — 기존 자산 + 사용자 명시 trigger 만 추가**.

## 6. 정책 영향 매트릭스

| LOCKED / ADR | 현재 의도 | 새 정책 (ADR-139) |
|---|---|---|
| **LOCKED #12 ADR-025 P11** ("닫힌 엣지 = 반드시 면") | 자동 합성 | **사용자 명시 only** (Superseded) |
| **LOCKED #1 ADR-021 P7** (containment auto-split) | 자동 ring/hole | **사용자 명시 only** (Superseded) |
| **LOCKED #41 ADR-101** (partial overlap auto-intersect) | 자동 3 sub-face | **사용자 명시 only** (Superseded) |
| **LOCKED #63** (z=0 invariant) | 보존 | **보존** ✅ (직교) |
| **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다") | 자동 trigger (WHEN 모호) | **불변 보존** (WHAT — 결과 invariant 유지) |
| **메타-원칙 #16** (신설 후보) | 부재 | **신설** — "자동화는 사용자 의도 모름, 명시 우선" (WHEN 정책) |
| **ADR-138 Path B** (multi-loop 회피) | 자동 합성 결과 정책 | **흡수**: 자동 trigger 폐기 시 multi-loop face 자체 안 생성 (Path B 자연 달성) |
| **DrawRect / DrawCircle** (single explicit op) | 자동 face 합성 | **보존** (single op = explicit intent) |
| **DrawLine** | 그리기 + 닫힘 시 자동 면 | **그리기 only** (Boundary 명시 필요) |
| **DrawArc / DrawBezier / DrawPolyline** | 그리기 only (이미) | **보존** |
| **DXF/STEP/IGES import 의 free edges** | 자동 무시 | **Boundary 명시로 face 가능** (가치 unlock) |

## 7. 시뮬레이션 결과 (5 part, 사용자 결재 anchor)

### Part 1 — 현재 결함 (RECT 5개 → 구멍 발생)

```
RECT-A + B + C + D + E (다양한 overlap) → 자동 합성 trigger
  → 일부 영역 구멍 (사용자 evidence)
  → P5.UX.39-45 cascading fix 시도 → 부작용 누적
```

### Part 2 — Boundary 도구 적용 (구멍 0)

```
RECT 5개 → line + edge only (face=0)
  → B 키 → cursor crosshair
  → 빈 영역 click ×7 → 7 face 명시 합성
  → 구멍 ZERO
```

### Part 3 — Algorithm trace (구체 step)

```
Click P=(5,5,0)
  → BVH closest edge (E_bottom of RECT-A)
  → HE_start = HE(V1→V2) left-side
  → cycle: V1→V2→V3→V4→V1 (4 edges)
  → point-in-polygon ✅
  → face 합성 (Path B simple)
```

### Part 4 — z=0 + Boundary 직교 (두 invariant)

```
LOCKED #63 (input) + ADR-139 (face synthesis) — 별개 layer
충돌 없음, 자연 정합
```

### Part 5 — UX (사용자 facing)

```
이전: 자동 합성 → 구멍 → cascading fix
이후: RECT 그리기 + B 명시 click → 정확 face → 구멍 ZERO
```

## 8. β implementation Path 비교

### Path A — Pure Boundary only (자동 완전 폐기)

- LOCKED #12 / #1 / #41 모두 Superseded
- 모든 face 생성 = 사용자 명시 (Boundary tool 또는 single explicit op)
- DrawLine / DrawArc / DrawBezier — 그리기 only
- DrawRect / DrawCircle — single op auto-face 보존 (single explicit intent)

**Trade-off**:
- 사용자 학습 (B 키)
- 60+ 기존 회귀 자산 update (자동 시점 expect → 명시 click)
- multi-month atomic 트랙

### Path B — 점진 (DrawLine 자동 폐기 → 단계별)

- Phase 1: DrawLine closed loop 자동 합성 폐기 (LOCKED #12 P11 부분 supersede)
- Phase 2: ADR-101 auto-intersect 폐기 (LOCKED #41 supersede)
- Phase 3: LOCKED #1 P7 containment 폐기
- Phase 4: 모든 자동화 폐기

**Trade-off**: 점진 안전, multi-step (multi-month per phase)

### Path C — Hybrid (자동 + Boundary 공존, 사용자 선택)

- Default = 자동 (backward compat)
- Settings toggle: "자동 합성 비활성 + Boundary only"
- 사용자가 모드 전환

**Trade-off**: 사용자 통찰 무력화 위험 (default 자동 이면 cascading fixes 패턴 유지)

### 추천 (사용자 통찰 정합)

**Path A (Pure Boundary only)** — 사용자 통찰 직접 정합. P5.UX.39-45
cascading fixes 의 root cause 완전 해소. 학습 비용 (B 키 1개) trade-off
는 CAD parity 가치로 보상.

## 9. Q1~Q5 결재 trigger (β implementation 진입 시)

- **Q1**: Path A (Pure) vs Path B (점진) vs Path C (Hybrid)
- **Q2**: DrawRect / DrawCircle 의 single-op auto-face *보존* 여부
  - (a) 보존 (single explicit op 의 일부 — 사용자 의도 명확)
  - (b) 폐기 (Pure consistency — 모든 face = Boundary 명시)
- **Q3**: 기존 자동 합성 정책 (LOCKED #12 P11 / #1 P7 / #41) 모두 Superseded?
  - (a) 모두 Superseded (Path A)
  - (b) 점진 (Path B)
- **Q4**: 회귀 자산 60+ tests update 전략
  - (a) 재작성 (자동 → 명시 호출 시뮬레이션)
  - (b) deprecation (별도 sub-suite — legacy 자동 expect)
  - (c) 새 의미로 expected update
- **Q5**: ADR-138 Path B 와의 관계
  - (a) ADR-139 가 ADR-138 흡수 (자동 trigger 폐기 → multi-loop face 자연 안 생성)
  - (b) 둘 다 진행 (ADR-138 자동 합성 보존 + multi-loop 회피, ADR-139 명시 trigger)
  - (c) ADR-139 superseded ADR-138 (Pure Boundary 가 더 깊은 정책)

## 10. Lock-ins (β implementation 시, Q1~Q5 결재 정합)

### 공통 Lock-ins

- **L-139-1** 메타-원칙 #14 amendment ("닫힌 경계 + 사용자 의도")
- **L-139-2** 메타-원칙 #16 (가칭) 신설 — "자동화는 사용자 의도를 미리 알 수 없다"
- **L-139-3** P5.UX.39-45 cascading fixes 패턴 evidence 보존
- **L-139-4** Boundary tool 단축키 = `B` (CAD parity AutoCAD `BOUNDARY`)
- **L-139-5** 2D BOUNDARY = planar graph face traversal (O(N) per query)
- **L-139-6** 3D BOUNDARY = closed shell extraction → volume (future)
- **L-139-7** LOCKED #63 z=0 invariant 보존 (직교)
- **L-139-8** ADR-138 Path B 정합 (단일 closed loop 결과)

### Path A 전용 Lock-ins (Pure Boundary)

- **L-139-A-1** LOCKED #12 ADR-025 P11 Superseded
- **L-139-A-2** LOCKED #1 ADR-021 P7 Superseded (containment 명시 only)
- **L-139-A-3** LOCKED #41 ADR-101 Superseded (overlap 명시 only)
- **L-139-A-4** DrawLine / DrawArc / DrawBezier / DrawPolyline = 그리기 only
- **L-139-A-5** DrawRect / DrawCircle = single explicit op auto-face 보존 (Q2-a)
- **L-139-A-6** 60+ 회귀 자산 모두 update (Q4-a)

### Path B 전용 Lock-ins (점진)

- **L-139-B-1** Phase 1: DrawLine 자동 합성 폐기
- **L-139-B-2** Phase 2: ADR-101 폐기
- **L-139-B-3** Phase 3: LOCKED #1 P7 폐기
- **L-139-B-4** Phase 4: 모든 자동화 폐기
- **L-139-B-5** 각 Phase 별 별도 PR + 사용자 결재

## 11. Out of scope (별도 ADRs)

- 3D BOUNDARY (closed shell extraction) — Phase 2 별도 ADR
- Push/Pull / Boolean / Offset 의 multi-loop face 활성 (ADR-138 Path B 흡수 시 자연 해소)
- Snap re-introduction (ADR-137 별도 트랙)
- Face split downstream sync (ADR-136 별도 트랙)

## 12. Cross-link

- LOCKED #12 ADR-025 P11 (현재 정책 — supersede candidate)
- LOCKED #1 ADR-021 P7 / ADR-051 (현재 정책 — supersede)
- LOCKED #41 ADR-101 (현재 정책 — supersede)
- LOCKED #44 (Complete Meaning per Merge — 별도 PR)
- LOCKED #63 (z=0 invariant — 직교 보존)
- 메타-원칙 #14 (amendment — "+ 사용자 의도")
- 메타-원칙 #16 (가칭 — "자동화는 사용자 의도 모름")
- 메타-원칙 #5 (사용자 편의 — 명확 자동 / 모호 명시)
- ADR-087 K-ζ canonical (사용자 시연 게이트 → 본 ADR trigger)
- ADR-094/097/099/138 (Path Z atomic 패턴 source)
- ADR-138 (Path B multi-loop 회피 — 흡수 / 공존 결재 Q5)

## 13. Acceptance Log (α spec + Q 결재)

- **2026-05-18 α**: α spec 작성 (PR #101 closure 후 사용자 통찰 누적)
  - Trigger 1: P5.UX.39-45 cascading fixes 패턴 evidence
  - Trigger 2: 사용자 RECT 시연 시 "구멍이 난 부분이 많았다"
  - Trigger 3: 사용자 통찰 "CAD BOUNDARY 방식이 더 안정적"
  - Trigger 4: 시뮬레이션 결과 (5 part) — 자동화 vs Boundary 비교
- **2026-05-18 Q 결재 (전체 권장 승인)**:
  - **Q1 = Path A (Pure Boundary only)** ✅
  - **Q2 = (a) DrawRect/Circle single-op auto-face 보존** ✅
    (single op = closed boundary 그리기 + 면 만들기 = 사용자 explicit intent 명확)
  - **Q3 = (a) 자동 합성 정책 모두 Superseded** ✅
    (LOCKED #12 P11 / #1 P7 / #41 모두 supersede)
  - **Q4 = (a) 회귀 자산 60+ tests 재작성** ✅
    (자동 trigger expect → Boundary 명시 호출 시뮬레이션)
  - **Q5 = (a) ADR-138 흡수** ✅
    (Pure Boundary = 자동 trigger 폐기 → multi-loop face 자체 안 생성 →
     Path B 자연 달성 → ADR-138 Superseded by ADR-139)
  - **메타-원칙 #14 불변 보존** 확정 — *기하학적 진리* (사용자 정정 2026-05-18)
    - "면은 닫힌 경계로부터 유도된다" 그대로 (WHAT 결과 invariant)
    - ADR-139 는 *trigger 정책 layer* (WHEN) 변경, *결과 invariant* 보존
  - **메타-원칙 #16 신설** 확정: "자동화는 사용자 의도를 미리 알 수 없다" (WHEN 정책)
- **2026-05-18 B-η/θ/κ/λ docs batch** (PR #127, commit `9aa948f`) —
  LOCKED #1/#12/#41 supersede notes + 메타-원칙 #14 amendment + #16 신설
  + LOCKED #64 신설.
- **2026-05-18 B-ζ audit** (PR #128, commit `aaa800e`) — 회귀 자산 update
  사전 검토 (5-layer inventory + update type 매트릭스). 총 ~275-280 회귀
  자산 inventory — 불변 ~123 (45%) / 명시 호출 추가 ~45 (17%) / 재작성
  ~107 (39%) / count 영향 ~27 (10%). audit-first canonical 8번째 적용.
- **2026-05-18 B-β-1 implementation** (본 PR) — `auto_intersect_on_draw`
  flag default `true` → `false`. Engine + WASM bridge + TS layer + 영향
  tests 13개 + Playwright E2E 6 specs explicit opt-in 전환.
  - Engine scene.rs: default `false`
  - WASM bridge lib.rs: 주석 갱신 (default OFF)
  - TS AutoIntersectSettings.ts: localStorage 'true' 명시 시 ON 보존
    (ADR-049 P-5e-α canonical 답습)
  - TS WasmBridge.ts fallback default: `false`
  - axia-core scene::tests adr101_b4 4 tests: explicit `scene.auto_
    intersect_on_draw = true` opt-in (auto-split 동작 검증)
  - axia-core tests/intersect_with_model.rs 2 tests: explicit opt-in
  - Playwright E2E 6 specs (z0-rect-stress-split / z0-face-split-all-
    tools / z0-face-synthesis-split-cross-tool / z0-split-face-selection
    / adr-101-b6-visual-demo / adr-101-b6-user-demo-verify): `page.add
    InitScript` 으로 localStorage 'true' 사전 설정 (legacy ON 보존)
  - 회귀: axia-core 302 + 36 = 338 PASS / axia-geo 1407 + 24 = 1431
    PASS / axia-wasm 54 PASS, 절대 #[ignore] 금지 준수
- **2026-05-18 B-β-2 implementation** (본 PR) — `auto_face_synthesis_on_
  draw` flag 신설 + Step 4.99 (`resolve_planar_free_faces` fixed-point
  loop) 자동 호출 사이트 wrap. Default `false` (메타-원칙 #16 자동화
  antipattern 폐기).
  - Engine scene.rs: 신규 flag field + Step 4.99 block wrap with `if
    self.auto_face_synthesis_on_draw`
  - WASM bridge lib.rs: `setAutoFaceSynthesisOnDraw` / `getAutoFaceSynthesisOnDraw`
    exports 추가 (export_baseline +2 entries)
  - TS AutoFaceSynthesisSettings.ts: 신규 모듈 (AutoIntersectSettings
    패턴 답습, localStorage `'true'` 명시 ON preference 보존)
  - TS WasmBridge.ts: `setAutoFaceSynthesisOnDraw` / `getAutoFaceSynthesisOnDraw`
    wrappers 추가
  - main.ts: 신규 설정 모듈 wiring (init + onChange 패턴, AutoIntersect 답습)
  - Playwright E2E: `z0-closed-loop-face-synthesis.spec.ts` explicit
    opt-in + `z0-face-split-all-tools.spec.ts` 의 기존 opt-in 확장
  - 회귀 0 (Step 4.99 가 mop-up 단계라 earlier 단계 4.5/4.6/4.9/4.95 가
    이미 closed cycle synthesis 처리 — 사용자 facing 효과 미미, 향후
    B-β-3 에서 earlier 단계 disable 시 본격 영향 발생 예상)
  - 회귀: axia-core 302+36=338 / axia-geo 1407+24=1431 / axia-wasm 54 /
    vitest 1931 모두 PASS
- **2026-05-21 B-β-3 implementation** (본 PR) — `auto_face_synthesis_on_
  draw` flag 의미 확장. Step 4.95 (P7 ring rebuild) + Phase 5 (DFS cycle
  finder) + Phase 6 (strand absorption) 자동 호출 사이트 모두 wrap.
  - Engine 3 site wrap (scene.rs):
    * Step 4.95 (lines 2967-3273, 307 LoC) — LOCKED #1 ADR-021 P7
    * Phase 5 자동 호출 — `mop_up_orphan_cycles_via_dfs` 함수 자체 보존
    * Phase 6 자동 호출 — `absorb_orphan_strands_into_faces` 동일
  - 보존: Phase 7 STRICT (Q2-a) + User-callable `resynthesize_orphan_
    faces` command + 모든 함수 자체 (자동 호출 site 만 wrap)
  - axia-core scene::tests **6 tests** explicit opt-in (audit estimate
    ~78 보다 훨씬 적음 — Step 4.99 만 의존하던 tests 가 B-β-2 에서 이미
    처리됨, 본 PR 은 P7/P9 관련 6 tests 만 영향):
    * test_adr016_path_b_inner_first_then_outer_resynthesize
    * test_adr021_p7_case_a_inner_first_then_outer
    * test_adr021_phaseB_3level_nested_smallest_first
    * test_phaseA_postprocess_promote_path_radial
    * test_p9_corner_pinch_two_inners_become_two_holes
    * test_p9_pinch_drawing_order_independence (Case A + B)
  - Playwright E2E **5 specs** 추가 opt-in (auto-face-synthesis 'true'):
    z0-rect-stress-split / z0-face-synthesis-split-cross-tool /
    z0-split-face-selection / adr-101-b6-visual-demo / adr-101-b6-user-
    demo-verify
  - 회귀: axia-core 302+36=338 / axia-geo 1407+24=1431 / axia-wasm 54 /
    vitest 1931 모두 PASS. 절대 #[ignore] 금지 준수.
  - **사용자 facing 본격 변화**:
    * DrawLine × N closed loop → 자동 face 안 만들어짐 (LOCKED #12 P11 본격 회피)
    * RECT containment → 자동 ring + hole 안 만들어짐 (LOCKED #1 P7 본격 회피)
    * DrawRect / DrawCircle single-op auto-face **보존** (Q2-a, Phase 7 STRICT)
    * P5.UX.39-45 cascading fixes 패턴 **본격 회피 시작**
- **2026-05-22 B-γ MVP audit pivot** (본 PR) — **audit-first canonical
  11번째 적용**. ADR-139 §14 B-γ ("Engine — `Mesh::boundary_from_point(p,
  plane)` 신규") 의 사전 검토 audit 으로 **이미 사실상 구현됨** 발견:
  - ✅ Engine: `Scene::resynthesize_orphan_faces` (scene.rs:3519,
    user-callable command, `mop_up_orphan_cycles_via_dfs` Phase 5
    재활용, transaction wrap, ResynthesizeReport 반환)
  - ✅ WASM bridge: `resynthesizeOrphanFaces` (lib.rs:5578,
    export_baseline 등재)
  - ✅ TS bridge wrapper: `WasmBridge.resynthesizeOrphanFaces`
    (line 2105)
  - ✅ ToolManager action: `'resynthesize-faces'` (line 413)
  - ✅ MenuBar 진입점: `'resynthesize-faces'` (MenuBar.ts:588)
  - 본 PR 변경: Korean label 재정의 (ADR-139 vision 정합)
    * 이전: "면 재합성 (닫힌 라인 cycle → face)"
    * 이후: "경계 도구 (Boundary) — 닫힌 line cycle 명시 면 합성 (ADR-139)"
  - 회귀: 코드 변경 1-line (label) + docs only. 절대 #[ignore] 금지
    준수.
  - **MVP 의 본질**: ADR-139 가 자동 trigger 폐기 (B-β-1/2/3) → 명시
    trigger 가 필요한데, `resynthesize-faces` 가 *전체 mesh sweep*
    명시 trigger 로 이미 활성. 사용자 명시 호출 = 보고서 4단계
    파이프라인의 entry point.
  - **남은 작업** (별도 sub-step):
    * B-γ' (가칭) — Point-based localization (`Mesh::boundary_from_
      point(p, plane)` 신규 — click point 근처 region-limited boundary
      detection, ADR-139 §10 L-139-5 specific). Full mesh sweep 보다
      정밀.
    * B-ε — TS BoundaryTool 신규 ('B' 단축키 + cursor crosshair). 현재
      'b' 가 bottom view 와 충돌 — 단축키 결정 (Ctrl+B 또는 다른) 별도
      결재 필요.

- **(B-γ' + B-δ + B-ε + B-ι + B-μ): 다음 sub-steps** (별도 PR):
  - B-β-4: ✅ closed (PR #131 audit pivot — TS 변경 0)
  - B-γ MVP: ✅ closed (본 PR — 이미 구현, label 재정의)
  - B-γ' (가칭): Engine — `Mesh::boundary_from_point(p, plane)` 신규
    point-based localization (full mesh sweep 보다 정밀)
  - B-δ: WASM bridge — point-based localization wrapper
  - B-ε: TS BoundaryTool 신규 — cursor crosshair + 단축키 (B vs Ctrl+B 결정)
  - B-ι: E2E + 사용자 시연 (구멍 0 검증)
  - B-μ: 3D BOUNDARY Phase 2 별도 ADR

## 14. β implementation atomic sub-step plan (B-α ~ B-μ)

**Path Z atomic 패턴** (ADR-094 / ADR-097 / ADR-099 / ADR-138 답습):

| Sub-step | Scope | 비용 |
|---|---|---|
| **B-α** | Q 결재 + plan amendment (본 commit) | 완료 |
| **B-β** | Engine — auto cycle detection 폐기 (`resolve_planar_free_faces` Step 4.99 disable + Step 4.95 second-pass disable + cycle finder 호출 site 제거) | ~3-5일 |
| **B-γ** | Engine — `Mesh::boundary_from_point(p, plane)` 신규 (planar graph face traversal — 기존 cycle finder 코드 재활용 + 명시 trigger) | ~2-3일 |
| **B-δ** | WASM bridge — `bridge.boundaryFromClick(x, y, z, normal)` + TS wrapper | ~1일 |
| **B-ε** | TS BoundaryTool 신규 — 'B' 단축키 + cursor crosshair + click → boundary 호출 | ~1-2일 |
| **B-ζ** | 회귀 자산 update — 60+ tests 재작성 (자동 → 명시 호출 시뮬레이션) | ~1-2주 |
| **B-η** | ADR-101 / LOCKED #1 P7 / LOCKED #12 P11 supersede docs | ~1일 |
| **B-θ** | ADR-138 흡수 docs (ADR-138 status: Superseded by ADR-139) + PR #102 closure note | ~30분 |
| **B-ι** | E2E + 사용자 시연 (구멍 0 검증, ADR-087 K-ζ canonical) | ~1일 |
| **B-κ** | 메타-원칙 #14 amendment + #16 신설 — CLAUDE.md update | ~30분 |
| **B-λ** | LOCKED #64 신설 — "Boundary-only Face Synthesis" 정책 | ~30분 |
| **B-μ** | 3D BOUNDARY (closed shell extraction) Phase 2 별도 ADR | future |

**예상 총 소요**: 4-8주 atomic (회귀 자산 update 가 가장 큼).

## 15. Lock-ins (Path A 확정, Q1~Q5 결재 정합)

### Path A (Pure Boundary) Lock-ins

- **L-139-A-1** LOCKED #12 ADR-025 P11 Superseded — 자동 합성 폐기
- **L-139-A-2** LOCKED #1 ADR-021 P7 Superseded — containment auto-split 폐기
- **L-139-A-3** LOCKED #41 ADR-101 Superseded — partial overlap auto-intersect 폐기
- **L-139-A-4** DrawLine / DrawArc / DrawBezier / DrawPolyline / DrawFreehand = 그리기 only (line + edge 만, face 자동 0)
- **L-139-A-5** DrawRect / DrawCircle = single explicit op auto-face 보존 (Q2-a)
  — single op = closed boundary + 면 한 동작 = explicit intent
- **L-139-A-6** Boundary tool 단축키 = `B` (CAD parity)
- **L-139-A-7** Algorithm = planar graph face traversal (DCEL 기존 자산)
- **L-139-A-8** 결과 face = simple (single closed loop, multi-loop 자체 안 생성 → ADR-138 Path B 자연 달성)
- **L-139-A-9** LOCKED #63 z=0 invariant 보존 (직교)
- **L-139-A-10** ADR-138 Superseded by ADR-139 (Q5-a 흡수)

### 메타-원칙 amendment Lock-ins

- **L-139-MP14** 메타-원칙 #14 **불변 보존** (사용자 정정 2026-05-18 — 기하학적 진리, ADR-139 의 trigger 정책 layer 와 직교)
- **L-139-MP16** 메타-원칙 #16 신설: "자동화는 사용자 의도를 미리 알 수 없다. 휴리스틱 자동화는 cascading 부작용의 source."

### LOCKED #64 신설 Lock-ins (B-λ 시)

- **L-139-LOCKED64** LOCKED #64 — "Boundary-only Face Synthesis" 정책:
  - 모든 face 합성 = 사용자 명시 (Boundary tool 또는 single explicit op)
  - 자동 cycle detection / auto-split / auto-intersect 모두 폐기
  - P5.UX.39-45 cascading fixes 패턴 영구 차단
  - 사용자 시연 시 구멍 0 보장 (자동 fail 없음)

---

**다음 trigger** (β implementation 진행 시):
- B-β 진입 (Engine auto cycle detection 폐기) — 별도 PR + 사용자 결재
- 회귀 자산 60+ tests 재작성 plan audit (B-ζ 진입 전)
- ADR-138 closure docs (B-θ — PR #102 amendment)
- 사용자 시연 baseline (B-ι — 구멍 0 검증)
