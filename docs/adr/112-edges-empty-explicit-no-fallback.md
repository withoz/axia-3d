# ADR-112 — Edges Empty 명시 처리, EdgesGeometry Fallback Null Only (β-c)

- **Status**: Accepted (2026-05-17)
- **사용자 결재**: 매트릭스 audit + lettered options 결재 패턴. 옵션
  **β-c (β-a + β-b 묶음)** 채택 — LOCKED #44 "Complete Meaning per
  Merge" 정합, single PR 으로 의미 단위 완결.
- **Trigger**: ADR-111 α (BVH defer) closure 후 사용자 결재 ζ
  (α 시연 + β audit) 의 β audit 결과. ADR-111 가 BVH 145ms 흡수 후,
  *다음* 가장 큰 비용 = `updateMesh.edges` EdgesGeometry fallback —
  5-sphere scene 기준 **584 ms** (1M tris 기준 ~3000ms). 메타-원칙
  #11 Heavy 500ms budget 초과.

---

## 1. Canonical Statement

```
engine.get_edge_lines() 의 명시 empty 결과 (smooth-group hide 의 의도된
결과, LOCKED #40 §L7) 가 EdgesGeometry fallback (584ms @ 5-sphere) 으로
잘못 라우팅되는 회귀 차단. 3-way fallback policy:

  edgeLines === null         → engine 미사용 (legacy WASM / mock /
                               throw) → EdgesGeometry fallback
  edgeLines.length > 0       → engine 가시 edges → DCEL render
  edgeLines.length === 0     → engine 명시 empty (smooth-group hide) →
                               edges 없이 정상 paint. fallback 호출
                               금지.

LOCKED #40 §L7 의 architectural decision (smooth-group hide) 이 시각
layer 까지 명시적으로 전달. engine 의 의도된 empty 결과를 cache 단계의
null-coalesce 으로 폐기하던 회귀 차단.
```

## 2. 측정 매트릭스

### 2.1 Before β-c (ADR-111 α 만 적용)

sphere-only scene, sphere count 별 edges fallback cost:

| Spheres | tris | edgesMs | totalSyncMs | edgeLinesNull |
|---|---|---|---|---|
| 1 | 32K | 78 ms | 90 ms | true |
| 2 | 64K | 287 ms | 305 ms | true |
| 3 | 96K | 310 ms | 333 ms | true |
| 4 | 129K | 461 ms | 489 ms | true |
| **5** | 161K | **584 ms** | **713 ms** | true |

**Scaling**: ~3.6 ms per 1K tris (linear with triangle count).
5-sphere 부터 Heavy 500ms budget 위반.

### 2.2 After β-c

| Spheres | tris | edgesMs | totalSyncMs | edgeLinesEmpty |
|---|---|---|---|---|
| 1 | 32K | **0 ms** | **12 ms** | true |
| 2 | 64K | **0 ms** | **15 ms** | true |
| 3 | 96K | **0 ms** | **22 ms** | true |
| 4 | 129K | **0 ms** | **31 ms** | true |
| 5 | 161K | **0 ms** | **35 ms** | true |

**→ 20× faster syncMesh** (5-sphere 713ms → 35ms). 메타-원칙 #11
syncMesh 33ms budget 거의 도달 (5-sphere = 35ms, marginal +2ms over,
나머지 sub-step 정리 시 완전 정합 가능).

### 2.3 Root cause trace (4-step)

