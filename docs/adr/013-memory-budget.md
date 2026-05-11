# ADR-013 — Memory Budget & Bounded Collections

**Status**: Proposed
**Date**: 2026-04-27
**Axis**: 메모리 (성능에도 직접 영향 — GC 압박이 프레임 끊김의 주요 원인)
**Related**: ADR-012 (Latency Budget), 기존 메모리 누수 방지 정책

---

## 컨텍스트

기존 정책:
- ✅ History ring buffer (cap=50)
- ✅ Hover edge queue (cap=3)
- ✅ DOM/listener cleanup
- ✅ Three.js geometry .dispose()

부족한 부분:
1. **글로벌 메모리 예산 부재** — 어디까지 써도 되는가?
2. **상한 없는 자료구조 다수** — Snap cache, BVH cache, Constraint snapshot
3. **Undo snapshot 압축 정책 없음** — 큰 모델에서 50개 snapshot은 GB 단위 가능

복잡한 모델에서 프레임이 끊기는 두 번째 주요 원인은 **메모리 압박**이다 — V8 GC가 50ms 이상 stop-the-world 하면 그 자체로 budget 위반.

## 결정

### 1. 글로벌 메모리 예산

Typical project (1만 face) 기준:

| 영역 | 예산 | Soft limit | Hard limit |
|---|---|---|---|
| Rust slot storage | 50 MB | 80 MB | 120 MB |
| Three.js geometry | 80 MB | 120 MB | 200 MB |
| BVH | 20 MB | 40 MB | 60 MB |
| Snap cache | 10 MB | 15 MB | 20 MB |
| History (cap=50) | 30 MB | 50 MB | 80 MB |
| Undo snapshots | 50 MB | 80 MB | 150 MB |
| **Total target** | **240 MB** | **385 MB** | **630 MB** |

- **Soft limit 도달 시**: 각 영역의 evict 정책 발동 (아래 §3)
- **Hard limit 도달 시**: 사용자에게 toast 알림 + 강제 정리

### 2. Bounded Collections — 모든 자료구조에 cap

| 자료구조 | 기존 cap | 새 cap | Eviction |
|---|---|---|---|
| History ring buffer | 50 | **유지 50** | 기존 ring |
| Hover edge queue | 3 | **유지 3** | 기존 |
| Snap candidate cache | 없음 | **200 entries** | LRU |
| BVH per-mesh cache | 없음 | **mesh당 1, 전체 1000** | LRU |
| Constraint graph snapshot | 없음 | **50** (history와 동기) | History와 동기 evict |
| Undo step | 없음 | **개별 1MB 초과 시 delta 압축** | 자동 |
| Telemetry buffer | 없음 | **1000 entries** | ring |

### 3. Eviction 우선순위

Soft limit 도달 시 다음 순서로 evict:

```
1. Snap cache LRU evict (가장 안전, 다음 hover에 lazy rebuild)
2. BVH lazy rebuild (메모리 해제, 다음 picking 시 rebuild)
3. History oldest entry → delta encoding (full snapshot 폐기)
4. Telemetry buffer flush (디스크 또는 IndexedDB)
5. (마지막) Undo cap 강제 축소: 50 → 30
```

### 4. SSOT — One Source, Two Views (메모리 관점)

ADR-001은 *논리적* 레이어 분리지만, 메모리 절감을 위해 **물리적 위치**도 명시:

```
규칙: 동일 데이터는 한 곳에만 저장

✅ Topology     → Rust slot storage only
✅ Material def → Rust (JS는 material id만)
✅ Selection    → JS only
✅ Camera       → JS only
✅ Vertex pos   → Rust truth, JS는 GPU buffer view (zero-copy)

❌ Face normal cache: Rust winding 우선, JS cache는 휘발성
   - refresh 시 폐기, 새로 받음 (저장 X)
```

**Zero-copy 검증 항목**:
- WASM linear memory를 Three.js BufferAttribute가 *직접 참조*하는가?
- 아니면 매번 복사가 발생하는가? (현재 구현 감사 필요 — Phase 1 작업)

매 mesh refresh마다 vertex 복사가 일어나면, 1만 face × 4 vertex × 3 float × 4 byte = 480KB가 매 commit마다 복사된다. 이 복사를 zero-copy로 전환하면 GC 압박 ↓.

