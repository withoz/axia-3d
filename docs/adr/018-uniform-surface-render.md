# ADR-018: Uniform Surface Render Policy — Open vs Closed Manifold

**Status**: Accepted (🔒 LOCKED, 2026-04-29)
**Supersedes**: ADR-007 Phase 4 의 시각 노출 부분 (Winding 정책 자체는 유지)
**Related**: ADR-007 (Face Orientation Policy), ADR-016 (Conditional B1)

> ⚠️ **DO NOT MODIFY** without explicit user consent.
> 사용자가 명시적으로 거부 또는 변경 요청 전까지 본 ADR 의 결정은
> 모든 후속 세션에서 그대로 유지되어야 합니다 (ADR-014 메타-원칙 #10).

---

## Context

사용자 보고 (2026-04-29): RECT 부분 overlap 시 일부 영역이 라벤더 (BackSide)
색으로 렌더링됨. 진단 결과:

- 토폴로지 / 의미 / 시각 검증: **모든 face 의 winding 일관 (normal +Z)** ✓
- ADR-007 Invariant 2: 위반 0건 ✓
- 그러나 viewport 가 sheet 를 두 톤 (FrontSide white + BackSide lavender) 으로
  분리 렌더 → 카메라 각도에 따라 사용자가 lavender 영역을 봄

**근본 원인**: ADR-007 Phase 4 의 시각 노출 정책. winding violation 가시화
의도였지만, 정상 sheet 도 BackSide 가 노출되어 사용자 혼동.

---

## Decision

### 1. Per-component 시각 분리 정책

```
Open mesh (boundary edges 존재):
  → 모든 face 가 양면 동일 white (#e8e8e8)
  → BackSide 도 frontMat 클론 (FrontSide) 으로 렌더
  → 라벤더 절대 안 보임

Closed solid (closed 2-manifold):
  → 외부 white, 내부 cyan (#9898b4) 두 톤 유지
  → 단면 노출 / cavity 가시화 위한 의도된 차이
```

**판정 driver**: per-face `volumeFlags[fid]`
- `1` (volume member) → wall (두 톤)
- `0` (sheet) → sheet (양면 동일)

`volumeFlags` 미가용 시 fallback: **모두 sheet** (이전 "모두 wall" 의 회귀
원인이었음).

### 2. Dev Toggle — "면 방향 표시"

`Viewport.setShowFaceOrientation(bool)` API.

```
default (false): 위 정책 적용
ON (true):       모든 face 강제 wall (legacy 두 톤 모드 — winding 디버그용)
```

UI: StylePanel 하단 "면 방향 표시 (디버그)" 체크박스 (default OFF).

### 3. ADR-007 Invariant 2 와의 관계

**ADR-007 의 winding 정책 자체는 유지** (변경 없음):
- 모든 face 의 `normal.dot(surface_normal_hint) >= 0`
- post-pipeline degenerate scan + winding flip 그대로
- `verifyInvariants` API 그대로

**변경되는 것은 시각 노출 정책만**:
- 이전: winding 일관 face 도 view 각도 따라 BackSide lavender 보임
- 변경: winding 일관 sheet 는 양면 동일 → lavender 안 보임

→ winding 위반이 발생하면 *실제로* 토폴로지가 깨진 것 (ADR-007 violation).
시각으로는 안 보이지만 `verifyInvariants` 가 잡아냄. dev toggle ON 하면
사용자가 직접 시각 확인 가능.

---

## Implementation

### Code Changes

#### `web/src/viewport/Viewport.ts`

```typescript
// 신규 필드
private _showFaceOrientation = false;

setShowFaceOrientation(enabled: boolean) {
  this._showFaceOrientation = enabled;
}
isShowFaceOrientation(): boolean {
  return this._showFaceOrientation;
}

// updateMesh 안 wall/sheet 분리:
const debugOrientation = this._showFaceOrientation === true;
if (faceMap && volumeFlags) {
  for (let ti = 0; ti < faceMap.length; ti++) {
    const isWall = debugOrientation
      ? true   // legacy 모드 — 모두 wall
      : (fid < volumeFlags.length) && volumeFlags[fid] === 1;
    // ...
  }
} else {
  // ADR-018 fallback — 모두 sheet (이전 "모두 wall" 회귀 수정).
  if (debugOrientation) { /* all wall */ }
  else { /* all sheet */ }
}
```

#### `web/src/ui/StylePanel.ts`

StylePanel 끝에 프로그램매틱 체크박스 주입:
- `#sty-show-face-orient` checkbox
- Description: "ON: 모든 면 양면 다른 색 (winding 가시화). OFF: open mesh
  양면 동일, closed solid 만 두 톤."

### Tests

```typescript
// 신규:
test_open_mesh_uniform_render — 부분 overlap 후 모든 face 가 sheet 분류
test_closed_solid_two_tone     — push/pull 으로 만든 cube 의 face 전부 wall
test_dev_toggle_legacy         — toggle ON 시 모든 face 가 wall

// 회귀 유지:
test_all_rects_have_consistent_winding (ADR-007)
test_two_stacked_inner_rects_both_faced (ADR-016)
```

---

## Trade-offs

### Gained
1. **사용자 UX 개선** — 평면 모델링 시 라벤더 전혀 안 보임
2. **혼동 ↓** — 정상 sheet 가 "뒤집힌 것처럼" 보이지 않음
3. **CAD 표준 정합성** — Onshape, Fusion 360 등 대부분 CAD 도구의 동작과 일치
4. **Dev 디버그 옵션 유지** — toggle ON 시 winding 가시 디버그 가능

### Lost
1. **Winding 시각 단서 상실 (default)** — 사용자가 의도치 않게 face 뒤집어도
   기본 모드에선 시각으로 인식 안 됨
2. **보완**: `verifyInvariants` 자동 호출 + dev toggle 사용

### Future Work
1. **Phase 2 Auto-flip 강화** (별도 ADR-019 후보):
   - 모든 transform/boolean/erase 후 BFS-propagate orient_faces 자동 호출
   - 현재는 post-pipeline 에 per-face winding flip 만 (유지)
2. **시각적 winding violation 알림**: dev toggle OFF 라도 violation 검출 시
   상태바에 작은 경고 아이콘 표시
3. **per-component closed solid 판정**: 현재 per-face volumeFlags 기반 — 더
   robust 한 connected-component 판정으로 개선 여지

---

## Decision Record

### What we decided
1. Open mesh 의 sheet face 양면 동일 (white) — lavender 노출 차단
2. Closed solid 의 wall face 두 톤 유지 — cavity 가시화 의도
3. Dev toggle "면 방향 표시" 제공 — 디버그 모드로 legacy 동작 복원
4. ADR-007 Invariant 2 (winding 정책) 자체는 변경 없음
5. fallback 정책: volumeFlags 미가용 시 모두 sheet (이전 모두 wall 회귀
   수정)

### What we rejected
- **옵션 1 (Uniform 만)**: closed solid 도 양면 white — cavity 시각 단서 손실
- **옵션 2 (Strict auto-flip 만)**: 강제 BFS orient — 광범위 회귀 위험 + 사용자
  의도된 flipped face 도 강제 보정될 수 있음
- 현재 채택: **옵션 3 (Hybrid)** — 사용자 결정 (Q1=3, Q2=동의, Q3=유지)

### Open questions
- Auto-flip 자동 호출 범위 (ADR-019 후보)
- 시각 winding 알림의 UX 위치 (status bar vs toast vs side panel)

---

*Author*: AXiA development (사용자 결정 + Claude 분석) |
*Implementation*: 2026-04-29 (commit hash TBD)
