# ADR-108: Face/Edge BVH Spatial Index (S1 — Phase 1 Tier 1)

- **Status**: S-α Draft (spec only, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: ADR-107 §C Tier 1 — *S1 BVH spatial index*. 사용자 결재
  (2026-05-20) 의 "더 빠르게" 축의 첫 번째 architectural 결정.
- **Parent**: ADR-107 (DCEL Extension Survey), 메타-원칙 #11 (Latency
  Budget First)
- **Sibling**: ADR-109 (가칭 S3 fine-grained dirty regions), ADR-110
  (가칭 I2 provenance) — Tier 1 batch
- **Successor (planned)**: 본 ADR 의 S-β/S-γ/S-δ/S-ε sub-steps —
  multi-week atomic.

---

## A. Problem Statement

axia-geo 의 모든 spatial query 는 *O(N) linear scan*:

| Query | 현재 비용 | 사용처 |
|-------|----------|--------|
| `point_in_face(face_id, point)` | O(verts/face) per face → O(total_verts) for "which face contains point" | hole 재배치 (Phase G), erase preview, snap target classify |
| `find_line_crossings(line, face_id)` | O(edges/face) per face → O(total_edges) for "all line-face intersections" | split_face_by_line, Boolean intersection |
| `split_faces_by_intersections` | O(N×M) face pair scan in Boolean | Boolean Union/Subtract/Intersect |
| Auto-intersect detection | O(N²) face pair scan | Draw operations triggering P7 |
| Selection / picking from Rust side | Linear scan | (현재 three-mesh-bvh 가 Three.js geometry 만 — Rust 쪽 픽킹은 N 검사) |

**증상 시나리오** (cylinder × N scene):
- 100 cylinder × 25 face each = 2,500 face. Boolean A × B = 6,250,000
  pair scan
- Click pick (Three.js → Rust round-trip): three-mesh-bvh 가 처음
  filter 하지만 Rust 후속 `point_in_face` 가 다시 O(N) — 메타-원칙
  #11 Latency Budget *Hover 16ms / Click 33ms* 초과 위험

**Spatial hash 의 한계**:
- LOCKED #5 의 `spatial_hash: FxHashMap<SpatialKey, Vec<VertId>>` 는
  **vertex coincidence dedup 전용** (1.5μm bucket).
- Face/Edge AABB query 에 활용 불가 (cell size 가 너무 좁음, 객체별
  큰 AABB 와 미스매치).

---

## B. Lock-ins

### S-A — rstar R-tree 채택 (Rust 생태계 표준)
- `rstar = "0.12"` 또는 0.13. Industry-standard R-tree implementation.
  AABB / line / point / k-nearest query 모두 지원.
- 대안 (rejected):
  - **kd-tree** — point query 최적, AABB query 부적합
  - **Custom BVH** — full control 이지만 maintenance cost 큼
  - **flann / faiss** — overkill, native dependency 필요

### S-B — Lazy-built + invalidate-on-mutation
- `face_bvh_cache: RefCell<Option<FaceBVHIndex>>` (interior mutability)
- `face_bvh_dirty: bool` (mutation 시 true → 다음 query 시 rebuild)
- Initial 구현: **full rebuild on dirty**. Incremental update (insert/
  remove specific faces) 는 S-δ 또는 ADR-109 (S3 fine-grained dirty)
  와 통합 시.
- Rationale: simpler S-α scope. 측정 후 incremental 가치 검증.

### S-C — Mesh-level field (Cargo.toml + Mesh struct)
- `Cargo.toml`: `rstar = "..."` workspace dep 등록
- `Mesh` struct: `#[serde(skip)] pub(crate) face_bvh_cache:
  RefCell<Option<FaceBVHIndex>>` + `face_bvh_dirty: Cell<bool>`
- ADR-091 §E L1 정합 — Mesh-level field 추가는 bincode 호환 (skip
  + Cell/RefCell interior mutability).

### S-D — Public API (initial S-β)
- `mesh.faces_containing_point(p: DVec3) -> Vec<FaceId>` — point ∈
  face AABB filter + 정확한 `point_in_face` 검증
- `mesh.faces_intersecting_aabb(aabb) -> Vec<FaceId>` — AABB overlap
  filter
- `mesh.faces_intersecting_ray(origin, dir) -> Vec<FaceId>` — ray ∈
  face AABB filter (정확 ray-triangle 은 caller)

### S-E — Invalidation hooks (mutation site instrumentation)
모든 face mutation site 가 `mesh.invalidate_face_bvh()` 호출. 사이트:
- `add_face` / `add_face_with_holes` / `add_face_closed_curve`
- `remove_face` / `soft_remove_face`
- `split_face` (face_b 추가 + face_id 수정)
- 6 split sites (face_split.rs, ADR-106 R-α 패턴 답습)
- `translate_verts` / `rotate_verts` / `scale_verts` (face AABB 이동 시)
- 기타 face 의 normal / outer loop 수정 site

S-α scope = sites 식별 only. S-β 에서 실제 instrument.