### 5. LOD (Level of Detail) Strategy

현재 정의 없음 — 큰 프로젝트에서 메모리 폭발 위험.

| 단계 | 기준 | 보유 데이터 |
|---|---|---|
| **LOD 0 (Full)** | 화면 영역 ≥ 100 px², 활성 작업 객체 | full topology + BVH + edge geometry |
| **LOD 1 (Visible)** | 화면 영역 ≥ 4 px², frustum 내부 | full topology, BVH 지연 빌드 |
| **LOD 2 (Far)** | 화면 영역 < 4 px² 또는 거리 > 1km | mesh only, edge 제거 |
| **LOD 3 (Hidden)** | frustum 외부 | AABB만, 렌더 X |

**전환 트리거**:
- 카메라 정지 후 200ms → LOD 재계산
- 카메라 이동 중에는 강등만 (승격은 정지 후)
- 마지막 편집 후 5분 → LOD 1 (BVH 해제)

**규칙**:
- LOD는 *렌더/picking* 측면만 — 토폴로지는 항상 Rust에 full로 보존
- LOD 강등은 *메모리* 절감, 아니라 *연산* 절감

### 6. 측정 인프라

```
window.__AXIA_MEMORY = {
    rust_slot_bytes: number,        // WebAssembly.Memory.byteLength
    threejs_geometry_bytes: number, // BufferGeometry sum
    bvh_bytes: number,
    snap_cache_bytes: number,
    history_bytes: number,
    undo_bytes: number,
    total: number,
    budget_used_pct: number,        // total / soft_limit
};
```

5초마다 sampling. ADR-012 telemetry와 통합.

## 결과

**긍정**
- 메모리 폭발 *불가능* (모든 컬렉션이 bounded)
- 큰 모델에서 frame chain ↓ (GC 압박 ↓)
- Eviction 정책으로 우선순위 명확
- Zero-copy 검증으로 mesh refresh 비용 ↓

**부정**
- Eviction 정책 구현 복잡도 ↑ (Phase별 진행 권장)
- LOD 전환 시 잠깐의 시각 변화가 사용자에게 보일 수 있음 (200ms threshold로 완화)
- 메모리 측정 자체가 5초마다 ~0.5ms — 충분히 작음

## 검증

1. 1만 face 모델 로드 → total memory ≤ 240MB (target)
2. 5만 face 모델 로드 → soft limit 발동, eviction 트리거
3. 10만 face 모델 → hard limit 알림 + 사용자 동의 후 진행
4. Undo 50회 후 메모리 ≤ 80MB (delta 압축 확인)
5. Zero-copy: mesh refresh 시 vertex array 복사 0회

## 대안 (Alternatives)

- **무제한 cache + GC 신뢰**: V8 GC 가 알아서. 큰 모델에서 stop-the-world 50ms+ 발생 → 프레임 끊김 직격. 기각.
- **수동 메모리 해제 (manual dispose API)**: 사용자 부담. ADR-009 "명확한 경우는 자동" 위반. 기각.
- **IndexedDB 스왑**: undo snapshot 을 디스크로. 복원 시 latency ↑ → ADR-012 위반. 검토 후 defer.
- **WASM heap fixed size**: 처음부터 200MB 할당. 작은 프로젝트에 낭비. 기각.

## 재검토 트리거 (When to Revisit)

- 1만 face 기준 budget 240MB 가 50% 이상 여유 (= 너무 보수적, 상한 ↑ 가능)
- 또는 hard limit 도달 보고가 월 5건 초과 (= 너무 작음, 상한 ↑ 필요)
- Zero-copy 미달성으로 mesh refresh 비용이 budget 의 30% 이상

## 관련 기록 (Related)

- ADR-001 (레이어 분리) — 논리적 SSOT 의 *물리적* 강화
- ADR-007 (Face Orientation) — winding 우선, normal cache 휘발
- ADR-012 (Latency Budget) — 메모리 압박이 budget 위반 원인일 때 강등 발동
- 메타-원칙 #4, #6, #12, #13

## 메타-원칙 매핑

- #4 SSOT — 메모리 측면에서 강화
- #12 (신규) Memory Budget Per Entity
- #13 (신규) One Source, Two Views
- #6 Preventive over Curative — 사전 evict가 사후 OOM보다 우선
