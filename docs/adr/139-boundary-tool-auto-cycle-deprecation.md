# ADR-139 — Boundary Tool + Auto-cycle Deprecation (α spec)

**Status**: α spec only (β implementation 별도 사용자 결재 후 진행)
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

## 2. Architectural insight (메타-원칙 #16 후보)

**새 메타-원칙 후보**:

> **메타-원칙 #16 (가칭)**: "자동화는 사용자 의도를 미리 알 수 없다.
> 휴리스틱 자동화는 cascading 부작용의 source."
>
> ("Automation cannot infer user intent. Heuristic automation is the
> source of cascading side-effects.")

메타-원칙 #5 ("명확하면 자동, 모호하면 명시 동의") 의 *강화* — *모호함의
정의 자체* 가 "휴리스틱 = 모호" 인 것.

### 2.1 메타-원칙 #14 amendment

**Before**: "면은 닫힌 경계로부터 유도된다."
**After**: "면은 닫힌 경계 + **사용자 의도**로부터 유도된다."
("A face derives from a closed boundary **AND user intent**.")

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
| **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다") | 자동 trigger | **amendment: "+ 사용자 의도"** |
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

## 13. Acceptance Log (α spec)

- **2026-05-18 α**: α spec 작성 (PR #101 closure 후 사용자 통찰 누적)
  - Trigger 1: P5.UX.39-45 cascading fixes 패턴 evidence
  - Trigger 2: 사용자 RECT 시연 시 "구멍이 난 부분이 많았다"
  - Trigger 3: 사용자 통찰 "CAD BOUNDARY 방식이 더 안정적"
  - Trigger 4: 시뮬레이션 결과 (5 part) — 자동화 vs Boundary 비교
  - Scope: α spec only — β implementation 별도 사용자 결재 (Q1~Q5)
- **(β implementation): TBD** — Q1~Q5 결재 후 별도 PR

---

**다음 trigger** (사용자 결재 시 진행):
- Q1~Q5 결재 매트릭스
- Path 선택 후 atomic sub-step plan (Path Z 답습)
- 회귀 자산 영향 audit (60+ tests update plan)
- ADR-138 과의 관계 명시 결정
