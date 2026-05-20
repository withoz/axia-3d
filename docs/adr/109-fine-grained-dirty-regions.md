# ADR-109: Fine-Grained Dirty Regions (S3 — Phase 1 Tier 1)

- **Status**: D-α Draft (spec only, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: ADR-107 §C Tier 1 — *S3 Fine-grained dirty regions*. 본
  ADR 은 ADR-108 (Face BVH) 과 sibling — *"더 빠르게"* 축의 두 번째
  architectural 결정.
- **Parent**: ADR-107 (DCEL Extension Survey)
- **Sibling**: ADR-108 (S1 BVH spatial index), ADR-110 (가칭 I2
  provenance) — Tier 1 batch
- **Successor (planned)**: 본 ADR 의 D-β/D-γ/D-δ sub-steps —
  multi-week atomic.

---

## A. Problem Statement

axia-engine 의 cache invalidation 은 *coarse bool*:

| Layer | 현재 invalidation |
|-------|-----------------|
| `Mesh.cache_dirty: bool` (axia-wasm 의 cached_edge_lines / cached_indices / cached_face_map) | mutation 발생 시 전체 `true` → 다음 query 시 *full mesh rebuild* |
| `WasmBridge.bufferCache.dirty: bool` (TS 측) | `markDirty()` 호출 시 `true` → 다음 `getMeshBuffers()` 호출 시 entire buffer 재구축 |
| ADR-108 (예정) `face_bvh_dirty: bool` | mutation 시 `true` → 다음 BVH query 시 *full BVH rebuild* |

**증상 시나리오** (large scene, single face edit):
- 10,000-face scene 에서 1 face 의 vertex 1개 이동
- 전체 cache rebuild: ~50ms (메타-원칙 #11 Hover 16ms 초과)
- DCEL topology 9,999 faces 정합 영향 0 인데도 rebuild

**개선 방향**:
- `dirty_faces: FxHashSet<FaceId>` — 정확한 face 집합 변경 사항만
  rebuild
- `dirty_edges: FxHashSet<EdgeId>` — edge wireframe 부분 rebuild
- Cache layer 가 dirty set 을 cumulative 로 받아 incremental update

---

## B. Lock-ins

### D-A — Mesh-level FxHashSet field (ADR-091 §E L1 정합)
- `Mesh.dirty_faces: FxHashSet<FaceId>` (interior mutability via
  `RefCell` for `&self` query path)
- `Mesh.dirty_edges: FxHashSet<EdgeId>` (별도 set — edge-only 변경
  e.g. curve metadata 변경 시)
- 기존 `cache_dirty: bool` 은 *임시 보존* (D-β 에서 deprecation 마이그
  레이션 sub-step 별도)
- serde skip + default empty set → bincode 호환

### D-B — Invalidation API
```rust
impl Mesh {
    pub fn mark_face_dirty(&self, face_id: FaceId);
    pub fn mark_faces_dirty(&self, face_ids: &[FaceId]);
    pub fn mark_edge_dirty(&self, edge_id: EdgeId);
    pub fn dirty_faces(&self) -> &FxHashSet<FaceId>; // 즉시 borrowable
    pub fn clear_dirty(&self) -> (FxHashSet<FaceId>, FxHashSet<EdgeId>);
}
```

- `mark_face_dirty` 가 `&self` (RefCell 활용) — 모든 mutation site 가
  `&mut self` 어차피 보유하지만 query path 에서도 invalidation 등록
  가능 (lazy semantics)
- `clear_dirty` 가 set 을 *drain* 하여 caller (cache rebuild layer)
  가 incremental 적용

### D-C — Mutation site instrumentation (ADR-106 R-α 패턴)
모든 face/edge mutation site 에 `mark_face_dirty()` / `mark_edge_dirty()`
호출:
- `add_face` / `add_face_with_holes` / `add_face_closed_curve`
- `remove_face` / `soft_remove_face`
- `split_face` (face_id + face_b)
- 6 split sites (face_split.rs)
- `translate_verts` / `rotate_verts` / `scale_verts` — vert 가 속한
  모든 face mark dirty
- `set_face_surface` / `set_face_material`
- Edge mutation: `set_edge_curve`, `split_edge` (해당 edge + 양쪽
  incident face)

D-α scope = sites 식별 only. D-β 에서 실제 instrument.

### D-D — Coarse `cache_dirty: bool` 의 점진 마이그레이션
- D-β 에서 `dirty_faces.is_empty()` 검사를 `cache_dirty: bool` 대체
- 기존 `markDirty()` / `invalidate_cache()` 호출은 *유지* — 내부에서
  `dirty_faces` 에 모든 active face 일괄 insert (fallback for callers
  that don't know per-face dirty)
- D-γ 또는 D-δ 에서 callers 마이그레이션 후 `cache_dirty: bool` 제거

### D-E — Cache rebuild layer 의 incremental adoption
`Mesh::export_buffers` 의 cache rebuild (axia-wasm `rebuild_cache`):
- D-β: `dirty_faces` 만 rebuild 시 incremental 가능 (face_range_map
  의 해당 face 영역만 update)
- D-γ: ADR-108 BVH invalidation 도 `dirty_faces` 기반으로 incremental
  insert/remove (full rebuild 안 함)

### D-F — Engine 외부 변경 0 (D-α + D-β + D-γ + D-δ 모두)
WASM bridge / TS / Playwright 변경 없음. WasmBridge 의 `bufferCache.
dirty` 는 별도 layer (Three.js geometry rebuild) — TS-side 의 fine-
grained 은 별도 트랙.

### D-G — 메타-원칙 #11 + #12 정합
- **#11 Latency Budget**: large scene single-face edit Hover budget
  16ms 회복
- **#12 Memory Budget**: `FxHashSet` cap — face count > 100K 시
  set 크기 측정 (현재 거의 모든 scene < 10K, set 크기 negligible)

### D-H — 회귀 자산 sites
D-β: +5 (set insert/remove invariants + mutation hook coverage + drain
semantics + bincode roundtrip + fallback test)
D-γ: +3 (incremental cache rebuild equivalence vs full rebuild)
D-δ: +2 (ADR-108 BVH incremental integration)

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| `dirty_faces: FxHashSet<FaceId>` field | Mesh struct 에 추가 (serde skip + RefCell) |
| `dirty_edges: FxHashSet<EdgeId>` field | 동일 |
| API | `mark_face_dirty` / `mark_faces_dirty` / `mark_edge_dirty` / `dirty_faces` / `clear_dirty` |
| Mutation hooks | 모든 face/edge mutation site instrumented |
| Cache rebuild | dirty set 기반 incremental rebuild path |
| ADR-108 BVH 통합 | D-δ 에서 BVH incremental update |
| Backward compat | 기존 `cache_dirty: bool` D-β/γ 점진 마이그레이션 |
| 회귀 (전체) | axia-geo +10 예상 (D-β 5 + D-γ 3 + D-δ 2), 절대 #[ignore] 금지 |

---

## D. Acceptance Log

### D-α (본 commit) — Spec only

- **commit**: 본 commit (`docs/adr/109-fine-grained-dirty-regions.md`)
- **변경**: ADR draft 1 file
- **회귀**: 0 (spec only)
- **코드 변경**: 0
- **다음**: D-β (FxHashSet field + API + mutation hook 일괄 instrument)
  — 사용자 결재 후 진행.

### D-β ~ D-δ (planned)

| Sub | 목표 | 예상 회귀 |
|-----|------|----------|
| D-β | FxHashSet field + API + mutation hook instrumentation | +5 |
| D-γ | Cache rebuild incremental adoption (axia-wasm) | +3 |
| D-δ | ADR-108 BVH incremental integration | +2 |

**예상 누적**: docs +1 + axia-geo +10, multi-week atomic.

---

## E. Cross-cut

### ADR-108 (S1 BVH) 와의 통합
- ADR-108 D-β 의 `face_bvh_dirty: bool` 을 본 ADR D-δ 가 *대체* —
  `dirty_faces` 기반 incremental insert/remove. Full BVH rebuild 차단.

### ADR-110 (가칭 I2 provenance) 와의 직교
- Provenance 는 entity 의 *creating Command* 추적. Dirty regions 는
  *cache invalidation*. 두 layer 독립. 동시 진행 가능.

### Phase 2 Tier 2 (S6 Bulk operations)
- Bulk add/remove 가 `dirty_faces.extend(...)` 로 자연 통합. ADR-109
  의 set-based API 가 prerequisite.

---

## F. Lessons (preliminary — D-δ closure 시 보완)

1. **Coarse bool → fine set 의 transition cost** — 기존 `cache_dirty:
   bool` 의 모든 callers 가 fallback (전체 face insert) 로 자동 호환.
   점진 마이그레이션 가능.
2. **FxHashSet 의 Rust 생태계 standard** — `rustc-hash` 가 이미 axia-
   geo dep. 새 dep 0.
3. **메타-원칙 #11 의 자연 정합** — Hover 16ms / Click 33ms budget 이
   large scene 에서 *only* `dirty_faces` 처리로 달성. Latency 보장의
   architectural anchor.

---

## G. Cross-link

- ADR-107 §C Tier 1 (S3 fine-grained dirty — 본 ADR 의 source roadmap)
- ADR-108 (S1 BVH — 본 ADR D-δ 와 통합)
- ADR-091 §E L1 (Mesh-level field 패턴)
- ADR-106 R-α (mutation hook instrumentation 패턴)
- 메타-원칙 #11 (Latency Budget), #12 (Memory Budget)
- LOCKED #5 (1.5μm spatial-hash — vertex dedup 보존)