1. **Engine** (`mesh.rs:export_edge_lines_with_map`): sphere-only scene
   의 모든 quad edges 가 smooth-group hide (LOCKED #40 §L7 — "두 인접
   face 가 같은 곡면 surface 인스턴스 면 angle threshold 무시하고 edge
   hide") → empty array 반환.
2. **WasmBridge.getEdgeLines** (이전): `if (lines.length > 0)` 조건 →
   empty 면 `return null` (graceful fallback 의도 *였으나* 의도와 결과
   불일치 — engine 명시 empty 와 engine 미사용 구분 안 됨).
3. **Viewport.ts 의 fallback 분기**: `else` 으로 `new THREE.EdgesGeometry
   (geometry, 30)` 호출 — 1M tris 전체 dihedral 계산.
4. **결과 시각**: ~0~4 segments 만 visible (sphere 본래 smooth — 의도된
   결과). **584ms 를 들여 "edges 없음" 을 재계산** — pure waste.

## 3. Lock-ins

### L-112-1 — Float32Array(0) 통과 (β-a)
- `WasmBridge.getEdgeLines()` 가 engine 의 empty array 결과를
  null-coalesce 없이 그대로 통과시킴 (`Float32Array(0)` instance).
- engine 명시 empty (smooth-group hide) 와 engine 미사용 (`undefined` /
  throw) 의 의미 구분 명확화.

### L-112-2 — Viewport 3-way edges fallback policy (β-b)
- `edgeLines !== null && edgeLines !== undefined` → DCEL path (empty
  포함, length 0 시 no-op).
- `edgeLines === null` → EdgesGeometry fallback (legacy WASM / mock /
  throw 만).
- 핵심 회귀: empty edges 도 fallback 호출하지 않음 (LOCKED #40 §L7
  smooth-group hide 정합).

### L-112-3 — LOCKED #40 §L7 의 architectural decision 시각 layer 전달
- LOCKED #40 §L7 ("두 인접 face 가 같은 곡면 surface 인스턴스 면 angle
  threshold 무시하고 edge hide") 가 engine layer 의 결정 → 본 ADR 이
  cache layer + 시각 layer 까지 정합 보존.
- 향후 곡면 smooth-group hide 정책 변경 시 본 layer 의 정합도 함께
  검토.

### L-112-4 — Legacy fallback 보존 (graceful)
- WASM 미빌드 환경 (`engine.get_edge_lines === undefined`) → null 반환
  → EdgesGeometry fallback. 기존 graceful behavior 보존.
- WASM throw → null 반환 → fallback. 동일.
- 시각 quality 회귀 0 (legacy path).

### L-112-5 — ADR-038 P23 / LOCKED #40 §L7 회귀 0
- Surface metadata 기반 smooth-group 판정 (LOCKED #40 §L7) 의 engine
  결과를 *그대로* 시각 layer 가 신뢰.
- "정밀 smooth 곡면 visual quality 보존 + edges fallback 의 wasteful
  recomputation 0" 동시 달성.

### L-112-6 — Caching invariant 유지
- Bridge cache 가 `Float32Array(0)` 도 truthy 로 cache hit 처리 (기존
  truthy check 자연 동작).
- `dirty=false` 후 두 번째 호출이 engine 추가 호출 0 (회귀 테스트
  검증).

### L-112-7 — ADR-046 P31 #4 additive only
- API surface 변경 0: `WasmBridge.getEdgeLines()` signature `Float32Array
  | null` 유지.
- 의미만 명확화: `null` = engine 미사용, `Float32Array(0)` = engine
  명시 empty.
- 사용자 facing behavior change 0 — *오직* 성능만 향상.

### L-112-8 — 메타-원칙 #11 정합 (syncMesh 33ms budget)
- 5-sphere syncMesh: 713ms → 35ms (95% 감소).
- syncMesh budget (33ms) 거의 도달. 잔존 +2ms 는 나머지 sub-step (back-
  mesh clone, wall/sheet loop) — 별도 ADR 후속 정리 시 완전 정합.

## 4. 후속 트랙 (별도 ADR)

### γ — `bridgeQueries` + `fullUpdate` 나머지 sub-step 정리
- 5-sphere 기준 35ms 의 잔존 비용 분해:
  - bridgeQueries (10+ WASM calls): ~3-5ms
  - geometry rebuild: 3-8ms
  - back-mesh clone × 2: ~10-15ms
  - wall/sheet index loop: ~5-10ms
- syncMesh budget 33ms 완전 정합 위한 후속 sub-step.

### δ — ADR-111 β (Delta-buffer extension to primitives)
- syncMesh 자체를 incremental 으로 처리 (현재 모든 sphere create =
  full rebuild). multi-week atomic.

### ε — Engine `get_edge_lines` ok-envelope (architectural cleanup)
- Rust 측에서 `Result<Vec<f32>, EdgeError>` 명시 enum 으로 분리.
- 본 ADR 의 TS layer 정합 위에 architectural cleanup.

## 5. 회귀 자산 (절대 #[ignore] 금지)

### `web/src/bridge/WasmBridge.test.ts` β-c 5 tests

- `engine 명시 empty (length 0) → Float32Array(0) 반환 (NOT null)`
  (L-112-1)
- `engine 미사용 (undefined) → null 반환 (legacy fallback)` (L-112-4)
- `engine throw → null 반환 (graceful)` (L-112-4)
- `engine non-empty → Float32Array 통과` (회귀 가드)
- `cache: dirty=false 후 두 번째 호출이 cache hit (engine 0회 추가
  호출)` (L-112-6)

### `web/src/viewport/Viewport.edges-policy.test.ts` 8 tests

- `edgeLines === null → EdgesGeometry fallback (legacy)` (L-112-2)
- `edgeLines === undefined → EdgesGeometry fallback (legacy)` (L-112-2)
- `edgeLines.length > 0 → DCEL render path` (L-112-2)
- `edgeLines.length === 0 (smooth-group hide 의도) → empty no-op (NOT
  fallback)` (L-112-2, 핵심)
- `engine empty result 는 EdgesGeometry 호출하지 않음` (L-112-2 회귀
  가드)
- `null edgeLines 는 EdgesGeometry 호출 (legacy 경로 보존)` (L-112-4)
- `sphere-only scene 모든 edges 가 smooth-group hide 후 empty (engine
  의도)` (L-112-3)
- `mixed scene (box + sphere) 는 box edges 만 visible` (L-112-3 회귀
  가드)

전체 vitest 자산 1838 → **1851 PASS** (+13, 회귀 0, 절대 #[ignore]
금지 13/13 준수).

## 6. Lessons

### L1 — Empty 와 null 의 의미 분리 (architectural correctness)
- 본 ADR 의 핵심 통찰: "function 의 empty result" 와 "function 미실행"
  은 의미적으로 *다르다*. cache layer 의 null-coalesce 는 이 둘을 통합
  하면서 architectural information 을 잃는 회귀.
- **가이드**: 향후 API 결과의 `null | empty` boundary 정의 시 *의미*
  를 우선 (성능 fallback 의 source 식별 가능하도록).

### L2 — α 의 evidence 가 β 의 anchor (Path Z atomic 답습)
- ADR-111 α (BVH defer) 가 측정 evidence 를 생성 → 다음 가장 큰 비용
  (EdgesGeometry fallback) 명확 식별.
- "측정 → fix → 측정 → 다음 fix" 의 atomic 체인이 각 step 의 architectural
  correctness 확보.
- **가이드**: 큰 cost 가 흡수되면 그 다음 가장 큰 cost 가 자연 노출 —
  각각 atomic ADR 으로 분리.

### L3 — LOCKED 정책의 cross-layer 정합 강제
- LOCKED #40 §L7 (engine smooth-group hide) 의 architectural decision 이
  cache layer 의 null-coalesce 에서 *무력화* 되던 회귀 발견.
- 본 ADR 이 cache + 시각 layer 정합 보존.
- **가이드**: LOCKED 정책의 architectural decision 은 *모든 layer* 에서
  보존되는지 별도 audit 권장.

### L4 — Complete Meaning per Merge (LOCKED #44) 정합 패턴
- β-a + β-b 가 *같은 의미 단위* (edges fallback policy) → 1 PR 으로 묶음.
- 둘 중 1개만 merge 시 invariant violation (β-a only → 빈 array →
  fallback 호출 → 무한 시도 / β-b only → engine 결과가 null 이라 시각
  영향 없음).
- LOCKED #44 의 의미 단위 분할 기준 정확 적용.

## 7. Acceptance Log

- **β-c-1** (audit): preview 직접 측정 — `edgeLinesNull: true` 5/5 +
  edgesMs 78 → 584 ms linear scaling 발견 (5-sphere 추적)
- **β-c-2** (lettered options): β-a / β-b / β-c / β-d / β-e 매트릭스
  제시 + 사용자 결재 β-c 채택
- **β-c-3** (β-a impl): `WasmBridge.getEdgeLines()` — empty 시
  `Float32Array(0)` 반환 (null-coalesce 제거)
- **β-c-4** (β-b impl): `Viewport.ts` edges 분기 — `edgeLines !== null
  && !== undefined` 3-way policy
- **β-c-5** (regression): WasmBridge.test.ts +5 + Viewport.edges-policy
  .test.ts +8 = **+13** tests (절대 #[ignore] 금지 13/13)
- **β-c-6** (verification): preview 직접 측정 — 5-sphere syncMesh 713ms
  → 35ms (20× faster), edgesMs 584ms → 0ms 검증
- **β-c-7** (ADR + LOCKED + commit + PR, 본 단계)

## 8. Cross-link

- ADR-111 α — BVH defer to next frame (직계 trigger source)
- LOCKED #40 §L7 — smooth-group hide architectural decision
- LOCKED #44 — Complete Meaning per Merge (β-a + β-b 묶음 정합)
- ADR-038 P23 — surface-aware normals (smooth-group source)
- 메타-원칙 #11 — Latency Budget First (syncMesh 33ms)
- 메타-원칙 #6 — Preventive over Curative (측정 우선)
- ADR-046 P31 #4 — additive only (API surface UNCHANGED)
