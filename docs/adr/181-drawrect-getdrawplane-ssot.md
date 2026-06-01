# ADR-181 — DrawRect getDrawPlane SSOT Unification (face-draw parity with Circle)

**Status**: Accepted (demo-verified 2026-06-01 — face draw works + LOCKED #63 z=0
preserved + sticky-fallback robustness inherited)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 결재 2026-06-01:
> "보이는 면에 커서를 가져가면 도형을 그려야 합니다. 서클은 되는데 rect는
>  안됩니다. 서클과 차이점을 검토하세요."
**Direct precursors**: ADR-178 (face-aware drawing plane, LOCKED #77),
ADR-179 (on-face preview), PR #101 (cardinal-strict rewrite, LOCKED #63).

---

## 1. Problem statement

DrawCircle 은 보이는 면에 커서를 가져가면 그 면에 그려진다. DrawRect 는 안
된다 — 면이 아닌 다른 위치(주로 ground z=0)에 생성된다.

사용자가 지목한 "Circle 과의 차이"를 코드에서 추적한 결과:

| | 평면 해석 경로 |
|---|---|
| **DrawCircle** (작동 ✅) | `ctx.getDrawPlane(e)` — 캐논 face-aware SSOT (ADR-140) |
| **DrawRect** (실패 ❌) | 자체 `resolveFacePlane(e)` (ADR-178) — `viewport.pick + getFaceId + getFaceNormal` |

`getDrawPlane` 은 **다섯 가지 robustness** 를 모두 갖는다:
1. face hit (ADR-140 surface-aware tangent plane)
2. plane lock auto-unlock-on-different-plane (ADR-166)
3. **sticky fallback** (ADR-164) — pick 이 순간 miss 해도 직전 plane 유지
4. sketch plane (user explicit)
5. view-mode default (3d→Z=0 / front→Y=0 / right→X=0)

ADR-178 의 `resolveFacePlane` 은 이 중 **아무것도 없다**. `viewport.pick` 이
`null`(혹은 faceIndex 없음)을 반환하면 — 실제 마우스의 *가장자리 클릭 /
경사각 / BVH 순간 miss* — `resolveFacePlane` 이 `null` 을 반환하고,
`resolveCardinalPlane` (= view-mode default = 3d 에서 ground z=0) 으로 떨어진다.
그래서 rect 가 "면이 아닌 다른 위치에 생성"된다.

DrawCircle 은 같은 pick miss 에서도 **sticky fallback 으로 직전 면 plane 을
유지**해 면 위에 남는다. 이것이 사용자가 본 정확한 차이다.

### Ground-truth 진단 (Claude Preview MCP)

| 검증 | 결과 |
|---|---|
| `getDrawPlane` at +X wall / +Y wall / top | **onFace:true + 정확한 면 normal** ✅ |
| 합성 마우스 rect on +X wall (면 정중앙, pick 성공) | 면에 landed ✅ (그래서 reproduce 어려움) |
| 합성 마우스 circle on +X wall | 면에 landed ✅ |
| `resolveFacePlane` 의 null→ground fallback 경로 | 실제 마우스 pick-miss 시 trigger (synthetic 으로는 안 보임) |

→ 합성 마우스는 면 정중앙을 정확히 클릭하므로 pick 이 항상 성공해 버그가
가려졌다. 실제 사용자 마우스는 면 경계 근처·경사각에서 pick 이 빗나가
`resolveFacePlane` null → ground 로 떨어진다.

---

## 2. Solution — getDrawPlane SSOT 통일 (메타-원칙 #4)

DrawRect 의 divergent `resolveFacePlane` 을 제거하고, **DrawCircle 과 동일한
`ctx.getDrawPlane(e)`** 를 단일 진실 원천으로 사용한다. DrawRect 는 이로써
DrawCircle 의 *동일한* face-aware 견고성(sticky / lock / surface-aware)을
얻는다.

### `resolvePlane(e, point)` (DrawRectTool)

```
const dp = this.ctx.getDrawPlane(e);     // ← SSOT (DrawCircle 과 동일)
normal/up/right = dp.{normal,up,right};
onFace = dp.onFace;
zeroAxis/forceCardinal = (|normal.axis| > 0.999 인 cardinal axis);
// 평면 offset (zeroValue):
//   · face / sketch / plane-lock → normal · referencePoint
//   · cardinal ground/wall-view default → 0   ← LOCKED #63 z=0 보존
ref = dp.origin ?? point ?? viewport.pick(e).point;
zeroValue = (onFace || isSketch || dp.origin) ? normal·ref : 0;
```

### LOCKED #63 z=0 invariant 보존

face / sketch / plane-lock 가 *아닌* cardinal 기본 평면(빈 ground / wall-view
default)은 `zeroValue = 0` 강제. 즉 **빈 공간 그리기는 여전히 정확히 z=0**
(또는 y=0 / x=0). DrawCircle 도 정확히 같은 방식(`!onFace` 시 cardinal-axis
좌표 0 강제)으로 LOCKED #63 을 지킨다.

### 제거/유지

- **제거**: `resolveFacePlane` (divergent, ADR-178) — getDrawPlane SSOT 로 흡수.
- **유지**: `projectClickToCardinalPlane` (둘째 코너 정밀화, ADR-179) —
  `resolvePlane` 이 만든 plane 위에서 그대로 동작.
- **유지**: `resolveCardinalPlane` (VCB fallback, this.plane null 시).
- **유지**: amber on-face preview (ADR-179) — `plane.isFace = dp.onFace`.

---

## 3. Lock-ins

- **L-181-1** Plane 해석 = `ctx.getDrawPlane(e)` 단일 SSOT (DrawCircle 과 동일).
- **L-181-2** DrawRect 의 자체 face-pick 경로(`resolveFacePlane`) 폐기 —
  divergence 제거.
- **L-181-3** LOCKED #63 z=0 invariant 보존: `!onFace && !isSketch && !origin`
  → cardinal-axis 좌표 = exactly 0.
- **L-181-4** face / sketch / plane-lock 의 plane offset = `normal · refPoint`.
- **L-181-5** sticky fallback (ADR-164) + plane lock (ADR-166) + surface-aware
  (ADR-140) 모두 자동 상속 (getDrawPlane 경유).
- **L-181-6** amber on-face preview = `plane.isFace` = `dp.onFace` (ADR-179 보존).
- **L-181-7** `projectClickToCardinalPlane` (ADR-179 둘째 코너 정밀) 불변.
- **L-181-8** Engine 변경 0 (TS only).
- **L-181-9** 절대 #[ignore] 금지.

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01, real Chromium)