### S-F — Engine 외부 변경 0 (S-α + S-β + S-γ + S-δ + S-ε 모두)
WASM bridge / TS / Playwright 변경 없음. 본 fix 는 *engine internal
performance*. 사용자 facing 효과 = latency 회복 (메타-원칙 #11 정합)
만 자동.

### S-G — Edge BVH 는 S-δ deferred
S-β/S-γ 는 Face BVH 만. Edge BVH 는 S-δ — snap / nearest-edge query
가시 가치 측정 후 결재.

### S-H — Backward compat + invariant 보존
- LOCKED #5 spatial_hash 보존 (vertex dedup 전용, 별도 역할)
- ADR-007 invariant 변경 0
- ADR-091 §E L1 정합 (Mesh-level field)
- 메타-원칙 #12 Memory Budget — BVH cap (face count > 10K 시 rebuild
  cost 측정 후 dynamic strategy)

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| `rstar` 의존성 | workspace + axia-geo Cargo.toml 등록 |
| `FaceBVHIndex` 구조 | rstar `RTree<FaceAABBEntry>` 기반, FaceId → AABB 인덱스 |
| Mesh field | `face_bvh_cache` + `face_bvh_dirty` 추가 (serde skip + interior mutability) |
| Public API | `faces_containing_point` / `faces_intersecting_aabb` / `faces_intersecting_ray` |
| Invalidation hooks | 모든 mutation site 에 `invalidate_face_bvh()` 호출 |
| Boolean integration (S-γ) | `split_faces_by_intersections` 의 face pair scan O(N×M) → BVH-filtered |
| 회귀 자산 | S-β +5 (build / invalidate / query 3 types / consistency), S-γ +3 (Boolean BVH path equivalence), S-δ +3 (Edge BVH), S-ε +3 (benchmark, regression guard) |
| 회귀 (전체) | axia-geo +14 예상 (절대 #[ignore] 금지) |
| Benchmark | 100 cylinder × 25 face = 2,500 face Boolean: O(N²) → O(N log N) 의 명시 측정 |

---

## D. Acceptance Log

### S-α (본 commit) — Spec only

- **commit**: 본 commit (`docs/adr/108-face-bvh-spatial-index.md`)
- **변경**: ADR draft 1 file
- **회귀**: 0 (spec only)
- **코드 변경**: 0
- **다음**: S-β (FaceBVH core MVP) — 사용자 결재 후 진행.

### S-β ~ S-ε (planned)

| Sub | 목표 | 예상 회귀 | Scope |
|-----|------|----------|-------|
| S-β | FaceBVH 구조 + lazy build + invalidation hooks | axia-geo +5 | mesh.rs +helpers, Cargo.toml dep |
| S-γ | Boolean integration — `split_faces_by_intersections` BVH-filtered | axia-geo +3 | boolean.rs |
| S-δ | EdgeBVH — snap / nearest-edge | axia-geo +3 | (optional, gated by S-γ benchmark) |
| S-ε | Benchmark + 회귀 guard | axia-geo +3 | criterion bench |

**예상 누적**: docs +1 + axia-geo +14, 절대 #[ignore] 금지 14/14 준수.
multi-week scope. S-α (본 commit) → S-β (별도 commit) → S-γ → ...

---

## E. Future cross-cut

### ADR-109 (가칭 S3 fine-grained dirty regions)
ADR-108 의 `face_bvh_dirty: bool` 을 `HashSet<FaceId>` 로 확장.
incremental BVH update (insert/remove specific faces) 가능. ADR-108
S-β closure 후 ADR-109 진입 시 자연 활용.

### ADR-110 (가칭 I2 provenance)
ADR-108 과 직교. Independent track.

### Phase 2 Tier 2 architectural
- G1 Volume 1급화 — Volume AABB BVH 가 자연 확장 (FaceBVH 패턴 답습)
- G4 Wire/Point 1급화 — Wire BVH 가 EdgeBVH (S-δ) 의 자연 확장

---

## F. Lessons (preliminary — S-ε closure 시 보완)

1. **rstar 의 ecosystem fit** — Rust 표준 R-tree, 광범위 채택. 별도
   설계 cost 없이 즉시 활용.
2. **Lazy + dirty bool 의 단순성** — incremental update 가치 측정
   후 결정. premature optimization 차단.
3. **ADR-091 §E L1 정합** — Mesh-level field (RefCell + Cell + serde
   skip) 가 bincode 호환 + interior mutability 자연 정합.

---

## G. Cross-link

- ADR-107 §C Tier 1 (S1 BVH spatial index — 본 ADR 의 source roadmap)
- 메타-원칙 #11 Latency Budget First (Hover 16/Click 33/Commit 100/
  Heavy 500 ms)
- 메타-원칙 #12 Memory Budget Per Entity (BVH memory cap 검토)
- 메타-원칙 #13 One Source, Two Views (Rust=truth, JS=view — BVH 는
  Rust internal, JS three-mesh-bvh 와 별개 layer)
- ADR-091 §E L1 (Mesh-level field 패턴)
- LOCKED #5 (1.5μm spatial-hash — vertex dedup 보존)
- ADR-007 (Manifold + Winding — invariant 보존)
- ADR-106 R-α (split site instrumentation 패턴 — mutation hook 답습)
