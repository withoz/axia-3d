# ADR-107: DCEL / Half-Edge Extension Survey — 3-Axis Roadmap

- **Status**: Accepted (S-α spec-only canonical survey, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: 사용자 결재 (2026-05-20) — "DCEL/half-edge의 발전은 *더
  일반적으로, 더 빠르게, 더 많은 정보를 다루도록* 확장하는 방향".
  본 ADR 은 향후 모든 DCEL 확장 ADR (Tier 1 ~ Tier 3) 의 *canonical
  reference + priority anchor*.
- **Parent**: 메타-원칙 #4 (SSOT), #11 (Latency Budget), #12 (Memory
  Budget Per Entity), #13 (One Source, Two Views), ADR-091 §E L1
  (Mesh-level Map canonical guidance — extension 패턴 source)
- **Sibling**: 전 ADR (027~106) — 본 ADR 은 *survey*, 개별 ADR 은
  *execution*
- **Successor (planned)**: ADR-108 (S1 BVH), ADR-109 (S3 fine-grained
  dirty), ADR-110 (I2 provenance) — Tier 1 batch. Tier 2/3 별도.

---

## A. Problem Statement

AxiA 의 DCEL/half-edge 인프라는 5년 누적 (ADR-027 ~ ADR-106) 으로
산업 CAD 와 비교해 *준수 ~ 우수* 수준 도달:

- Analytic geometry attach (Face.surface / Edge.curve) — OpenCASCADE
  BRep parity (ADR-031/033)
- Self-loop edge (closed-curve face) — 메타-원칙 #14 의 deepest
  realization (ADR-089)
