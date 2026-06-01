# ADR-178 — DrawRect Face-Aware Drawing Plane (ADR-175 extension / LOCKED #63 amendment)

**Status**: Accepted (demo-verified 2026-06-01 — RECT on box top face → z=200,
facesCentroid confirmed)

> ⚠ **Mechanism superseded by ADR-181** (2026-06-01). 본 ADR 의 *face-aware
> 의도* (RECT 가 입체면 위에 그려짐) 는 **불변 유지**. 그러나 그 구현
> (`resolveFacePlane` 의 자체 `viewport.pick`) 은 ADR-181 에서 폐기 —
> DrawCircle 과 동일한 `ctx.getDrawPlane(e)` SSOT (메타-원칙 #4) 로 통일.
> 이유: `resolveFacePlane` 은 sticky / lock / surface-aware robustness 가
> 없어, 실제 마우스의 pick-miss 시 null → ground 로 떨어졌음 (사용자 결재
> "서클은 되는데 rect는 안됩니다"). 자세한 근거는 ADR-181 §1 참조.
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 보고 (2026-06-01): **"rect는 입체면에 작성이 안됌"**
(RECT 가 solid face 위에 그려지지 않음).
**Direct precursors**:
- ADR-175 (LOCKED #75) — get3DPoint face-aware (DrawLine). 본 ADR 은 RECT 로 확장
- LOCKED #63 (PR #101) — z=0 invariant (DrawRectTool cardinal 강제 재작성)
- ADR-140 — surface-aware getDrawPlane (다른 Draw 도구의 face-aware 패턴)

---

## 1. Problem statement

ADR-175 가 `get3DPoint` (DrawLine 사용) 을 face-aware 로 만들어 입체면 위
선 그리기를 활성화했으나, **DrawRect 는 여전히 입체면 위에 안 그려짐**.

### Root cause — DrawRectTool 만 cardinal 강제

audit 결과: **DrawCircle / DrawPolygon / DrawArc / DrawBezier / DrawFreehand
는 모두 `getDrawPlane` (ADR-140, face-aware)** 를 사용. **DrawRect 만**
PR #101 (LOCKED #63) 에서 `resolveCardinalPlane()` (cardinal ground plane
강제, face hit 우회) 로 재작성되며 face-awareness 가 누락됨.

```
DrawRectTool.resolveCardinalPlane()  → view mode 기반 cardinal ground only
                                       (face hit 완전 무시 → z=0 강제)
```

LOCKED #63 의 z=0 강제는 *drift 방지* 목적이었으나, 그 drift 는 ADR-170/171/
168 absorb 인프라가 해소 (ADR-175 와 동일 논리).

---

## 2. Solution — `resolveFacePlane` (ADR-175 패턴 RECT 적용)

DrawRectTool 의 첫 클릭에서 face hit 을 감지해 그 face plane 을 사용:

```typescript
// onMouseDown 첫 클릭
const plane = this.resolveFacePlane(e) ?? this.resolveCardinalPlane();
```

`resolveFacePlane(e)`:
- sketch mode → null (sketch plane 우선, resolveCardinalPlane 처리)
- `viewport.pick` → face hit → `getFaceId` → `getFaceNormal`
- `zeroValue = normal·hitPoint` (signed plane offset)
- **cardinal-aligned face** (|n.axis|>0.999) → `forceCardinal=true`, zeroAxis 설정
  (drift defense — box face)
- **slanted face** → `forceCardinal=false` (ray→plane projection 신뢰)
- 빈 공간 (pick null) → null → `resolveCardinalPlane()` (z=0 강제 보존)

`forceCardinalAxis` 에 `if (!plane.forceCardinal) return;` 추가 — slanted
face 는 cardinal 강제 skip.

### 동작 매트릭스

| Cursor 위치 | 결과 |
|---|---|
| **cardinal 입체면** (box face z=200) | 그 face plane (z=200) — **NEW** |
| **slanted 입체면** | face plane (ray projection) — **NEW** |
| **빈 공간** | cardinal ground (z=0 강제, LOCKED #63 보존) |
| **sketch mode** | sketch plane (보존) |

---

## 3. Lock-ins

- **L-178-1** DrawRect face-aware (face hit → face plane, no hit → z=0)
- **L-178-2** 다른 Draw 도구 (Circle/Polygon/Arc/Bezier/Freehand) 와 일치 —
  모두 face-aware
- **L-178-3** LOCKED #63 z=0 강제는 *빈 공간* 에서만 보존
- **L-178-4** Cardinal vs slanted face 구분 — `forceCardinal` flag
- **L-178-5** drift 안전성 = ADR-170/171/168 absorb 인프라 의존
- **L-178-6** Sketch mode 우선 (변경 0)
- **L-178-7** Engine 변경 0 (TS only)
- **L-178-8** 기존 cardinal/sketch 동작 보존 (additive — `forceCardinal: true`
  기본)
- **L-178-9** 절대 #[ignore] 금지

---

## 4. Demo verification (Claude Preview MCP, 2026-06-01)

실제 UI 마우스 — 박스 윗면에 RECT 그리기:

| 검증 | 결과 |
|---|---|
| pick 박스 윗면 (z=200) | faceIndex 7, normal [0,0,1] ✅ |
| resolveFacePlane zeroValue | normal·hitPoint = **200** ✅ |
| RECT face centroid (facesCentroid, 신뢰) | **z=200** ✅ (박스 윗면 위) |
| invariants | valid=true, 0 violations ✅ |

→ **사용자 "rect는 입체면에 작성이 안됌" 완전 해소.** (getFaceVertices 는
broken API — facesCentroid 로 정확 검증.)

---

## 5. 회귀 자산 (절대 #[ignore] 금지)

DrawRectTool.test.ts (+5):
- `face hit (cardinal +Z at z=200) → face plane, zeroValue=200 (NOT ground 0)`
- `no face hit → returns null (→ cardinal ground fallback, LOCKED #63 preserved)`
- `slanted (non-cardinal) face → forceCardinal false`
- `sketch mode → returns null (sketch plane precedence)`
- `degenerate face normal → returns null (no crash)`

vitest: 9 → **14 PASS** (DrawRectTool), tsc 0 errors.

---

## 6. LOCKED #63 amendment (canonical, 누적)

> **LOCKED #63 amendment 2 (ADR-178, 사용자 결재 2026-06-01)**
>
> ADR-175 가 DrawLine (get3DPoint) 을 face-aware 로 만든 데 이어, **DrawRect
> (resolveCardinalPlane)** 도 face-aware 로. LOCKED #63 z=0 강제는 *빈 공간*
> 에서만 보존. 입체면(cardinal/slanted) 위 클릭 시 그 face plane 에 그려짐.
> 모든 Draw 도구 (Line/Rect/Circle/Polygon/Arc/Bezier/Freehand) 가 일관되게
> face-aware. drift 안전성은 ADR-170/171/168 absorb 인프라가 보장.

---

## 7. Out of scope (future)

- 곡면(curved surface) 위 RECT — getFaceNormal 의 chord plane normal (DCEL).
  곡면 tangent plane 정밀 그리기는 future (ADR-140 surface-aware 연장)
- 2nd+ click 의 face plane lock (rect 가 face 밖으로 나갈 때) — 현재 첫 클릭
  face plane 고정 (projectClickToCardinalPlane 이 동일 plane 유지, edge-to-edge
  자연 동작)

---

## 8. Cross-link

- **ADR-175** (LOCKED #75) — get3DPoint face-aware (DrawLine) — 본 ADR 의 직계 패턴
- **LOCKED #63** PR #101 (z=0 invariant — 본 ADR 이 2번째 amendment)
- **ADR-140** surface-aware getDrawPlane (다른 Draw 도구 face-aware source)
- **ADR-170/171/168** absorb 인프라 (drift 해소)
- **ADR-176** (LOCKED #76) — auto-behaviors 기본 ON (RECT split 자연 결합)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical
- **메타-원칙 #4** SSOT (모든 Draw 도구 face-aware 일관) / **#5** 사용자 편의 /
  **#10** ADR 불변 (LOCKED #63 amendment via 결재)
- **LOCKED #44** Complete Meaning per Merge (single atomic PR)