| 검증 | 결과 |
|---|---|
| `getDrawPlane` at +X/+Y/top 면 | onFace:true + 정확한 normal ✅ |
| rect on +X wall (regression) | 면에 landed (x=100 verts +8) ✅ |
| ground rect (top view) | z=0 강제 (z=0 verts +8) ✅ LOCKED #63 보존 |
| +X wall rect 후 sticky plane | normal [1,0,0] source 'view' ✅ |
| pick-miss at empty space 후 getDrawPlane | **+X wall 유지** (normal [1,0,0]) ✅ |

→ **DrawRect now inherits DrawCircle robustness**: 면 그리기 작동 + z=0 보존 +
pick-miss 시 직전 면 plane 유지(ground 로 안 떨어짐).

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

DrawRectTool.test.ts — ADR-178 의 `resolveFacePlane` 테스트(8)를 ADR-181
`resolvePlane` (getDrawPlane mock) 테스트(7)로 교체 + ADR-179 projection 정밀
테스트(3) 유지:

ADR-181 `resolvePlane`:
- `face hit (cardinal +Z at z=200) → zeroValue=200, isFace=true`
- `cardinal +X wall face → zeroValue=100, zeroAxis=x`
- `LOCKED #63 — ground (no face) forces z=0 despite drifted click`
- `plane-lock (dp.origin, onFace false) → zeroValue from origin`
- `sketch mode → offset preserved (NOT forced to 0)`
- `slanted (non-cardinal) face → forceCardinal false`
- `null point but face under cursor → viewport.pick fallback`

ADR-179 (retained): cardinal ground no-isFace / coplanar pick hit / off-plane
fall-through.

vitest: **19 PASS** (DrawRectTool), tsc 0 errors.

---

## 6. Cross-link

- **ADR-178** (LOCKED #77) — face-aware drawing plane (resolveFacePlane, 본 ADR
  이 superseded — getDrawPlane SSOT 로 흡수)
- **ADR-179** (LOCKED #79가 아님 — DrawRect on-face preview) — amber preview +
  projectClickToCardinalPlane 정밀, 본 ADR 에서 유지
- **ADR-140** (surface-aware getDrawPlane) — face hit / tangent plane source
- **ADR-164** (sticky last drawn plane) — pick-miss 견고성 source
- **ADR-166** (active sketch plane session lock) — cross-tool lock
- **DrawCircleTool** — getDrawPlane SSOT 의 reference 구현
- **메타-원칙 #4** SSOT — getDrawPlane 단일 진실 원천
- **LOCKED #63** z=0 invariant (!onFace 시 보존) / **LOCKED #7** ADR-026 P12 /
  **LOCKED #43** ADR-103 Z-up
- **ADR-087 K-ζ** canonical 사용자 시연 게이트 / **LOCKED #44** Complete Meaning
  per Merge

---

## 7. Out of scope (future)

- DrawPolygon / DrawArc / DrawBezier / DrawFreehand 의 plane 해석 audit — 이미
  getDrawPlane 사용 확인됨(본 ADR scope 외, 정합 OK).
- 면 경계 highlight / 면 밖 경고색 (ADR-179 §7 동일 — 별도).
- snap re-introduction (PR #101 snap-free 정책 — 별도 ADR).
