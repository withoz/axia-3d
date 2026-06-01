# ADR-182 — Plane Lock Scope = In-Progress Multi-Click Only (axia-sketch D102 답습)

**Status**: Accepted (demo-verified 2026-06-01 — 새 draw 가 stale lock 무시하고
커서 아래 입체면 재검출)
**Date**: 2026-06-01
**Author**: WYKO + Claude
**Trigger**: 사용자 결재 2026-06-01:
> "입체면을 자동으로 못찾는것이 문제입니다."
> "E:\axia-sketch 이엔진에서 면에 그리는 루틴을 찾아서 우리 엔진과 비교해주세요."
> (비교 후) "axia-sketch 의 D102 패턴 답습 ... 새 draw 시작 시엔 면을 다시
> 찾도록 ... 로 승인합니다"
**Direct precursors**: ADR-166 (LOCKED #67, plane lock), ADR-181 (getDrawPlane
SSOT), ADR-164 (sticky), ADR-140 (surface-aware getDrawPlane).
**Reference engine**: `E:\axia-sketch` (같은 작가의 Rust-native sketch→solid).

---

## 1. Problem statement

DrawRect/Circle 등으로 **둘째 도형부터** 입체면에 그릴 때, 엔진이 커서 아래
입체면을 자동으로 찾지 못하고 직전 plane(또는 ground)에 그려졌다.

근본 원인 (axia-sketch 비교로 확정):

| | axia-sketch | 우리 엔진 (변경 전) |
|---|---|---|
| Face pick 시점 | **매 draw 첫 클릭마다** fresh `ray_pick` | lock 유지 시 재pick 안 함 |
| Lock scope | **per-draw** (tool idle 시 자동 unlock, D102) | **cross-tool 영구** (ADR-166) |
| Face pick 우선순위 | lock 다음 최우선 | lock → sketch → view default → face hit |

우리 ADR-166 plane lock 은 cross-tool 영구라서, 첫 draw 가 lock 을 걸면 둘째
draw 의 첫 클릭에서 `getDrawPlane` 이 그 lock 을 반환 (onFace:false) → 커서가
다른 입체면 위에 있어도 그 면을 *재검출하지 않음*. axia-sketch 는 매 draw 첫
클릭에서 lock 을 비우고 `ray_pick` 으로 면을 다시 찾는다 (Auto-Plane Pick
D80/D85 + D102 unlock).

### axia-sketch 루틴 (`crates/axia-app/src/main.rs:987-1107`)

```
MouseInput::Pressed (draw tool):
  1. tool idle + lock 존재 → unlock              ★ D102: stale lock 제거
  2. lock 있으면 → locked_plane + 커서 재투영      (in-progress multi-click)
  3. lock 없으면 → scene.ray_pick(전 XIA 삼각형)   ★ 면 자동 검출
       → snap_to_canonical_plane (drift 보정, D104)
       → active_plane = 그 면의 plane
  5. 클릭 후: in_progress → lock / commit → unlock
```

---

## 2. Solution — Lock scope 를 in-progress multi-click 으로 한정

axia-sketch D102 답습. ADR-166 의 "cross-tool 영구 유지"를 **진행 중
multi-click 의 corner 일관성**으로 scope 축소.

### 변경 1 — `getDrawPlane`: lock 은 busy 일 때만 honor

```ts
// ADR-182: lock 은 in-progress multi-click(busy) 일 때만 적용. idle(새 draw
// 첫 클릭 / hover)은 lock 무시 → 아래 face hit logic 으로 fresh face pick.
if (this._planeLock && this.isToolBusy()) {  // ← && this.isToolBusy() 추가
  ... 기존 lock branch (auto-unlock-on-different-plane 포함) ...
}
```

### 변경 2 — mousedown 핸들러: 새 draw 첫 클릭(idle)에 물리적 unlock

```ts
// ADR-182 (axia-sketch main.rs:999 답습) — 새 draw 첫 클릭(draw tool idle)에
// stale lock 물리 해제 → tool 의 first_click 이 fresh lock 을 set 하도록.
if (this._planeLock
    && ToolManager.DRAW_PLANE_TOOLS.has(this._currentTool)
    && !this.isToolBusy()) {
  this.unlockPlane();
}
```

두 변경의 협력:
- **새 draw 첫 클릭(idle)**: 변경 2 가 stale lock 물리 해제 → 변경 1 의 idle
  branch 도 무관하게 face hit → fresh pick → onFace:true → tool first_click 이
  fresh lock set.
- **진행 중 둘째 클릭(busy)**: 변경 1 이 lock honor → 같은 plane 으로 corner 일관.
- **commit 후 hover(idle)**: 변경 1 이 lock bypass → 커서 아래 면 face-aware hover.

### 보존 — cross-draw 평면 연속성은 sticky(ADR-164)가 담당

빈 공간에서 새 draw 시작 시 (커서 아래 면 없음) → fresh pick 실패 → ADR-164
sticky(직전 그린 plane)로 fallback → "같은 평면 반복 그리기" 연속성 유지.
즉 **면 위 = fresh face pick / 빈 공간 = sticky 연속성** 둘 다 성립.