- Multi-loop face (hole 지원, ADR-016)
- Mesh-level map canonical pattern (ADR-091 §E L1)
- Three-Layer Citizenship (Form/Property/Reference, ADR-049/050/095)
- TransactionManager (Undo/Redo)
- Constraint solver Level 1/2/3
- Spatial hash (vertex coincidence, LOCKED #5)
- HE flags (SOFT/HARD) + Edge class (Geometry/Centerline)

**그러나 3 축 (generality / speed / information) 에서 명확한 gap 존재**.
사용자 결재 발언 ("더 일반적으로, 더 빠르게, 더 많은 정보를 다루도록
확장") 이 *향후 5+ 년 DCEL 진화의 anchor* — 본 ADR 이 그 *canonical
roadmap*.

---

## B. Three-Axis Survey

### Axis 1 — 더 일반적으로 (Generality, G1~G7)

| # | 확장 | 현재 gap | Industry/Academic reference | Priority |
|---|------|---------|----------------------------|----------|
| **G1** | **Volume cell 1급화** — 3D cell explicit slot (`SlotStorage<VolId, Volume>`) | closed face set 으로 implicit. Boolean / Push-Pull 결과의 "solid" 정체성 불명확 | OpenCASCADE TopoDS_Solid, CGAL Nef polyhedra | **Tier 2** |
| **G2** | **Non-manifold edge** — 3+ face incident edge | `count_shared_edges_outer` 2 만 허용 | CGAL Linear cell complex, OpenMesh | **Tier 3** (STEP import 수요 명확해질 때) |
| **G3** | **T-junction support** — vertex on edge interior | `split_edge` 패턴으로만 가능 | Subdivision surface (Catmull-Clark) | Tier 3 (현재 split_edge 충분) |
| **G4** | **Wire / Point 1급화** — 1D wire / 0D point first-class entity | `Edge.class = Centerline` partial. Sketch 도구 표현 불완전 | OpenCASCADE TopoDS_Wire/Vertex, Rhino-3D Curve | **Tier 2** |
| **G5** | **Multi-resolution / LOD** — 같은 DCEL N 단계 subdivision | 단일 resolution. Chord_tol 동적 render fast-path 가 partial 대체 | OpenMesh Progressive Mesh, libigl multiresolution | Tier 3 |
| **G6** | **Generalized maps (G-maps)** — orientability-independent | ADR-007 winding 강제 (본질적 비호환) | CGAL N-maps | **Rejected** — ADR-007 invariant 위반 |
| **G7** | **Genus > 0 topology** — handle (donut, multi-hole solid) | implicit support (Multi-loop face partial) | Standard topology | Tier 3 (이미 implicit, 명시 invariant만) |

### Axis 2 — 더 빠르게 (Speed, S1~S7)

| # | 확장 | 현재 gap | Priority |
|---|------|---------|----------|
| **S1** | **BVH spatial index** — `FaceBVH` / `EdgeBVH` lazy-built, O(log N) query | 픽킹/스냅/Boolean intersection 이 O(N). three-mesh-bvh 는 Three.js geometry 만 | **Tier 1** |
| **S2** | **Sparse iteration** — `face_iter_by_aabb(aabb)`, `face_iter_by_owner(group_id)` | `mesh.faces.iter()` 전체 walk | Tier 1 (S1 prerequisite 후) |
| **S3** | **Fine-grained dirty regions** — `dirty_faces: HashSet<FaceId>` | `cache_dirty: bool` 전체 rebuild | **Tier 1** |
| **S4** | **SoA vertex positions** — `Vec<DVec3>` 연속 메모리 | AoS `Vertex { pos, ... }` | Tier 2 (SIMD 가치 측정 후) |
| **S5** | **Lock-free read paths** — parking_lot / arc-swap | `&mut self` 단일 쓰기 | Tier 3 (parallel 수요 미확정) |
| **S6** | **Bulk operations** — `add_faces_batch`, `remove_faces_batch` | per-call API | Tier 2 |
| **S7** | **GPU mesh storage** — wgpu compute buffer | CPU only | Tier 3 (현재 bottleneck 아님) |

### Axis 3 — 더 많은 정보 (Information, I1~I7)

| # | 확장 | 현재 gap | Priority |
|---|------|---------|----------|
| **I1** | **Generic attribute system** — `mesh.attributes::<FaceId, T>("user_tag")` typed slot | Mesh-level map 마다 fields 추가 (ADR-091 §E L1 잘 작동 중) | Tier 2 |
| **I2** | **Provenance / audit trail** — Edge/Face/Vertex 의 creating Command id 기록 | TransactionManager 가 operation log 만, entity link 없음 | **Tier 1** |
| **I3** | **Per-vertex UV / color / normals** — face attribute 가 아닌 vertex 별 | face material 만. vertex normal 은 derived | Tier 2 (텍스처 매핑 ADR 시) |
| **I4** | **Mesh-level invariant flags** — `is_watertight()`, `is_convex()` cached derived | `verify_face_invariants` 매번 full scan | Tier 2 |
| **I5** | **PMI / GD&T metadata** — dimension / tolerance / surface finish | ADR-035 P20.B *non-goal* | **Tier 3 — Rejected** (P31 페르소나 외) |
| **I6** | **Multi-material per face** — UV-region based | face 당 1 material | Tier 2 |
| **I7** | **Subdivision metadata** — Catmull-Clark sharpness | 0 | Tier 3 |

---

## C. Tier 분류 + Priority

### Tier 1 (즉시 가치 — 다음 batch ADR)
- **S1 — BVH spatial index** (가치/비용 매우 높)
- **S3 — Fine-grained dirty regions** (가치/비용 높)
- **I2 — Provenance / audit trail** (가치/비용 중-높)

**Rationale**: 모두 *engine 내부* 강화 (사용자 facing 동작 변경 0).
위험 낮음 (additive). 가시 효과 큼 (성능 + 디버깅 능력 + AI agent
의도 추적).

### Tier 2 (architectural — multi-month 결재 필요)
- **G1 — Volume 1급화** (Three-Layer Citizenship 의 dimension 확장)
- **G4 — Wire/Point 1급화** (Reference 시민권 확장)
- **I1 — Generic attribute system** (extension infrastructure 추상화)
- **S4 — SoA vertex positions** (SIMD 가치 측정 후)
- **S6 — Bulk operations**
- **I3 — Per-vertex UV/color/normals**
- **I4 — Mesh-level invariant flags**
- **I6 — Multi-material per face**

### Tier 3 (specialized — 명확한 수요 시)
- **G2 — Non-manifold** (STEP import 수요 시)
- **G3 — T-junction**
- **G5 — Multi-resolution / LOD**
- **G7 — Genus > 0 explicit**
- **S5 — Lock-free read paths**
- **S7 — GPU mesh storage**
- **I7 — Subdivision metadata**

### Rejected (정책/비호환)
- **G6 — Generalized maps (G-maps)** — ADR-007 winding 강제 위반
- **I5 — PMI / GD&T** — ADR-035 P20.B *non-goal*, P31 페르소나 외

---

## D. Cross-cut 정합 매트릭스

| 확장 | 기존 ADR/LOCKED 정합 | 새 ADR | Superseded? |
|------|-------------------|--------|------------|
| G1 Volume 1급화 | ADR-049 Three-Layer Citizenship 자연 확장 | 새 ADR | 0 |
| G2 Non-manifold | ADR-007 Invariant 1 위반 | 새 ADR | ADR-007 partial |
| G4 Wire/Point | ADR-095 Reference 시민권 자연 확장 | 새 ADR (or amendment) | 0 |
| S1 BVH | 메타-원칙 #11 Latency Budget 정합 | 새 ADR | 0 |
| S3 Fine-grained dirty | 현재 markDirty 자연 발전 | 새 ADR | 0 |
| I1 Generic attribute | ADR-091 §E L1 의 type-safe 추상화 | 새 ADR | 0 (L1 pattern 보존) |
| I2 Provenance | TransactionManager 자연 확장 | 새 ADR | 0 |

**핵심 invariant 보존** (모든 확장이 준수해야 함):
- ADR-091 §E L1: Mesh-level Map canonical (bincode struct field 추가
  금지)
- LOCKED #5: 1.5μm spatial-hash dedup
- ADR-007: Manifold + Winding + Topology > Cache
- 메타-원칙 #4/#9/#10: SSOT / 회귀 없음 / ADR 불변
- 메타-원칙 #12: Memory Budget Per Entity (cap 강제)

---

## E. Future Sub-track Plan

### Phase 1 (다음 결재 후 진행) — Tier 1 batch
- **ADR-108 (가칭)** — S1 BVH spatial index. multi-week atomic.
  Lazy-built, incremental rebuild on topology change. Face / Edge /
  Vert BVH 별도 또는 통합.
- **ADR-109 (가칭)** — S3 Fine-grained dirty regions.
  `dirty_faces: HashSet<FaceId>` 기반 cache invalidation. Render
  pipeline 의 lazy rebuild.
- **ADR-110 (가칭)** — I2 Provenance / audit trail.
  `Option<CommandId>` per Edge/Face/Vertex, TransactionManager log 와
  link. 디버깅 + AI agent 의도 분석.

### Phase 2 (별도 결재) — Tier 2 architectural
- ADR-111 (가칭) — G1 Volume 1급화 (Three-Layer Citizenship volume
  case). multi-month, 사용자 결재 필수.
- ADR-112 (가칭) — G4 Wire/Point 1급화 또는 ADR-095 amendment.
- ADR-113 (가칭) — I1 Generic attribute system (Mesh-level Map type-
  safe abstraction).
- 기타 Tier 2 항목 — 수요 발생 시.

### Phase 3 (specialized) — Tier 3
- 명확한 user / industry demand 발생 시. 본 ADR 의 *roadmap reference*
  로 즉시 진입 가능.

---

## F. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| Survey completeness | 3 축 × 7 extension 각각 documented (G1~G7, S1~S7, I1~I7) |
| Cross-cut 정합 | 각 extension 의 ADR/LOCKED cross-link + invariant 보존 확인 |
| Tier 분류 | Tier 1/2/3 + Rejected 4 카테고리, 각 extension 배치 |
| Future plan | Phase 1 (Tier 1 batch ADR-108/109/110) + Phase 2/3 framework |
| 회귀 | 0 (spec only) |
| 코드 변경 | 0 (spec only) |

---

## G. Acceptance Log

### S-α (본 commit) — Survey + roadmap spec only

- **commit**: 본 commit
- **변경**: ADR draft 1 file (`docs/adr/107-dcel-extension-survey.md`)
- **회귀**: 0 (spec only)
- **코드 변경**: 0
- **다음**: 사용자 결재 후 Phase 1 (Tier 1 batch) 진입 가능.
  ADR-108/109/110 각각 별도 multi-week atomic. 또는 S1 단독, S3
  단독, I2 단독 etc. 사용자 우선순위 선택.

---

## H. Lessons (preliminary — Phase 1 closure 시 보완)

1. **3 축 framework 의 canonical 가치** — *generality / speed /
   information* 의 직교성 (orthogonality). 향후 모든 DCEL 확장 검토
   가 이 framework 정합 강제 — drift 차단.
2. **Tier 1 의 *engine internal* 특성** — 사용자 facing 동작 변경 0,
   위험 낮음, 가시 효과 큼. *infrastructure 강화* 의 자연 우선순위.
3. **메타-원칙 #4/#11/#12 의 자연 정합** — SSOT / Latency Budget /
   Memory Budget 이 모든 extension 의 *invariant check list*.
   향후 ADR 의 acceptance criteria 에 명시 강제 권장.

---

## I. Cross-link

- 메타-원칙 #4 (SSOT), #11 (Latency Budget), #12 (Memory Budget),
  #13 (One Source, Two Views), #14 (면은 닫힌 경계로부터 유도된다),
  #15 (Headless API ≡ Tool Path 의미 동등)
- ADR-027 (NURBS Kernel kickoff) — analytic geometry attach origin
- ADR-031/033 (Surface primitives + NURBS surfaces)
- ADR-049/050/095 (Three-Layer Citizenship — G1/G4 의 base)
- ADR-061 (cache LRU)
- ADR-088/093 (curve/surface owner-id Mesh-level maps)
- ADR-089 (closed-curve 시민권 — self-loop edge)
- ADR-091 §E L1 (Mesh-level Map canonical pattern)
- ADR-094 (Path B kernel-native cylinder)
- ADR-105/106 (closed-curve split + split-site owner-id)
- LOCKED #5 (1.5μm spatial hash), #1 (P7), #12 (P11), #16 (P23)
