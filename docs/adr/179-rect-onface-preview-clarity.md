# ADR-179 — DrawRect On-Face Preview Clarity (ADR-178 follow-up)

**Status**: Accepted (demo-verified 2026-06-01 — on-face preview amber #ffaa33)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 시연 (2026-06-01, 스크린샷): RECT 가 입체면이 아닌 다른
위치에 떠 보임. 진단 결과 — rect 는 올바른 face plane 위에 있으나 둘째 코너가
면 밖으로 가면 무한 plane 위로 연장됨.
**사용자 결재 (2026-06-01)**: **"무한 plane 연장 유지 + 프리뷰 개선"**.
**Direct precursor**: ADR-178 (LOCKED #77) — DrawRect face-aware drawing plane.

---

## 1. Problem statement

ADR-178 이 RECT 를 입체면 plane 에 그려지도록 함 (face-plane 정확 — 검증됨).
그러나 사용자가 **둘째 코너를 면 밖으로** 드래그하면 rect 가 그 면의 *무한
plane* 위로 연장돼 박스 밖에 떠 보임 (SketchUp 과 동일 동작이나 사용자는
"면에 안 그려졌다" 고 느낌).

진단 (Claude Preview ground-truth):
- 첫 클릭 +X wall → `this.plane` = x=100 (정확 ✅), 양쪽 클릭 면 위 →
  centroid (100,0,100) ✅
- 둘째 클릭 면 밖 → projected (100, **300**, 150) — 올바른 x=100 plane 위지만
  면 경계 (y=[-100,100]) 너머

→ plane 은 정확 (real bug 아님). **둘째 코너가 어디에 그려지는지 사용자가
인지 못 하는 가시성 문제.**

---

## 2. Solution (사용자 결재) — 무한 연장 유지 + on-face 프리뷰 명확화

무한 plane 연장 동작은 **유지** (SketchUp parity, 면보다 큰 rect 가능). 대신
*면 위에 그릴 때* 프리뷰를 **distinct 색상**으로 표시해 사용자가 한눈에 면
plane 위에 그리는 중임을 인지하도록.

### 변경 (`DrawRectTool.updatePreview`)

| 상태 | fill 색상 | fill opacity | outline 색상 |
|---|---|---|---|
| **on-face** (`plane.isFace`) | **amber #ffaa33** | 0.4 | **#ff8800** |
| ground/sketch | blue #4488ff (기존) | 0.3 | #2266dd (기존) |

`CardinalPlane.isFace?: boolean` 추가 — `resolveFacePlane` 만 `true` 설정
(ground/sketch 는 falsy). 프리뷰는 매 mousemove 갱신 (기존), 색상만 plane.isFace
로 분기.

---

## 3. Lock-ins

- **L-179-1** 무한 plane 연장 동작 유지 (사용자 결재, SketchUp parity)
- **L-179-2** on-face 프리뷰 = amber (#ffaa33 fill / #ff8800 outline)
- **L-179-3** ground/sketch 프리뷰 = blue (기존 보존)
- **L-179-4** `isFace` flag = `resolveFacePlane` only (SSOT)
- **L-179-5** Engine 변경 0 (TS only, 프리뷰 시각만)
- **L-179-6** 절대 #[ignore] 금지

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01)

| 검증 | 결과 |
|---|---|
| 박스 윗면 rect 시작 → plane.isFace | **true** ✅ |
| 프리뷰 fill 색상 | **#ffaa33 (amber)** ✅ |

→ 면 위에 그릴 때 amber 프리뷰로 명확. 바닥은 blue 유지.

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

DrawRectTool.test.ts (+1):
- `ADR-179 — cardinal ground plane has no isFace flag (blue preview)`
- (ADR-178 `face hit → ...` 테스트에 `isFace=true` assert 추가)

vitest: 14 → **15 PASS** (DrawRectTool), tsc 0 errors.

---

## 6. Cross-link

- **ADR-178** (LOCKED #77) — DrawRect face-aware drawing plane (직계 precursor)
- **ADR-175** (LOCKED #75) — get3DPoint face-aware (DrawLine)
- **ADR-039** (P24) — hover amber 색상 컨벤션 정합
- **ADR-046 P31 #2** Precision Visibility (프리뷰 명확성 Pillar)
- **메타-원칙 #5** 사용자 편의 / **#8** 즉각 반응
- **ADR-087 K-ζ** 사용자 시연 게이트 / **LOCKED #44** Complete Meaning per Merge

---

## 7. Out of scope (future)

- 면 경계 highlight (rect 시작 면의 outline 강조) — 더 강한 시각 피드백, 별도
- 면 밖으로 나갈 때 색상 전환 (on-face → off-face 경고색) — 면 bounds 필요, 별도
- Axis inference / snap 라인 (rect 코너 정렬) — 별도 ADR