---

## 3. Lock-ins

- **L-182-1** Lock scope = in-progress multi-click only (axia-sketch D102).
- **L-182-2** `getDrawPlane` 의 lock branch 는 `isToolBusy()` 일 때만 실행.
- **L-182-3** mousedown 핸들러가 새 draw 첫 클릭(draw tool idle + locked)에
  `unlockPlane()` → fresh face pick.
- **L-182-4** Cross-draw 평면 연속성은 sticky(ADR-164)가 담당 (빈 공간 fallback).
- **L-182-5** 진행 중 multi-click 의 corner 일관성(ADR-166 핵심 가치) 보존.
- **L-182-6** ADR-181 getDrawPlane SSOT 위에 동작 (DrawRect/Circle 동일 경로).
- **L-182-7** Engine 변경 0 (TS only). axia-sketch 의 engine ray_pick 동등성은
  별도 트랙 (현재는 Three.js viewport.pick 유지).
- **L-182-8** 절대 #[ignore] 금지.

---

## 4. LOCKED #67 ADR-166 amendment (scope 축소)

ADR-166 의 "cross-tool 영구 유지" → **in-progress multi-click only** 로 scope
축소. 사용자 결재 2026-06-01. ADR-166 의 다른 lock-in (first_click trigger /
명시 unlock path / sticky coexist / badge) 은 불변. 메타-원칙 #10 정합 (LOCKED
정책 변경 = 새 ADR + 사용자 결재).

회귀 영향: ADR-166 β-3 의 lock-honoring 테스트 3건은 `isToolBusy()=true`
(in-progress) 로 갱신 — lock 이 이제 busy 일 때만 적용됨을 명시.

---

## 5. Demo verification (Claude Preview MCP, 2026-06-01, real Chromium)

| 검증 | 결과 |
|---|---|
| rect #1 on +X wall 후 idle probe 같은 +X 면 | onFace **true** (이전 false) ✅ |
| rect #1 후 idle probe +Z top 면 | onFace **true**, normal +Z (면 재검출) ✅ |
| rect #1 (+X wall) → rect #2 (+Z top) end-to-end | rect #2 **top 면에 landed** (z=200 +8 verts) ✅ |
| 진행 중 multi-click (busy) lock honor | lock plane 유지 (corner 일관) ✅ |

→ stale lock 이 더 이상 면 재검출을 막지 않음 — 매 새 draw 가 커서 아래
입체면을 자동으로 찾음 (axia-sketch Auto-Plane Pick 동등).

---

## 6. 회귀 자산 (절대 #[ignore] 금지)

`ToolManagerRefactored.test.ts` — ADR-182 신규 4 + ADR-166 β-3 갱신 3:
- `adr182_idle_drawtool_bypasses_lock_fresh_face_pick` (idle → 면 재검출)
- `adr182_busy_drawtool_honors_lock` (busy → lock 유지)
- `adr182_mousedown_idle_drawtool_releases_lock` (새 draw 첫 클릭 unlock, D102)
- `adr182_mousedown_nondraw_tool_keeps_lock` (select 등 lock 보존)
- (갱신) `adr166_hotfix_soft_lock_auto_releases_on_different_plane_face_hit`
  / `..._lock_preserved_when_face_hit_same_plane` / `..._anti_parallel_...`
  → `isToolBusy()=true` (in-progress)

vitest: 2082 → **2086 PASS** / 1 skipped, tsc 0 errors.

---

## 7. Cross-link

- **ADR-166** (LOCKED #67) — plane lock (scope 축소 amendment, §4)
- **ADR-181** — getDrawPlane SSOT (본 ADR 의 base, DrawRect/Circle 동일 경로)
- **ADR-164** — sticky last drawn plane (cross-draw 연속성 담당)
- **ADR-140** — surface-aware getDrawPlane (face hit source)
- **axia-sketch** `main.rs:987-1107` (Auto-Plane Pick D80/D85 + D102 unlock),
  `:251` snap_to_canonical_plane (D104, our ADR-168 동등),
  `axia-xia/scene.rs:757` ray_pick, `docs/same_plane_strategy.html`
- **메타-원칙 #4** SSOT / **#5** 사용자 편의 (명확하면 자동) / **#10** ADR 불변
- **ADR-087 K-ζ** 사용자 시연 게이트 / **LOCKED #44** Complete Meaning per Merge
- **LOCKED #67** ADR-166 (scope 축소 대상)

---

## 8. Out of scope (future)

- **Engine ray_pick 동등성** — axia-sketch 는 engine 에서 전 삼각형 brute-force
  pick (deterministic). 우리는 Three.js BVH viewport.pick. BVH miss 시 신뢰성
  개선은 별도 트랙 (현재는 sticky fallback 으로 흡수).
- **Grazing 면 projection 안정화** (ADR-181 후속 논의 — 사용자 보류) — 별도.
- **snap_to_canonical_plane 의 draw 시점 적용** (우리 ADR-168 은 face creation
  시만) — 별도 트랙.
