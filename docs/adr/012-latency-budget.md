# ADR-012 — Latency Budget (지연 예산 시스템)

**Status**: Proposed — 핵심 ADR (프레임 끊김 직접 대응)
**Date**: 2026-04-27
**Axis**: 성능 (UX/메모리에도 직접 영향)
**Related**: ADR-001 (레이어 분리), 기존 Delta Buffer / BVH / Spatial Hash

---

## 컨텍스트

현재 성능 원칙은 명시되어 있다:
- 즉각 반응 > 완전성
- Empty-space draw 시 postprocess 스킵
- smoothNormals 1-frame 연기 (rAF)
- BVH / Spatial Hash / Snap dirty flag

그러나 **언제 budget이 초과되었는지** 판단할 수 있는 *기준*이 없고, 측정 인프라도 부재하다. 결과적으로:

1. 복잡한 모델에서 **어느 단계가 budget을 깼는지** 디버그 불가
2. rAF 연기 항목이 늘어나면서 **frame chain (rAF → rAF → rAF)** 발생 가능
3. WASM ↔ JS 경계 비용이 회계되지 않음

**가장 자주 마주치는 문제 — 복잡한 모델에서 프레임 끊김** 의 직접적 원인이다.

## 결정

### 1. Latency Budget 정의

| 단계 | 예산 | 정의 | 위반 시 동작 |
|---|---|---|---|
| **Hover** | ≤ 16 ms | 마우스 이동 → 피드백 (snap, highlight) | 즉시 단순화 (low-LOD picking) |
| **Click** | ≤ 33 ms | 클릭 → 시각 변화 시작 (preview ghost) | preview 단순화 |
| **Commit** | ≤ 100 ms | 도구 commit → 토폴로지 반영 | progress UI 표시 |
| **Heavy** | ≤ 500 ms | Boolean / large import / batch | progress + cancellable |

위반은 **에러가 아니라 신호**다. 즉, 위반 자체가 ADR-012의 강등(degradation) 트리거가 된다.

### 2. FrameScheduler — rAF 체인 방지

**규칙**: 한 사용자 입력에 대해 rAF 큐에 들어갈 수 있는 작업은 **최대 1개**.

```
class FrameScheduler {
    private pending: Map<TaskKey, Task> = new Map();

    schedule(key: TaskKey, task: Task) {
        if (this.pending.has(key)) {
            // merge or discard
            this.pending.set(key, mergeTask(this.pending.get(key), task));
            return;
        }
        this.pending.set(key, task);
        requestAnimationFrame(() => this.flush(key));
    }

    private flush(key: TaskKey) {
        const task = this.pending.get(key);
        this.pending.delete(key);
        const t0 = performance.now();
        task.run();
        const elapsed = performance.now() - t0;
        if (elapsed > task.budget) {
            telemetry.recordBudgetViolation(key, elapsed, task.budget);
        }
    }
}
```

**TaskKey 예**: `smoothNormals`, `snapRebuild`, `bvhRebuild`, `meshRefresh`. 동일 key는 frame당 1회 수행.

### 3. WASM Boundary Accounting

JS ↔ Rust 경계는 비용이 크다. 측정·제한:

```
규칙:
- 1 Command = 1 crossing (입력) + 1 crossing (mesh 결과) = 최대 2회
- Preview는 JS-only (crossing 0)
- Batch 가능한 Command는 BatchCommand로 묶기
  · RECT = 4 LINE → 1 BatchCommand (1회 crossing)
  · CIRCLE = N LINEs → 1 BatchCommand
  · POLYGON = N LINEs → 1 BatchCommand
- 1 frame 내 crossing 수 > 4 → 경고 (telemetry)
```

ADR-008 #2 ("RECT = 4 LINEs, atomic-add 안 함")는 *내부 토폴로지* 관점이고, BatchCommand는 *경계 비용* 관점이다 — 충돌하지 않는다.

### 4. Picking Router — 단일 진입점

현재 BVH / Spatial Hash / Snap dirty flag가 각자 잘 동작하지만 *언제 무엇을 쓰는지* 결정 트리가 없다.

