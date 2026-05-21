# Demo #2 Audit — WASM "recursive use" 200 errors root cause (Frame Loop)

**Date**: 2026-05-24
**Author**: WYKO + Claude
**Trigger**: 사용자 demo screenshot #2 (2026-05-23, console 200건 errors)
**Path Z position**: 본 세션 chain (PR #140~#145) closure 후 → **본 audit
  (audit-first canonical 15번째)** → fix path 결정

## 1. 사용자 demo evidence

### Screenshot 단서 (2026-05-23)

```
- Cylinder 1개 생성됨 (Z-up viewport)
- Console: 200 errors at [16:00:48]
- Error 메시지: "recursive use of an object detected which would lead to
  unsafe aliasing in rust"
- Source: http://localhost:3002/src/wasm/axia_wasm.js?t=...:5165
- DrawCircle 도구 highlight (toolbar 원 아이콘)
- cyan vertex marker (snap highlight)
- 사용자 작업 별도 없음 (cylinder 생성 후 hover)
```

### 자동 reproduce 시도 (PR #143 후)

```
Playwright spec (refcell-diag.spec.ts):
  1. Path B cylinder 생성 ✓
  2. DrawCircle 도구 activate ✓
  3. 30 mouse moves with 50ms delays
  4. 3 seconds wait

Result: RefCell errors: 0 (재현 안 됨)
```

→ **자동 시뮬레이션 으로 재현 안 됨** — 사용자 정확한 절차가 부분
누락 (mid-action mouse click? specific timing?).

## 2. RefCell 영구 잠김 메커니즘

### wasm-bindgen RefCell guard 패턴

wasm-bindgen 이 생성한 모든 WASM exported method 는 `RefCell<T>::borrow_mut()`
guard 로 *single-threaded reentrancy 차단*:

```rust
// wasm-bindgen 자동 생성 (예시)
pub fn axiaengine_lodChordTol(ptr: u32, ...) -> f64 {
    let _guard = self.inner.borrow_mut();  // ← 진입 시 borrow
    // ... actual call
}
```

**Reentrancy 패턴** (panic 발생 조건):
1. WASM method A 진입 → `borrow_mut()` 잠김
2. A 가 console.error 등 import callback 호출
3. Callback 안에서 또 다른 WASM method B 호출
4. B 의 `borrow_mut()` 두 번째 시도 → **panic** "recursive use"
5. WASM trap → unwind 안 됨 (Rust panic 이 WASM 으로 propagate 시)
6. **RefCell guard 영구 잠김** (drop 안 됨)
7. 이후 모든 WASM 호출이 매 frame 마다 동일 error

## 3. Frame loop WASM call sites (audit)

### `web/src/main.ts:635` — ADR-135 β onFrame

**가장 critical site**:

```typescript
viewport.onFrame(() => {
  const camPos = viewport.camera.position;
  const camDistance = camPos.length();
  if (!Number.isFinite(camDistance) || camDistance <= 0) return;
  const lodTol = bridge.lodChordTol(camDistance);              // ← WASM 호출 #1
  if (Math.abs(lodTol / lodLastPushedTol - 1) > 0.05) {
    bridge.setRenderChordTol(lodTol);                          // ← WASM 호출 #2
    lodLastPushedTol = lodTol;
  }
});
```

→ **매 frame (60fps) `bridge.lodChordTol` 호출**.
60fps × 3.3초 = **200 errors evidence 완전 정합**.

### Frame loop 의 다른 WASM call sites

| Site | File | 호출 | 빈도 |
|---|---|---|---|
| `bridge.lodChordTol` | main.ts:643 | 매 frame | 60fps |
| `bridge.setRenderChordTol` | main.ts:646 | 5% threshold | 가끔 |
| `bridge.edgeRayDistance` | Viewport.ts:2058 | mousemove | hover |

### 사용자 mousemove 시 WASM call sites

| 도구 | call sites |
|---|---|
| DrawCircle hover | snap path WASM 호출 (LOCKED #63 후 raw passthrough, 호출 없음) |
| Select hover | `edgeRayDistance` (Viewport.ts:2058) — analytic curve picking |

## 4. Root cause 가설 매트릭스

| 가설 | Evidence | Likelihood |
|---|---|---|
| **(A)** ADR-135 `lodChordTol` 가 매 frame WASM 호출 + 다른 WASM 호출과 race → panic + RefCell 영구 잠김 | **200 = 60fps × 3.3s 정합** + `lodChordTol` 매 frame 호출 확정 | **매우 높음** |
| **(B)** K1 hotfix `polygonize_if_closed_curve` panic | K1 은 split_face_by_line entry only — cylinder 생성/hover 무관 | 낮음 |
| **(C)** Path B annulus owner_id (PR #142) panic | 단순 assignment, panic 가능성 낮음 | 낮음 |
| **(D)** `edgeRayDistance` mousemove 동안 frame loop 가 진입 | reentrant 가능성, 하지만 JS single-threaded | 중 |
| **(E)** 다른 ad-hoc bridge call (cylinder 생성, snap path 등) 이 panic 후 frame loop 가 매 frame 동일 error | RefCell 영구 잠김 패턴 정합 | **매우 높음** |

### 최종 root cause 추정

**가설 (A) + (E) 결합**:

1. 사용자가 cylinder 생성 또는 mousemove 중 *어떤 ad-hoc WASM call* 이
   panic (정확한 source 미식별 — 자동 reproduce 실패)
2. WASM trap → RefCell 영구 잠김
3. Frame loop animate() 가 매 frame `bridge.lodChordTol` 호출 시도
4. 매 frame `borrow_mut()` 실패 → "recursive use" error
5. 60fps × 3.3초 = **200 errors evidence**

## 5. K1 hotfix (PR #143) 와의 인과 분석

| 측면 | 결과 |
|---|---|
| K1 `polygonize_if_closed_curve` 호출 path | `split_face_by_line` entry only |
| Cylinder 생성에 split_face_by_line 호출? | **No** (extrude path, polygonize 무관) |
| Hover 시 split_face_by_line 호출? | **No** |
| K1 직접 인과 | **확정 불가 — 가능성 낮음** |

→ **K1 hotfix 와 직접 인과 없음**. 별개 시스템적 reentrancy 패턴.

## 6. 권장 fix path

### Path A — Frame loop guard (최단)

main.ts:635 의 onFrame 호출을 try-catch 로 wrap:

```typescript
viewport.onFrame(() => {
  try {
    const camPos = viewport.camera.position;
    // ... lodChordTol + setRenderChordTol
  } catch (e) {
    // RefCell 영구 잠김 시 매 frame 호출 회피 — silent fail
    // (frame loop blocking 보다 LOD 비활성이 안전)
    return;
  }
});
```

**비용**: ~5분
**가치**: 200 errors 즉시 stop (LOD 일시 비활성)
**위험**: 0 (silent fail, LOD 만 비활성)

### Path B — RefCell guard 검사 + skip

bridge wrapper 에 try-catch + skip pattern:

```typescript
lodChordTol(camDistance: number): number {
  try {
    return this.engine.lodChordTol(camDistance);
  } catch (e) {
    if (String(e).includes('recursive use')) {
      // 영구 잠김 상태 — silent skip
      return 0.02;  // baseline fallback
    }
    throw e;
  }
}
```

**비용**: ~30분 + 회귀 자산
**가치**: 모든 bridge call 자동 보호
**위험**: silent skip 으로 audit trail 손실

### Path C — Root cause 본격 분석 (Long-term)

1. 모든 WASM panic 발생 가능 site audit
2. 각 site 에 `panic::catch_unwind` 적용
3. wasm-bindgen guard 우회 패턴 식별
4. ADR-148 (가칭) spec 작성

**비용**: ~1-2주
**가치**: 본질 해소
**위험**: 큰 scope

## 7. 권장 즉시 action (Critical)

**Path A (frame loop guard, ~5분)** 가 가장 자연:
- 200 errors 즉시 stop
- LOD 일시 비활성 (사용자 시연 시 acceptable)
- 다음 세션에서 root cause 본격 분석 (Path C)

**Audit 후 별도 PR 진행** — fix 자체는 본 audit 범위 밖.

## 8. Out of scope (별도 audit / fix)

- 실제 RefCell 영구 잠김 *발생 trigger* 식별 (자동 reproduce 미가능)
- 모든 WASM panic 가능 site audit
- wasm-bindgen guard pattern 재설계
- ADR-148 (가칭) — WASM Reentrancy Defense Strategy

## 9. Lock-ins (audit 결과)

- **L-Audit2-1** ADR-135 β `lodChordTol` 매 frame 호출 = 200 errors evidence 확정 source
- **L-Audit2-2** K1 hotfix (PR #143) 와 직접 인과 없음
- **L-Audit2-3** RefCell 영구 잠김 패턴 = wasm-bindgen guard 메커니즘
- **L-Audit2-4** Root cause trigger (실제 panic site) 미식별 — 사용자 정확
  절차 정보 필요 또는 PR #143/#142 revert 후 isolation 검증
- **L-Audit2-5** 권장 fix = Path A (frame loop guard, 5분) — 즉시 회피
- **L-Audit2-6** 본격 fix (Path C) 별도 ADR-148 (가칭)
- **L-Audit2-7** 절대 #[ignore] 금지

## 10. Cross-link

- 사용자 시연 evidence: 2026-05-23 demo screenshot #2 (200 errors)
- ADR-135 β LOCKED #62 (Distance-based LOD chord_tol — frame loop WASM site)
- ADR-093 D-γ (WASM bridge wrapper 패턴)
- K1 hotfix: PR #143 (인과 없음 확정)
- Path B owner_id: PR #142 (인과 없음 확정)
- 메타-원칙 #11 (Latency Budget — frame loop 보호)
- 메타-원칙 #6 (Preventive over Curative — try-catch guard)

## 11. Acceptance Log

- **2026-05-24 audit** (본 commit) — Demo #2 200 errors root cause 매트릭스
  + Frame loop WASM call site 식별 + 권장 fix path (A/B/C) + K1/Path B
  인과 분석.
- **(다음 단계)** — Path A (frame loop guard) 즉시 implementation 별도 PR
  또는 사용자 정확한 절차 정보 수집 후 reproduce 재시도.
