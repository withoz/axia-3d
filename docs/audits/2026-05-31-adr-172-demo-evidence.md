# ADR-172 Phase 3 — User Vision Demo Evidence

**Date**: 2026-05-31
**Author**: WYKO + Claude
**Method**: Claude Preview MCP (real browser, dev server port 3002, freshly
built WASM)
**Source**: ADR-172 γ closure (LOCKED #73) — 사용자 결재 "(A) demo 검증
→ γ closure" + "(2) 추가 시연 (원/곡선/입체면)"
**사용자 비전 (canonical, 2026-05-29)**: "선만 그려, 케이크는 알아서
나뉜다"

---

## 1. Executive Summary

ADR-172 Phase 3 의 **Pattern 12 finding** (crossing-split mechanism 이
이미 완전 구현) 을 실제 브라우저에서 7 시나리오로 end-to-end 검증.

**결과**: 직선 도형 + 입체면 = **완전 작동** ✅. 곡선(원) 면 분할 =
**미지원** ⚠ (audit 에서 이미 예측된 future 영역).

| # | 시나리오 | 결과 | 판정 |
|---|---|---|---|
| A | 선 2개 교차 ("+") | verts 2→5 (교차점 자동) | ✅ |
| B | 닫힌 사각형 (선 4개) | faces 0→1 (면 자동 합성) | ✅ |
| C | 면 가로지르는 선 | faces 1→2 (분할) | ✅ |
| D | 원 (Path B kernel-native) | 1 vert + 1 self-loop edge + 1 face | ✅ |
| **E** | **원 가로지르는 선** | **faces 1→1 (분할 안 됨)** | ⚠ **한계** |
| F | 입체 박스 생성 | 8 verts, 12 edges, 6 faces | ✅ |
| G | **입체면 위 선** | **faces 6→7 (분할)** | ✅ |

---

## 2. 시나리오별 상세 evidence

### 시나리오 A — 선 교차 → 교차점 자동 생성

```
① 초기 (빈 씬):        verts=0 edges=0 faces=0
② 수평선 1개:          verts=2 edges=1 faces=0
③ 수직선 교차 ("+"):   verts=5 edges=5 faces=0  ← 교차점 vertex 자동 생성
```

- `drawLineAsShape(-100,0,0, 100,0,0, 0,0,1)` → 수평선
- `drawLineAsShape(0,-100,0, 0,100,0, 0,0,1)` → 수직선, 원점에서 교차
- **verts 2 → 5**: 4 endpoints + 1 crossing vertex (원점) 자동 생성
- Mechanism: `find_line_crossings` + `split_edge` (mesh.rs:1370, scene.rs:4008)

### 시나리오 B — 닫힌 사각형 → 면 자동 합성

```
④ 닫힌 사각형 (선 4개): verts=4 edges=4 faces=1  ← 면 1개 자동 합성
```

- 200×200 사각형, 4 DrawLine (하/우/상/좌변)
- **faces 0 → 1**: 닫힌 loop 형성 시 face 자동 합성 (메타-원칙 #14)

### 시나리오 C — 면 가로지르는 선 → 분할 ("케이크가 나뉜다")

```
⑤ 가로지르는 선 1개:   verts=6 edges=9 faces=2  ← 면 1 → 2 분할
```

- `drawLineAsShape(-100,0,0, 100,0,0, 0,0,1)` (좌변→우변 관통)
- **faces 1 → 2**: 사각형이 위/아래 반으로 정확히 분할
- Mechanism: crossing-split (좌/우변 split) + `split_face_by_line`
- **결정적 증명**: "선만 그려, 케이크는 알아서 나뉜다" ✅

### 시나리오 D — 원 (Path B kernel-native closed curve)

```
원 (drawCircleAsCurve):  verts=1 edges=1 faces=1
```

- `drawCircleAsCurve(0,0,0, 0,0,1, 100)` (radius 100)
- ADR-089 canonical: 1 anchor vert + 1 self-loop edge with Circle curve +
  1 closed-curve face
- **faces 0 → 1**: 곡선 경계 면 정상 생성 ✅

### 시나리오 E — 원 가로지르는 선 → 분할 안 됨 (⚠ 한계)

```
E1 원 상태:            verts=1 edges=1 faces=1
E2 지름선 관통:        verts=3 edges=3 faces=1  ← faces 1 → 1 (분할 안 됨)
```

- `drawLineAsShape(-120,0,0, 120,0,0, 0,0,1)` (원을 x=±100 에서 관통)
- **faces 1 → 1**: 선은 추가되었으나 (verts 1→3, edges 1→3) **원 면은
  분할되지 않음**
- **Root cause**: `find_line_crossings` 는 직선 segment-segment 교차만
  처리. 곡선 self-loop edge (AnalyticCurve::Circle) 와 직선의 교차 미처리.
- **Audit cross-link** (이미 예측됨):
  * ADR-169 β-1 Type 3 (Arc/Circle) = ⚠ "Self-loop only" partial
  * ADR-169 β-3 S6/S9 (curved surface) = ⏸ Pending
  * ADR-172 §6 Out of scope: "Arc/Bezier/NURBS register 후속"
- **Future ADR 후보** (spawned task 2026-05-31): curve-edge crossing-split

### 시나리오 F — 입체 박스 생성

```
박스 (create_box):      verts=8 edges=12 faces=6  ← 정육면체
```

- `create_box(0,0,100, 200,200,200)` (바닥 z=0, 높이 200)
- 8 verts, 12 edges, 6 faces = canonical 정육면체 ✅
- top face (normal +Z at z=200) = face 1

### 시나리오 G — 입체면 위 선 → 분할 (사용자 원래 버그 해소)

```
G1 박스 상태:          verts=8 edges=12 faces=6
G2 입체면 위 선:        verts=10 edges=17 faces=7  ← faces 6 → 7 (분할)
```

- `drawLineAsShape(-100,0,200, 100,0,200, 0,0,1)` (top face z=200 위 가로선)
- **faces 6 → 7**: top face 가 2개로 분할 ✅
- **사용자 원래 pain point 해소**: PR #247/248 의 "입체면에 라인을
  생성할 수 없습니다" 완전 해소 확인
- Mechanism: face plane projection (ADR-170/171 absorb) + crossing-split +
  `split_face_by_line`

---

## 3. 정직한 결론 — 직선 vs 곡선 경계

### ✅ 완전 작동 (직선 경계 + 입체면)

- 평면 위 선 교차 → 교차점 자동 (A)
- 닫힌 직선 영역 → 면 자동 합성 (B)
- 직선 면 분할 (C)
- 입체 박스 생성 (F)
- **입체면 위 선 분할** (G) — 원래 버그 해소

### ⚠ 미지원 (곡선 경계)

- **원(Circle) 면을 선이 가로질러도 분할 안 됨** (E)
- 원인: `find_line_crossings` 직선 전용 — 곡선 self-loop edge 미참여
- audit 에서 *이미 예측된* future 영역 (β-1 Type 3 / β-3 S6/S9)
- Future ADR 후보로 분리 (curve-edge crossing-split, 2026-05-31 spawned)

---

## 4. ADR-172 Pattern 12 finding 재확인

본 demo 는 ADR-172 의 **Pattern 12 finding** 을 실증:

> 사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" mechanism 이 *이미*
> DrawLine 경로 (exec_draw_line + find_line_crossings + split_edge +
> mark_edge_hard) 에 완전 구현 + battle-tested.

- 직선 도형 (사각형, 입체면) 의 crossing-split + face split 모두 작동
- register_boundary_element 신규 SSOT 불필요 (mechanism 작동, LOCKED #73)
- 곡선 한계만 genuine future work

**회귀 lock-in** (절대 #[ignore] 금지):
- `adr172_beta1_two_crossing_drawlines_auto_split` (시나리오 A)
- `adr172_gamma_line_across_face_splits_into_two` (시나리오 B+C)

---

## 5. Cross-link

### ADR / LOCKED
- ADR-172 §8.4 γ (demo verification anchor) + §10 LOCKED #73
- LOCKED #73 ADR-172 Phase 3 closure (crossing-split already exists)
- LOCKED #70 ADR-169 Phase 1-4 anchor
- LOCKED #71/72 ADR-170/171 Phase 1/2 (absorb chain)
- ADR-089 Path B closed-curve face (시나리오 D)
- ADR-101 Amendment 9 HARD flag (mark_edge_hard)
- ADR-139 Boundary tool only (face emission gate)
- ADR-170/171 absorb (입체면 face plane projection, 시나리오 G)
- ADR-087 K-ζ 사용자 시연 게이트 canonical

### Audit 산출물
- ADR-169 β-1 boundary element type matrix (Type 3 Arc/Circle ⚠ 예측)
- ADR-169 β-3 user demo evidence (S6/S9 curved ⏸ 예측)

### Future ADR 후보 (2026-05-31 spawned task)
- Curve-edge crossing-split (Circle/Arc 면 분할) — 시나리오 E 해소

### Pattern (memory)
- Pattern 12 engine already-robust (deepest 적용 — ADR-172 demo-verified)
- WASM 빌드 + preview_eval demo canonical (screenshot timeout 시 eval 우선)
