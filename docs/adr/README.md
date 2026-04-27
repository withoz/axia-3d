# Architecture Decision Records (ADR)

이 디렉토리는 AXiA 3D 엔진의 주요 설계 결정을 기록합니다.

## 목적
- 왜 그 결정을 내렸는지 **맥락과 근거**를 남겨, 미래의 재검토 시 배경을 잃지 않기 위함
- 설계 원칙에 예외가 생기는 경우, 그 이유를 추적 가능하게 함
- 신규 기여자가 "왜 이렇게 되어 있나?"를 빠르게 파악

## 포맷

각 ADR은 다음 구조를 따릅니다:

- **Status** — Proposed / Accepted / Superseded / Deprecated
- **Date** — 결정 시점
- **Context (맥락)** — 왜 이 결정이 필요했는가
- **Decision (결정)** — 무엇을 선택했는가
- **Rationale (근거)** — 왜 그것을 선택했는가
- **Consequences (결과)** — 긍정/부정적 파생 효과
- **Alternatives (대안)** — 고려했지만 선택하지 않은 것들
- **When to Revisit (재검토 트리거)** — 재검토가 필요해지는 조건
- **Related (관련 기록)** — 다른 ADR / 커밋 / 이슈

## 색인

| # | 제목 | 축 | 상태 |
|---|------|-----|------|
| [001](./001-geometry-semantic-layer-separation.md) | Geometry/Semantic 레이어 분리 | 아키텍처 | Accepted |
| [002](./002-xia-state-from-face-count.md) | XIA 상태는 면 개수로 계산 | 아키텍처 | Accepted |
| [003](./003-geometric-validity-principle.md) | Geometric Validity (Degenerate 사전 차단) | 안정성 | Accepted |
| [004](./004-xia-level-stable-id.md) | 안정 ID는 XIA-level만 (Face GUID 금지) | 아키텍처 | Accepted |
| [005](./005-coplanar-merge-purely-geometric.md) | Coplanar Merge는 순수 기하 연산 | 일관성 | Accepted |
| [006](./006-face-merge-future-work.md) | Face Merge 미지원 케이스 명시 | 범위 | Accepted |
| [007](./007-face-orientation-policy.md) | Face Orientation Policy (Rev 2, 7원칙) | 토폴로지 | Accepted |
| [008](./008-face-operation-axioms.md) | Face Operation Axioms (9개) | 토폴로지 | Accepted |
| [009](./009-orphan-face-recovery.md) | Orphan Face Recovery (Smart Auto) | UX | Accepted |
| [010](./010-inference-resolution.md) | Inference Resolution Table (스냅 충돌 해결) | UX | **Proposed** |
| [011](./011-tool-inertia.md) | Tool Inertia & Predictive Switch | UX | **Proposed** |
| [012](./012-latency-budget.md) | Latency Budget (지연 예산) ⭐ | 성능 | **Proposed** P1 |
| [013](./013-memory-budget.md) | Memory Budget & Bounded Collections ⭐ | 메모리 | **Proposed** P1 |
| [014](./014-meta-principles-extension.md) | 메타-원칙 확장 (#11~#13) | 메타 | **Proposed** P0 |

## ADR-010 ~ ADR-014 시리즈 — 프레임 끊김 대응

복잡한 모델에서 프레임 끊김의 근본 원인은 **단일 축 문제가 아니다**:
- UX 이벤트 폭주 (snap 충돌, 도구 전환 마찰)
- 성능 (rAF chain, WASM crossing 비용)
- 메모리 (GC 압박, unbounded cache)

이 세 축의 교차점을 시리즈 5개로 분할 정리:

```
ADR-014 (메타-원칙 확장)  ─── 먼저 통과
    ↓
    ├─→ ADR-012 (Latency Budget)  ─── 메타-원칙 #11 구현 ⭐
    │       ↓
    │       └─→ ADR-013 (Memory Budget) ── #12, #13 구현 ⭐
    │               ↓
    │               └─→ ADR-010 (Inference) ── budget 안에서 동작
    │
    └─→ ADR-011 (Tool Inertia)  ─── 독립, UX 개선
```

### 구현 로드맵 (6 Sprint, 12주)

| Sprint | 기간 | ADR | 산출물 | 위험 |
|---|---|---|---|---|
| 1 | 2주 | ADR-014 통과 + ADR-012 telemetry 인프라 | `__AXIA_TELEMETRY` 활성화 | 낮 |
| 2 | 2주 | ADR-012 FrameScheduler + PickingRouter | rAF 체인 깊이 ≤ 1 | 중 |
| 3 | 2주 | ADR-012 BatchCommand + WASM accounting | RECT/CIRCLE 1-crossing | 중 |
| 4 | 2주 | ADR-013 Memory Budget + Bounded Collections | LRU eviction 동작 | **높** (zero-copy 검증) |
| 5 | 2주 | ADR-013 LOD Strategy | LOD 0~3 전환 동작 | 중 |
| 6 | 2주 | ADR-010, ADR-011 UX 보강 + 통합 회귀 | tie-breaker, tool inertia | 낮 |

### "프레임 끊김" 추적 절차 (시리즈 통과 후)

```
1. window.__AXIA_DEBUG = true
2. 문제 재현
3. window.__AXIA_TELEMETRY 확인:
   - budgetViolations[] 에 어느 단계가 깨졌는지
   - largestTask 가 어떤 작업이었는지
   - rafChainDepth 가 1 초과면 FrameScheduler 버그
   - crossingsPerFrame 이 4 초과면 WASM 경계 비용
4. window.__AXIA_MEMORY 확인:
   - budget_used_pct > 80% 면 메모리 압박이 원인
   - 영역별 식별 (geometry, BVH, snap, history, undo)
5. 원인에 따라 강등 정책 자동 발동 또는 수동 조치
```

## 메타-원칙 (#1~#13)

| # | 원칙 | 축 | 출처 |
|---|------|-----|------|
| 1 | 기존 명령은 모두 그대로 | 호환 | 세션 |
| 2 | 외부 참조는 형태/모양만 | 호환 | 세션 |
| 3 | 상태바는 보호 | UX | 세션 |
| 4 | 단일 진실 원천 (SSOT) | 일관성 | ADR-001 일반화 |
| 5 | 사용자 편의 최우선 | UX | ADR-009 |
| 6 | Preventive over Curative | 안정성 | ADR-003 |
| 7 | Topology > Cache | 일관성 | ADR-007 원칙 3 |
| 8 | 즉각 반응 > 완전성 | UX/성능 | 세션 |
| 9 | 회귀 없음 | 품질 | 세션 |
| 10 | ADR 불변 | 거버넌스 | README |
| **11** | **Latency Budget First** | **성능** | **ADR-014** |
| **12** | **Memory Budget Per Entity** | **메모리** | **ADR-014** |
| **13** | **One Source, Two Views** | **메모리/일관성** | **ADR-014** |

## 변경 규칙

- 기존 ADR을 **수정하지 않음**. 설계가 바뀌면 새 ADR을 작성하고 이전 것을 `Superseded`로 표시.
- ADR 번호는 단조 증가. 결번 없음.
- 모든 ADR은 `docs/adr/` 한 곳에서만 관리 (예전엔 008/009 가 docs/ 에 있었으나 통합됨).

## Defer 항목 (명시적으로 보류)

- Worker thread offload — ADR-012 강등 정책에 따라 *필요 시* 활성
- GPU picking — BVH 로 충분, 추후 검토
- IndexedDB telemetry 영속화 — 메모리 ring buffer 로 충분
- Parametric History Phase 3 (downstream 자동 재계산) — 별도 ADR 예정
- STEP/IGES 전체 import — OCCT.js 10MB+ 번들 검토 필요
- Boundary Extraction (Solid → Face)
- Electron/Tauri 데스크톱 앱