```
PickingRouter.route(query) {
    switch (query.type) {
        case 'vertex_endpoint': return spatialHash.query(query);
        case 'edge_nearest':    return spatialHash.query(query);
        case 'face_hit':        return bvh.intersect(query);
        case 'snap_candidates': return snapCache.get(query) ?? rebuildSnap();
        case 'transform_only':  return deltaBuffer.apply(query);
    }
}
```

호출자는 자료구조를 알 필요 없음. Router가 latency budget도 모니터한다.

### 5. Telemetry Layer

```
window.__AXIA_TELEMETRY = {
    budgetViolations: [...],
    avgFrameTime: number,
    crossingsPerFrame: number,
    largestTask: { key, ms, ts },
    rafChainDepth: number,  // 항상 ≤ 1 보장
};
```

`window.__AXIA_DEBUG=true`로 활성화. 평소엔 비활성 (zero overhead).

## 결과

**긍정**
- 프레임 끊김의 *원인*을 telemetry로 즉시 추적 가능
- rAF 체인 깊이 ≥ 2 가 *불가능*해짐 (구조적 보장)
- WASM 경계 비용이 가시화됨 → 최적화 우선순위 결정 가능
- BatchCommand 도입으로 RECT/CIRCLE의 경계 crossing 1/N

**부정**
- FrameScheduler 도입은 기존 rAF 호출부를 모두 수정해야 함 (1회성 마이그레이션 비용)
- Telemetry는 비활성 시에도 hook 코드는 남음 (~1KB 코드 증가, runtime 비용 0)

## 위반 처리 정책 (Degradation)

Budget 위반 시 **자동 강등**:

| 위반 단계 | 1차 강등 | 2차 강등 (반복 위반) |
|---|---|---|
| Hover 16ms 초과 | snap candidate cap 200 → 50 | low-LOD picking으로 전환 |
| Click 33ms 초과 | preview 단순화 (와이어프레임) | preview 비활성, commit-only |
| Commit 100ms 초과 | progress UI 표시 | Worker thread offload (defer 항목 활성) |
| Heavy 500ms 초과 | progress + cancellable | 작업 분할 제안 |

## 검증

1. 1만 face 모델에서 hover 시 16ms 유지 (현재 측정 필요)
2. rAF 체인 깊이 측정 → 항상 ≤ 1
3. RECT 그리기 → WASM crossing 정확히 1회
4. Budget 위반 시 telemetry 기록 + 자동 강등 발동

## 대안 (Alternatives)

- **소프트 임계값 (warn-only)**: 위반 발생 시 console 만 기록, 강등 X. 측정만 가능, 사용자 체감 개선 안 됨. 보완책 (강등) 없으면 의미 약함.
- **Worker thread 무조건 사용**: 모든 heavy 작업을 Worker로. WASM 모듈 공유 비용 + IPC 오버헤드로 대부분 케이스에서 손해. 강등 trigger 가 있을 때만 활성하는 게 옳음.
- **GPU compute 활용**: BVH 빌드 등을 GPU 로. 이식성 ↓, 디버그 ↓. defer.

## 재검토 트리거 (When to Revisit)

- 평균 frame time 이 budget 의 80% 초과 상태가 일주일 이상 지속
- BatchCommand 가 도입됐는데 crossing/frame 이 4 초과 잔존
- WASM heap 크기가 100MB 초과 → ADR-013 hard limit 충돌

## 관련 기록 (Related)

- ADR-008 #2 (RECT = 4 LINEs) — *내부 토폴로지* 관점 vs ADR-012 *경계 비용* 관점, 충돌 X
- 기존 Delta Buffer / BVH / Spatial Hash — Picking Router 가 통합 진입점
- 메타-원칙 #6, #8, #11
- ADR-013 — 메모리 압박이 budget 위반 원인일 때

## 메타-원칙 매핑

- #6 Preventive over Curative — budget 위반을 *사전*에 감지
- #8 즉각 반응 > 완전성 — budget이 그 정량적 정의
- #11 (신규) Latency Budget First
- #4 SSOT — Picking 결정의 단일 라우터
