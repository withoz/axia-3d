# ADR-179 — DrawRect On-Face Preview (Clarity + Correctness + Precision)

**Status**: Accepted (demo-verified 2026-06-01 — amber #ffaa33 + makeBasis 방향
일치 + face-pick precision)
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

### 2.2 추가 fix — 미리보기 방향 일치 (makeBasis)

사용자 시연 (스크린샷): amber 채움이 외곽선과 **다른 방향** (채움 가로 띠 ↔
외곽선 세로). 원인 — 채움 PlaneGeometry 가 `setFromUnitVectors(+Z, n)` 로
배향 → in-plane twist 가 *임의* → 채움의 width/height 축이 outline 의
`plane.right`/`plane.up` 과 불일치 (cardinal wall 에서 90° swap).

**Fix**: `Matrix4.makeBasis(plane.right, plane.up, n)` + `setFromRotationMatrix`
— 채움의 local X→right, Y→up, Z→normal 으로 고정 → outline 과 정확히 일치.

### 2.3 추가 fix — 둘째 코너 정밀화 (face-pick precision)

사용자 시연: RECT 미리보기 치수 **9,893mm 폭발** (박스 200mm 의 ~50배). 원인 —
grazing plane (면을 얕은 각도로 봄) 에서 둘째 코너 `ray∩plane` projection 이
멀리 튐.

**Fix**: `projectClickToCardinalPlane` 가 cursor 아래 face 를 pick 해서, 그
hit point 가 locked plane 과 **coplanar** (|normal·hit − zeroValue| <
`COPLANAR_PICK_TOL` 1mm) 면 그 **정확한 hit point** 사용 (grazing 회피). off-
plane (다른 면 / 빈 공간) 이면 `ray∩plane` 으로 fall-through (무한 연장 보존).

---

## 3. Lock-ins

- **L-179-1** 무한 plane 연장 동작 유지 (사용자 결재, SketchUp parity)
- **L-179-2** on-face 프리뷰 = amber (#ffaa33 fill / #ff8800 outline)
- **L-179-3** ground/sketch 프리뷰 = blue (기존 보존)
- **L-179-4** `isFace` flag = `resolveFacePlane` only (SSOT)
- **L-179-5** 미리보기 채움 배향 = `makeBasis(right, up, normal)` (outline 과 일치)
- **L-179-6** 둘째 코너 = coplanar face pick hit (정밀) → else `ray∩plane` (연장)
- **L-179-7** `COPLANAR_PICK_TOL` = 1mm (다른 면 거부 / 같은 면 수용)
- **L-179-8** Engine 변경 0 (TS only)
- **L-179-9** 절대 #[ignore] 금지

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01)

| 검증 | 결과 |
|---|---|
| 박스 윗면 rect 시작 → plane.isFace | **true** ✅ |
| 프리뷰 fill 색상 | **#ffaa33 (amber)** ✅ |
| 미리보기 채움 방향 (preview localX vs plane.right) | **일치 ✅ (FILL MATCHES OUTLINE)** |
| +X wall 둘째 코너 on-wall → rect 치수 | **80mm × 80mm** ✅ (이전 9,893mm 폭발) |

→ amber 프리뷰 + 채움/외곽선 방향 일치 + 면 위 정밀 (grazing 폭발 해소).

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

DrawRectTool.test.ts (+3):
- `ADR-179 — cardinal ground plane has no isFace flag (blue preview)`
- `ADR-179 — 2nd corner on coplanar face → exact pick hit (no grazing blowup)`
- `ADR-179 — 2nd corner over off-plane face → falls through to ray∩plane`
- (ADR-178 `face hit → ...` 테스트에 `isFace=true` assert 추가)

vitest: 14 → **17 PASS** (DrawRectTool), tsc 0 errors.

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
