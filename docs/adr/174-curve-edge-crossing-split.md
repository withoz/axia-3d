# ADR-174 — Curve-Edge Crossing-Split (직선 × self-loop Circle 경계)

**Status**: Accepted (γ closure 2026-06-01 — Approach A demo-verified
(real browser faces 1→2 via drawCircleAsCurve + drawLineAsShape) + β-1~β-3
+14 회귀 + polygonize root-cause fix. LOCKED #75.)
**Date**: 2026-05-31 (α) ~ 2026-06-01 (γ)
**Author**: WYKO + Claude
**Trigger**: ADR-173 γ closure (LOCKED #74) §10 — "곡면 한계 (S3/S6/S9/S12) =
future ADR (curve-edge crossing-split, 2026-05-31 spawned)". ADR-172 Phase 3
demo evidence (2026-05-31) 의 honest limitation: 직선이 Path B kernel-native
Circle 면을 가로질러도 **면이 분할되지 않음**.
**Audit precondition** (예측된 영역 — surprise 0):
- **ADR-169 β-1** boundary element type matrix — Type 3 (Arc/Circle edge) =
  `⚠ (ADR-089 closed-curve, partial) — Self-loop only`
- **ADR-169 β-3** user demo evidence — S6/S9 (curved surface) = `⏸ Pending`
- **ADR-173** 12 시연 게이트 — S3/S6/S9/S12 (곡면) = `⚠ Documented-Limitation`
- **ADR-105 R-α** §A Bug 1B — `find_line_crossings` self-loop edge `d2=0 →
  parallel → 0 crossings` ("간접 해소" 는 chord-inside-disk 한정, transverse
  crossing 미해소)
**Direct precursors**:
- **ADR-089** (true kernel-native closed edges — 1 anchor + 1 self-loop edge
  + 1 closed-curve face) — Path B Circle 표현의 anchor
- **ADR-105** (closed-curve face split via polygonize dispatch) — approach A
  의 mirror pattern. *주의*: ADR-105 의 `tessellate_closed_curve_face_in_
  place` 는 이후 ADR-101 Phase A 가 흡수/개명 → 현재 `Mesh::polygonize_
  closed_curve_face` (mesh.rs:3914) + `polygonize_if_closed_curve`
  (face_split.rs:30). **Circle-only + Plane surface 상속만 (Arc 미재부착)**.
- **ADR-172** (Phase 3 — 직선 crossing-split mechanism battle-tested,
  Pattern 12) — 직선 경계 split 의 reference 파이프라인
- **ADR-101** (coplanar edge crossing + Amendment 9 HARD flag — polygonize
  helper 현재 owner)

> **세션 노트 (2026-05-31)**: 본 spec 은 `origin/main` (ADR-173 closure,
> commit `69ddc83`) 기준. 작업 worktree 가 ADR-110 (stale) 였어서 `origin/
> main` 으로 sync 후 작성 — `find_line_crossings` 는 mesh.rs:1370 (task 명시
> 일치), polygonize helper 는 ADR-105 → ADR-101 개명 확인 (§2.4 R0).

---

## Canonical anchor

ADR-172 가 사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" 를 **직선 경계**
(square / box face) 에 대해 demo-verified 했다. 본 ADR 은 그 비전을 **곡선
경계** (Path B kernel-native Circle self-loop edge) 로 확장한다.

**사용자 demo evidence (canonical, ADR-172 Phase 3 demo 2026-05-31)**:
> - `bridge.drawCircleAsCurve(0,0,0, 0,0,1, 100)` → 1 vert, 1 edge, 1 face ✅
> - 지름선 `bridge.drawLineAsShape(-120,0,0, 120,0,0, 0,0,1)` (원을 x=±100
>   에서 관통) → 3 verts, 3 edges, **faces 1→1 (분할 안 됨)** ⚠
> - 직선 face (사각형) split 정상 (square → 2 faces), 입체면 (box top face)
>   정상 (6→7 faces). **곡선 경계만 한계.**

메타-원칙 #14 (면은 닫힌 경계로부터 유도된다 — H₁=0 한정, Jordan-Schoenflies)
정합: 곡선 경계도 닫힌 경계이며, 그 disk 를 가로지르는 secant 는 disk-topology
를 보존하며 면을 2 개로 나눠야 한다 (H₁=0 보존).

---

## 1. Problem statement

### 1.1 핵심 gap — `find_line_crossings` 가 self-loop 곡선 edge 를 건너뜀

ADR-089 Path B Circle 면의 경계는 **1 self-loop edge** (`v_small == v_large
== anchor`) 이며 `AnalyticCurve::Circle` 가 attach 되어 있다. anchor 는 rim
위 (center + radius·basis_u, 즉 angle 0 점) — *center 가 아님* (§2.4 R1).

현재 `Mesh::find_line_crossings` (mesh.rs:1370):
```rust
let d2 = vb - va;                 // self-loop: vb == va == anchor → d2 = 0
let n = dir.cross(d2);            // = 0
let n_sq = n.length_squared();
if n_sq < 1e-16 { continue; }     // 평행 처리 → self-loop edge 항상 skip
```

self-loop edge 는 두 endpoint 가 동일 anchor → `d2 = 0` → "평행" → **항상
skip** → 0 crossings. 이 함수는 edge 를 *선분* 으로만 보고 attach 된
`AnalyticCurve::Circle` 의 *실제 곡선 형상* 을 모른다.

### 1.2 gap 의 전파 경로 (scene.rs `exec_draw_line` 파이프라인)

ADR-172 가 battle-tested 한 직선 split 파이프라인 (scene.rs:3854 근방):
```
exec_draw_line(start, end)
  → find_line_crossings        ← (1) self-loop edge skip → 0 crossings
  → find_vertices_on_line      ← anchor(rim) 가 line 위면 검출
  → break_points → sub-segments
  → 각 sub-segment: draw_line + find_face_containing_both_verts → split_face_by_line
                               ← (2) endpoint 가 disk 경계(=anchor 1점) 위 아님 → 미매치
  → split_face_by_line 미호출 → polygonize_if_closed_curve 미발동 → 면 1→1
```

demo 메커니즘 (지름선 (-120,0,0)→(120,0,0), Circle r=100 @ origin, anchor
@ (100,0,0)):
1. line 이 anchor (rim, x=+100) 통과 → `find_vertices_on_line` 가 anchor
   검출 → line 2 sub-segment 로 split. **3 verts / 3 edges 의 출처**.
2. x=−100 의 *진짜* 곡선 crossing 은 `find_line_crossings` self-loop skip →
   **미검출**.
3. 어느 sub-segment 도 양 endpoint 가 disk 경계(anchor 1점) 위 아님 →
   `find_face_containing_both_verts` 미매치 → `split_face_by_line` 미호출 →
   polygonize dispatch 미발동.
4. 결과: line 은 free chord 로만 그려지고 disk 그대로 (faces 1→1).

**ADR-105/polygonize 와의 관계**: `polygonize_if_closed_curve` 는
`split_face_by_line` *진입부* 에서만 발동. 그러나 본 demo 는 그 함수가
*애초에 호출되지 않는다* (상류 crossing 미검출). ADR-105 Bug 1B "간접 해소"
는 *chord-inside-disk* (양 endpoint 가 disk 경계 위) 한정, *transverse
crossing* (secant / diameter) 케이스는 미해소로 남아 있었다.

### 1.3 기존 자산 inventory (Pattern 12 — 강제 구현 전 audit)

| 자산 | 현재 capability | 본 ADR 활용 |
|---|---|---|
| `find_line_crossings` (mesh.rs:1370) | 직선 edge transverse crossing | self-loop edge skip 이 gap |
| `exec_draw_line` (scene.rs:3854) | 직선 crossing → split_edge → split_face_by_line | **battle-tested (ADR-172)** — 재사용 base |
| `split_face_by_line` (face_split.rs:221) | 직선 면 분할 + 진입부 polygonize dispatch | tessellation 후 자연 진입 |
| `polygonize_if_closed_curve` (face_split.rs:30) | 1-vert face detect → polygonize wrapper | pre-pass 판정 참고 |
| `polygonize_closed_curve_face` (mesh.rs:3914) | **Circle self-loop → N polygon edge** (chord_tol=radius·0.01) + Plane surface 상속. **Arc curve 미재부착** (§2.4 R4). Bezier/BSpline/NURBS → `None` | **approach A 핵심 helper** |
| `intersect_curves` (curves/intersect.rs, ADR-030) | 임의 2 AnalyticCurve CCI | approach B 의 line × Circle 교차 (read-only 재사용) |
| `AnalyticCurve::{Line, Circle}` (curves/mod.rs:56) | 곡선 표현 | line ↔ curve 교차 입력 |
| `split_edge` (mesh.rs:3893) | 직선 edge 1→2 split | self-loop split (Bug 1D latent) 은 approach B 에서만 |
| `circle::tessellate_full` (curves/circle.rs) | Circle → N+1 closed polyline | polygonize 내부 사용 |

→ **직선 split 은 이미 robust** (ADR-172). genuine gap = **곡선 (self-loop)
경계의 crossing 검출** (그 후는 기존 polygonize + 직선 파이프라인 재사용).

### 1.4 메타-원칙 정합

- **#5 (명확하면 자동)** — 직선이 원을 *실제로* 가로지름 = unambiguous
  geometric fact → 교차점 split 은 위상 correctness (ADR-172 Q1=a 답습).
- **#14 (WHAT — 면은 닫힌 경계로부터)** — 곡선 경계 disk 도 secant 로 2
  disk-topology face (H₁=0 보존).
- **#15 (동일 분할 contract)** — split-induced edge 에 HARD flag (ADR-101 A9).
- **#16 (WHEN — 자동화 antipattern)** — *edge* 자동 split 은 위상 correctness
  (모호하지 않음). *face emission* 은 여전히 명시 trigger gate (ADR-139).
  ADR-172 L-172-3/L-172-4 동일 논리.

---

## 2. Solution architecture

### 2.1 Q1 = (a) Approach A — polygonize dispatch (결재 confirmed)

**핵심**: 직선이 closed-curve(Circle self-loop) face 를 transverse 하게
가로지를 때, `find_line_crossings` 호출 *이전* 에 그 face 를 **선제
polygonize** (`polygonize_closed_curve_face` 재사용) → self-loop edge 가 N
개 regular polygon edge 로 변환 → 이후는 ADR-172 battle-tested 직선
파이프라인이 *그대로* 처리.

```rust
// scene.rs exec_draw_line — find_line_crossings 직전 pre-pass (신규)
//
// 직선이 가로지르는 Circle self-loop face 를 선제 polygonize → self-loop 가
// N regular edge 가 되어 find_line_crossings 가 자연스럽게 crossing 검출.
let crossed = self.mesh.closed_curve_faces_crossed_by_segment(start, end); // β-1 read-only
for face_id in crossed {
    let mat = self.mesh.faces[face_id].material();
    let _ = self.mesh.polygonize_closed_curve_face(face_id, mat);          // 기존 helper
}
// ↓ 기존 파이프라인 (ADR-172 battle-tested) UNCHANGED
let crossings = self.mesh.find_line_crossings(start, end);  // 이제 crossing 검출
...
```

이후 자동 흐름 (ADR-172 답습):
1. `find_line_crossings` → polygon edge 와의 crossing 검출 → `split_edge`
   로 vertex 삽입.
2. break_points → middle sub-segment (양 endpoint 가 polygon 경계 위).
3. `find_face_containing_both_verts` 매치 → `split_face_by_line` →
   **2 sub-face**.
4. surface = Plane 상속 (polygonize 가 보장). **단 sub-edge Arc curve 미재부착
   → split halves 의 rim 은 polygon facet render** (§2.4 R4 — accepted
   trade-off, optional polish).

**Pros**: ADR-105/polygonize helper + ADR-172 battle-tested 파이프라인
**재사용** (Pattern 12). 신규 surface 최소 (read-only helper 1 + pre-pass 1).
self-loop split (Bug 1D) 미접촉 → 회귀 위험 최소. ~1주.

**Cons / trade-off**: split 시 pure 1-edge kernel-native → polygon 변환
(미split disk 는 영향 0). rim render 가 polygon facet (Arc 미재부착, §2.4 R4).
→ "split 의도 = 의도된 부분적 metadata 전환" (ADR-105 R-β 정신).

#### Approach B (deferred — L-174-12, future ADR)
line × Circle analytic 교차 → self-loop edge 를 2 arc edge 로 split (Bug 1D
해소 필요) → curve-aware face split → 2 half-disk 각 정확 arc 보존. 고fidelity
이나 self-loop split (현재 미해결) + curve-aware split 신규 → multi-week +
높은 회귀 위험. downstream arc-fidelity trigger (정확 단일 arc edge 필요한
offset/fillet/dimension) 발생 시 future ADR.

### 2.2 부수 결재 (default 추천 confirmed)

- **Q2 = (a) 정밀 line-circle test** — face 의 Plane + self-loop `Circle`
  (center/radius/normal) 로 (1) coplanarity (2) 선분 × 원 실제 교차 여부
  closed-form 계산 (2차방정식, operations 레벨 — curves/ 미접촉). 실제 교차
  face 만 polygonize (불필요 polygonize 0). cf. (b) AABB 광역 = 미교차 face 도
  polygon 화 → 거부.
- **Q3 = Circle self-loop 한정** (refined — 아래).
- **Q4 = (a) edge 자동 split + face emission gate 보존** (ADR-172/139 정합).
  disk 는 *기존 face 의 in-place 분할* — ADR-139 의 "자동 *신규* face emission
  금지" 와 직교 (직선 square split 과 동일 의미).
- **Q5 = (a) curves/ 미접촉** — approach A + Q2=a 는 closed-form line-circle
  만 필요 → NURBS kernel carve-out (L-70-5/L-172-10) 위배 0.
- **Q6 = (a) Additive** — 기존 find_line_crossings / exec_draw_line / 직선
  split 회귀 + kernel-native Circle 표현 보존 (미교차 시 0 변화).
- **Q7 = (a) ADR-174 신규** — ADR-173 §10 spawned future ADR.

#### Q3 refinement — "Circle + Arc" 의 정밀 해석 (사전 검토 발견)

사용자 결재 "Circle + Arc 우선" 의 정밀 분해 (§2.4 R5):
- **Circle self-loop face** (demo, ADR-169 Type 3 의 *실제* 케이스) — 본 ADR
  β scope. self-loop edge skip gap 의 직접 대상.
- **Arc**: *single-Arc self-loop closed face 는 존재하지 않음* (arc 는 θ1→θ2
  열린 곡선, 단독으로 면을 닫지 못함). Arc 는 항상 *multi-edge face 경계의
  한 segment* (예: pie-slice = 2 line + 1 arc). 이 경우 arc edge 는 self-loop
  아님 (2 distinct endpoint) → `find_line_crossings` 가 *chord (va→vb)* 로
  이미 검출하지만 **bulge 근처 위치 부정확 / 누락 가능** (별개 *정확도*
  문제). → **본 ADR scope = Circle self-loop**. Arc-edge 정확도는 후속
  sub-step 또는 별도 (§6).

### 2.3 Lock-in 매트릭스 (confirmed)

| Q | 결재 | 핵심 |
|---|---|---|
| **Q1** | **(a) Approach A (polygonize dispatch)** | ★ Pattern 12 + ADR-105 mirror |
| Q2 | (a) 정밀 line-circle test | 불필요 polygonize 0, curves/ 미접촉 |
| Q3 | **Circle self-loop 한정** (refined) | demo + Type 3 실제 케이스 |
| Q4 | (a) edge 자동 split + face gate 보존 | ADR-172/139 정합 |
| Q5 | (a) curves/ 미접촉 (closed-form) | carve-out 위배 0 |
| Q6 | (a) Additive | 직선 회귀 + kernel-native Circle 보존 |
| Q7 | (a) ADR-174 신규 | ADR-173 §10 spawned |

### 2.4 사전 검토 — Approach A 추후 문제점 (★ 사용자 요청, canonical)

각 risk = (발견 근거) + (β 단계 mitigation) + (blocker 여부). 모두 코드
grounded (mesh.rs / face_split.rs / scene.rs 실측).

| # | Risk | 근거 / 영향 | Mitigation (β 계획) | 등급 |
|---|---|---|---|---|
| **R0** | **API 개명** — ADR-105 `tessellate_closed_curve_face_in_place` 부재 | ADR-101 Phase A 가 흡수/개명 → `polygonize_closed_curve_face` (mesh.rs:3914). stale worktree spec 가 옛 이름 사용했었음 | spec/코드 모두 현재 이름 사용 (본 spec 정정 완료) | 해소 |
| **R1** | **anchor 가 rim** (center 아님) — 한 crossing 이 anchor 와 우연 일치 | demo: anchor @ (100,0,0) = 우측 crossing. `find_vertices_on_line` 가 anchor 검출 → 좌측 crossing 만 self-loop 에 남음 | β-1 helper 는 line-circle 2-교차 *모두* 계산 (anchor 일치 여부 무관). polygonize 후 두 crossing 모두 polygon edge/vertex 로 실재화 | 비-blocker (테스트로 lock) |
| **R2** | **pre-pass ID 무효화** — polygonize 가 face/edge/vert ID 재생성 | polygonize = remove_face + add_face → 새 ID | pre-pass 를 `exec_draw_line` *최상단* (find_line_crossings 전) 배치 → 이전 캡처 ID 없음 | 비-blocker |
| **R3** | **chord-inside vs secant 경계 모호** | ADR-105 (chord-inside) 와 본 ADR (secant) 의 dispatch 중복 위험 | Q2 정밀 test = **rim 2-교차 (secant)** 만 pre-pass polygonize. chord-inside (endpoint 가 disk 내부/rim) 는 기존 split_face_by_line 진입부 polygonize 가 그대로 담당 (경로 분리) | 비-blocker (명시 분리 + 회귀) |
| **R4** | **render fidelity** — split halves 의 rim 이 polygon facet | `polygonize_closed_curve_face` 가 **Plane surface 만 상속, sub-edge Arc 미재부착** (mesh.rs:4012-4018 실측; ADR-105 R-B 의 Arc-attach 는 ADR-101 흡수 시 dropped) | β: (옵션 polish) split 후 rim sub-edge 에 `AnalyticCurve::Arc` 재부착 (ADR-088 owner_id + render fast-path) — *또는* polygon facet accept (ADR-105 R-β 정신, chord_tol=radius·0.01 로 충분히 미세). **MVP = accept**, polish 별도 | 비-blocker (accepted trade-off) |
| **R5** | **Arc ≠ self-loop** | single-Arc 는 면을 닫지 못함 → "Circle + Arc" 의 Arc 는 multi-edge 경계 segment (정확도 문제, 별개) | Q3 refined: 본 ADR = Circle self-loop. Arc-edge crossing 정확도는 §6 후속 | 비-blocker (scope 명확화) |
| **R6** | **owner-id / rim 선택성** — split 후 rim 이 한 entity 로 선택되는가 | ADR-088 curve_owner_id / ADR-106 propagation. polygonize 가 owner_id 부여 안 하면 rim 이 N개 edge 로 분산 선택 | β-3 검증 + 필요 시 polygonize 결과 sub-edge 에 owner_id 부여 (R4 polish 와 동반) | 비-blocker (UX polish) |
| **R7** | **memory** — split disk 가 1-edge → N-edge (Path B 95% 절감 상실) | polygonize 영구 비용. 단 *split 된* disk 한정 (대부분 disk 미split) | split = 분할 의도의 자연 비용. 미split disk 0 영향. spec 명시 | 비-blocker (의도된 비용) |
| **R8** | **latency** (메타-원칙 #11) — pre-pass 가 매 drawLine 마다 전 closed-curve face 순회 | 수천 circle scene 에서 O(N) | β-1 helper 가 **AABB pre-filter** (find_line_crossings 답습) → 실제 근접 face 만 line-circle test. drawLine = commit budget (<100ms) | 비-blocker (AABB 강제) |
| **R9** | **tangent / 1-교차 / endpoint-on-curve edge case** | secant 아닌 접선(1점) / disk 밖 통과(0점) | β-1 helper: rim 교차 **2점** 일 때만 polygonize (그 외 no-op → 기존 동작, "분할 안 함" = "secant 아님" 정합) | 비-blocker (graceful) |
| **R10** | **large-R chord error** — polygon crossing 위치가 true circle 과 chord_tol 만큼 deviation | ADR-089 A-Γ: R=1000/N=64 → 1.2mm. polygonize chord_tol=radius·0.01 | 대부분 CAD 허용. 정밀 요구 시 Approach B (L-174-12) trigger. spec 명시 | 비-blocker (문서화) |
| **R11** | **cascading (메타-원칙 #16)** — pre-pass 가 의도치 않은 face 변형? | self-modify 자동화 위험 | pre-pass 는 *명시 secant* (2 rim 교차) 에만, *기존 disk in-place 분할* — 신규 face emission 0 (ADR-139 정합). edge split = 위상 correctness (모호 0). cascading 0 증명: 미교차/비-circle 시 0 변화 | 비-blocker (메타 #16 정합 증명) |

**종합**: blocker 0. 모든 risk 가 비-blocker (테스트 lock / accepted
trade-off / 문서화 / graceful). 최대 위험 항목 (R4 render fidelity) 은 ADR-105
R-β 가 이미 동일 trade-off accept — **MVP accept + polish 별도** 가 house
정합. Approach B (정확 arc) 는 R4/R6/R10 을 근본 해소하나 self-loop split
(Bug 1D) 위험 → trigger 발생 시 future (L-174-12).

---

## 3. Sub-step roadmap (Approach A — Path Z atomic 6-step)

- **α** (본 PR): spec only — Q1~Q7 결재 + §2.4 사전 검토 + L-174 Lock-ins.
- **β-1**: `closed_curve_faces_crossed_by_segment(start, end) -> Vec<FaceId>`
  read-only helper (AABB pre-filter + coplanar + line-circle 2-교차 closed-
  form, curves/ 미접촉) + 회귀 (secant 2-교차 / tangent no-op / disk-밖 no-op
  / 비-circle no-op / anchor-coincident).
- **β-2**: `exec_draw_line` pre-pass wiring (find_line_crossings 직전
  polygonize dispatch) + 회귀 (Circle disk + diameter → faces 1→2,
  manifold 0 violation, R3 chord-inside 비-회귀 가드).
- **β-3**: edge case 회귀 (anchor-coincident crossing / 양 endpoint disk
  밖 / 한 endpoint disk 내부) + (옵션) R4/R6 rim Arc 재부착 + owner_id polish.
- **β-4**: 사용자 facing 검증 (approach A 는 engine internal → WASM/TS 변경
  0 예상, ADR-105 R-E 답습) + HARD flag (ADR-101 A9) 정합 확인.
- **γ**: closure — Status Accepted + §9 Lessons + LOCKED #75 candidate +
  **Claude Preview MCP demo** (drawCircleAsCurve + drawLineAsShape 가로지름
  → faces 1→2, 사용자 비전 곡선 경계 end-to-end — ADR-172 γ / ADR-087 K-ζ).

**기간**: ~1주 (Pattern 12 재사용, 신규 알고리즘 = line-circle closed-form 1).

---

## 4. Lock-ins (confirmed default)

- **L-174-1** Approach A — polygonize dispatch (`polygonize_closed_curve_
  face` + ADR-172 battle-tested 직선 파이프라인 재사용, Pattern 12)
- **L-174-2** Pre-pass = `find_line_crossings` 직전 (상류 곡선 crossing gap
  해소, 하류 파이프라인 UNCHANGED)
- **L-174-3** 정밀 line-circle 2-교차 test (실제 secant face 만 polygonize —
  AABB pre-filter, R8/R9 graceful)
- **L-174-4** Circle self-loop 한정 (Arc = multi-edge 경계 segment 정확도,
  별개 §6; Bezier/BSpline/NURBS 후속)
- **L-174-5** edge 레벨 자동 split (위상 correctness, #5/#16, ADR-172
  L-172-3) + face emission gate 보존 (ADR-139, L-172-4)
- **L-174-6** split-induced edge HARD flag (ADR-101 A9, #15)
- **L-174-7** polygonize Plane surface 상속 보존. **rim Arc 재부착 = R4
  optional polish** (MVP = polygon facet accept, ADR-105 R-β 정신)
- **L-174-8** Additive backward compat (직선 split 회귀 + kernel-native
  Circle 표현 보존 — 미교차 시 0 변화)
- **L-174-9** NURBS kernel carve-out 강제 (curves/ + surfaces/ 미접촉 —
  closed-form only, Piegl & Tiller precondition 보존)
- **L-174-10** #14 WHAT (곡선 경계 disk → 2 disk-topology, H₁=0) + #15 split
  contract + #16 WHEN gate 보존 강제
- **L-174-11** 절대 #[ignore] 금지
- **L-174-12** Approach B (true 2-arc kernel-native split) = future ADR
  (downstream arc-fidelity trigger 시; self-loop split Bug 1D 선해소 필요)

---

## 5. Phase target — 사용자 비전 곡선 경계 확장

| 사용자 동작 | 본 ADR mechanism (approach A) |
|---|---|
| Circle 그림 (Path B) | 1 anchor(rim) + 1 self-loop edge + 1 disk face (ADR-089) |
| disk 가로지르는 선 1개 | pre-pass: line × Circle 2-교차 검출 → polygonize → 직선 파이프라인 (ADR-172) → 2 crossing split → **2 half-disk face** |
| 결과 | **"곡선 면도 선 그으면 나뉜다"** (ADR-172 직선 demo 의 곡선 경계 mirror) |

→ ADR-173 §10 곡면 한계 중 **곡선 *경계* (self-loop Circle edge) 크로싱**
해소. (곡면 *surface* 위 drawing (S3/S6/S9) 은 별개 — §6.)

---

## 6. Out of scope (future)

- **Approach B** (true kernel-native 2-arc self-loop split) — L-174-12.
- **곡면 *surface* 위 drawing** (S3/S6/S9 의 sphere/cylinder face 위 line —
  *non-planar* split, projection 미적용) — 본 ADR = *planar disk 의 곡선
  *경계***. curved-surface split 은 별도 (더 큰) 트랙.
- **Arc-edge crossing 정확도** (multi-edge face 의 arc segment 를 line 이
  가로지를 때 chord vs true-arc 위치 정밀화) — Q3 refinement R5, 후속.
- Bezier/BSpline/NURBS self-loop 경계 (polygonize 현재 `None` 반환).
- self-loop edge split primitive (`split_edge` self-loop 분기, Bug 1D) —
  approach A 미사용, B trigger 시.
- NURBS kernel `bail!` 변경 — L-174-9 carve-out.

---

## 7. Cross-link

### LOCKED 정책 정합
- **LOCKED #1/12/41** (SUPERSEDED by ADR-139 face 자동화 — edge split 별개)
- **LOCKED #5** spatial-hash 1.5μm (polygonize vertex dedup)
- **LOCKED #15** split contract (HARD flag) / **#41** ADR-101 A9
- **LOCKED #43** Z-up kernel-native primitive (Path B Circle anchor=rim)
- **LOCKED #44** Complete Meaning per Merge (6-step variant)
- **LOCKED #64** ADR-139 Boundary tool only (face emission gate, L-174-5)
- **LOCKED #70~74** ADR-169~173 Phase 1-4 (본 ADR = §10 spawned 후속)

### ADR cross-link
- ADR-089 closed-curve face 시민권 (Path B Circle anchor)
- ADR-105 polygonize dispatch (approach A mirror; helper 현재 ADR-101 owner)
- ADR-101 coplanar edge crossing + A9 HARD + polygonize helper 현재 owner
- ADR-172 Phase 3 직선 crossing-split (battle-tested, Pattern 12)
- ADR-173 Phase 4 12 게이트 (§10 spawn anchor, S3/S6/S9/S12)
- ADR-169 β-1 type matrix (Type 3) / β-3 (S6/S9 pending)
- ADR-088 curve_owner_id / ADR-106 split-site owner_id propagation (R6)
- ADR-030 CCI `intersect_curves` (approach B / Q5 carve-out)
- ADR-027/028/029/030 NURBS Kernel (L-174-9 carve-out)

### Sprint atomic patterns
- Pattern 12 engine already-robust (직선 파이프라인 + polygonize helper 재사용)
- Pattern 7 B hybrid (scene/mesh helper 재사용)
- 6-step variant (engine + 검증 + demo gate) / D-Then-C (ADR-169 sequence
  의 documented-limitation 후속)

### 메타-원칙
- #5 (곡선 교차 자동 split) / #14 (면은 닫힌 경계로부터) / #15 (split
  contract) / #16 (face emission gate)

---

## 8. Acceptance Log

### 8.1 α (본 PR)
- spec only — Q1=(a) Approach A / Q2=(a) / Q3=Circle self-loop / Q4~Q7 (a)
  결재 + §2.4 사전 검토 (R0~R11, blocker 0) + L-174-1~12 + 6-step roadmap.
- **세션 발견**: worktree 가 ADR-110 (stale) → `origin/main` (ADR-173,
  `69ddc83`) sync. ADR-105 helper 가 ADR-101 로 개명 (`polygonize_closed_
  curve_face`) 확인 → spec 정정 (R0). cargo 1.94.1 / rustc 1.94.1 확인 (β
  build 가능).
- 코드 변경 0. ADR-101 H-B (docs-first) + ADR-172 α 답습.

---

## 9. Lessons

(γ closure 시 — polygonize 재사용 비용 vs approach B 신규 비용 / R4 render
fidelity 의 MVP-accept 판단 / 곡선 경계 ↔ 곡면 surface 구분 / stale worktree
sync 의 audit 가치.)

---

## 10. LOCKED candidate (γ closure 시 사용자 별도 결재)

> **LOCKED #75 — ADR-174 Curve-Edge Crossing-Split closure (직선 × self-loop
> Circle 경계 → polygonize dispatch)**
>
> ADR-173 §10 spawned future ADR closure. ADR-172 직선 crossing-split 의
> 곡선 경계 확장.
>
> **불변 lock-in**:
> - Approach A (polygonize dispatch) — `find_line_crossings` 직전 pre-pass
>   가 secant 가 가로지르는 Circle self-loop face 를 선제 polygonize
>   (`polygonize_closed_curve_face` 재사용) → ADR-172 battle-tested 직선
>   파이프라인 자연 처리 → 2 half-disk face
> - 정밀 line-circle 2-교차 test (실제 secant face 만, AABB pre-filter,
>   curves/ 미접촉)
> - edge 자동 split (위상 correctness, #5/#16) + face emission gate 보존
>   (ADR-139) + HARD flag (ADR-101 A9)
> - Circle self-loop 한정 (Arc-edge 정확도 / Bezier·BSpline·NURBS / 곡면
>   surface drawing = 별도 트랙)
> - Approach B (true 2-arc kernel-native split) = future ADR (L-174-12)
> - Demo-verified (Claude Preview MCP): drawCircleAsCurve + drawLineAsShape
>   가로지름 → faces 1→2
>
> **회귀 자산**: (γ 실측 — 절대 #[ignore] 금지)

본 LOCKED entry 는 γ closure PR 의 별도 사용자 결재 후 CLAUDE.md 등재.
