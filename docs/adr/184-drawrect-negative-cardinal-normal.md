# ADR-184 — DrawRect Negative Cardinal Normal Faces (-X/-Y/-Z)

**Status**: Accepted (demo-verified 2026-06-01 — -X/-Y 면에 정상으로 그려짐)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 보고 (2026-06-01):
> "이 두면에만 그리지 못합니다 ... -y 면에 안그려짐"
> (통찰) "서클은 면의 앞뒷면 모두에 그려짐... 사각형은 한쪽면만 그려짐.
>  서클을 그리는 방식으로 진행하면 안되는지?"
**Direct precursors**: ADR-181 (getDrawPlane SSOT), ADR-178/179 (face-aware /
projection precision), ADR-026 P12 (cardinal snap).

---

## 1. Problem statement

정육면체의 **음의 cardinal normal 면 (-X / -Y / -Z)** 에 사각형을 그리면 rect 가
**반대편(+) 면으로 점프**해서 그 면에는 안 그려졌다. +X / +Y / +Z 면은 정상.
DrawCircle 은 양면 모두 정상 (사용자 통찰).

### Root cause — `forceCardinalAxis` 부호 버그

`DrawRectTool` 은 `zeroValue = normal·point` (**부호 있는 평면 거리**, face 의
실제 좌표가 아님) 를 저장하고, `forceCardinalAxis` 가 `pt[axis] = zeroValue` 로
강제한다:

| 면 | normal | 면 좌표 | zeroValue = normal·p | forceCardinalAxis 결과 |
|---|---|---|---|---|
| +Y | (0,1,0) | y=+100 | +100 | pt.y=+100 ✅ |
| **−Y** | (0,-1,0) | y=**−100** | (-1)×(-100)=**+100** | pt.y=**+100** ❌ (반대편!) |
| **−X** | (-1,0,0) | x=−100 | +100 | pt.x=+100 ❌ |
| **−Z** | (0,0,-1) | z=−50 | +50 | pt.z=+50 ❌ |

음의 normal 면은 `zeroValue`(부호 거리)와 좌표의 부호가 반대 → forceCardinalAxis
가 반대편(+) 좌표를 강제 → rect 가 반대 면에 그려짐. COPLANAR_PICK_TOL pick-hit
경로(정확한 hit 좌표)도 직후 forceCardinalAxis 가 덮어써서 동일하게 깨졌다.

### 왜 DrawCircle 은 양면 다 되나 (사용자 관찰 정확)

DrawCircle 은 **부호 거리(zeroValue)를 안 쓴다.** 실제 중심 *점* 으로
`THREE.Plane` (`setFromNormalAndCoplanarPoint`) 을 만들고, ray∩plane + 좌표를
`circleCenter[axis]` (실제 좌표) 로 강제 → **부호 무관 항상 정확**.

---

## 2. Solution — `forceCardinalAxis` 부호 정정 (사용자 결재 Option A)

`zeroValue`(부호 거리) → 실제 좌표 변환. cardinal 축에서 normal 성분은 ±1 이므로
좌표 = `zeroValue / sign(normal[axis])`:

```ts
private forceCardinalAxis(pt, plane) {
  if (!plane.forceCardinal) return;
  if (plane.zeroAxis === 'x') pt.x = plane.zeroValue / (Math.sign(plane.normal.x) || 1);
  else if (plane.zeroAxis === 'y') pt.y = plane.zeroValue / (Math.sign(plane.normal.y) || 1);
  else pt.z = plane.zeroValue / (Math.sign(plane.normal.z) || 1);
}
```

- +Y: +100 / sign(+1) = +100 ✅ (불변)
- −Y: +100 / sign(−1) = **−100** ✅ (수정)
- ground z=0: 0 / sign(+1) = 0 ✅ (LOCKED #63 보존)

`zeroValue` 자체(ray∩plane 의 `THREE.Plane(normal, -zeroValue)` 가 사용)는 부호
거리로 **유지** — ray∩plane 의 평면 수식은 부호 거리가 맞기 때문. `forceCardinalAxis`
만 좌표로 변환. (Circle 의 "실제 좌표 사용" 원리를 surgical 하게 회복 — 사용자
제안의 최소 구현.)

---

## 3. Lock-ins

- **L-184-1** `forceCardinalAxis` 는 `zeroValue / sign(normal[axis])` (부호 거리 →
  좌표). -X/-Y/-Z 면 정상.
- **L-184-2** `zeroValue = normal·ref` (부호 거리) 유지 — ray∩plane 수식 정합.
- **L-184-3** +X/+Y/+Z + ground(z=0) 불변 (회귀 보존).
- **L-184-4** COPLANAR_PICK_TOL(ADR-179) grazing 정밀 path 보존.
- **L-184-5** `Math.sign(0) || 1` 가드 (forceCardinal 시 ±1 보장이나 방어).
- **L-184-6** Engine 변경 0 (TS only). DrawCircle 과 동일 결과(양면 그리기).
- **L-184-7** 절대 #[ignore] 금지.

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01, real Chromium)

| 검증 | before | after |
|---|---|---|
| -Y 면 (y=-100) 에 rect | +Y 면(+100)으로 점프 ❌ | **y=-100 에 그려짐 ✅** |
| -X 면 (x=-100) 에 rect | ❌ | **x=-100 에 그려짐 ✅** |
| +X/+Y/+Z 면 | ✅ | ✅ (불변) |

→ 6면 모두 (보이는 한) 정상으로 그려짐. DrawCircle 처럼 양면 그리기 성립.

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

`DrawRectTool.test.ts` (+6):
- `forceCardinalAxis: -Y face (zeroValue +100, normal -Y) → pt.y = -100`
- `forceCardinalAxis: -X face → pt.x = -100`
- `forceCardinalAxis: -Z face → pt.z = -50`
- `forceCardinalAxis: +Y face (positive) still → pt.y = +100` (regression)
- `forceCardinalAxis: ground z=0 → pt.z = 0` (LOCKED #63 보존)
- `projectClickToCardinalPlane on -Y face → 2nd corner lands at y=-100` (end-to-end)

vitest: 2086 → **2092 PASS**, tsc 0 errors.

---

## 6. Cross-link

- **ADR-181** getDrawPlane SSOT (base — resolvePlane 의 zeroValue source)
- **ADR-179** projection precision (COPLANAR_PICK_TOL — grazing path 보존)
- **ADR-178** face-aware (forceCardinal flag source)
- **DrawCircleTool** — 양면 그리기 reference (실제 좌표 사용 원리)
- **ADR-026 P12** cardinal snap / **LOCKED #63** z=0 invariant (ground 보존)
- **메타-원칙 #4** SSOT (Circle 원리 정합) / **#9** 회귀 없음
- **ADR-087 K-ζ** 사용자 시연 게이트 / **LOCKED #44** Complete Meaning per Merge

---

## 7. Out of scope (follow-up)

- **DrawCircle 방식 전면 통일 (Option B)** — projectClickToCardinalPlane 를
  Circle 의 drawPlane3 + ray∩plane 으로 교체해 Rect↔Circle projection SSOT 통일.
  본 ADR(Option A)은 부호 버그만 surgical 수정. 전면 통일은 별도 ADR 사전검토.
- **isFaceInVolume push-pull 분류** (ADR-183 §7) — 별개 follow-up.
