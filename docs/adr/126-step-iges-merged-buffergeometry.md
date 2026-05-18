# ADR-126 — STEP/IGES Merged BufferGeometry (β implementation of ADR-122 α-2 pivot)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β implementation single atomic PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "C → A 순차" + "네 승인합니다" Option A 채택) |
| Anchor | ADR-125 audit closure + ADR-122 Amendment 2 — 진짜 N-drawcall hotspot (STEP face × Mesh × 2) 본질 해소 |
| Parent | ADR-122 α-2 (Reference imported mesh, Amendment 2 pivot from "InstancedMesh" to "Merged BufferGeometry"), ADR-125 (audit closure + pivot anchor) |
| Cross-cut | ADR-018 (two-tone front/back), ADR-046 P31 #4 (additive only), ADR-077 V-2 (visual baseline 보존), ADR-083 T-γ (per-face Mesh — replaced), ADR-084 E-γ (edge LineSegments — preserved), ADR-086 O-δ (DCEL injection — side-table refactor) |

---

## 1. Canonical Anchor

ADR-125 audit closure 후 사용자 결재:
> "C → A 순차 — 가장 단순/신속/정확 승인합니다" (2026-05-17, ADR-125 audit findings 보고 후)
> "네 승인합니다" (2026-05-17, ADR-126 Option A 결재 — Merged BufferGeometry)

**Pivot anchor (ADR-125 + ADR-122 Amendment 2)**: ADR-122 α-2 spec wording `InstancedMesh` 가 STEP face 의 *각자 다른 polygon geometry* 와 부적합 (InstancedMesh = "draw same geometry N times"). Audit-first canonical (ADR-125 L-125-1) 정합 → 진짜 적합 API 는 **Merged BufferGeometry** (Option I).

**Architectural goal**: STEP/IGES import 의 *per-face Mesh × 2* 패턴을 *single merged BufferGeometry + 2 Mesh* 패턴으로 collapse. 사용자 facing render 결과 동일, drawcalls N×2 → 2 감소 (e.g., STEP 500 face: 1000 → 2 = **500× 감소**).

---

## 2. Change Summary

### 2.1 `web/src/import/StepIgesImporter.ts` refactor

**Before** (per ADR-083 T-γ):
```
importGroup (`STEP: file.step`)
├─ face-0 (Group, userData: { faceIndex, surface, boundaryPolygon, axiaFaceId })
│   ├─ face-0-front (Mesh, frontMat, FrontSide)  ← drawcall #1
│   └─ face-0-back  (Mesh, backMat, BackSide)   ← drawcall #2
├─ face-1 (Group)
│   ├─ face-1-front  ← drawcall #3
│   └─ face-1-back   ← drawcall #4
└─ edges (Group)
    ├─ edge-0 (LineSegments)
    └─ ...
```
N face = **2N Mesh drawcalls + N face-Group**.

**After** (ADR-126 β):
```
importGroup (`STEP: file.step`)
├─ faces-front (Mesh, frontMat, FrontSide, MERGED geometry)  ← drawcall #1
├─ faces-back  (Mesh, backMat, BackSide, MERGED geometry)    ← drawcall #2
├─ edges (Group)  [ADR-084 E-γ — UNCHANGED]
│   ├─ edge-0 (LineSegments)
│   └─ ...
└─ userData.faceMetadata: Map<faceIndex, FaceMetadata>  ← side-table
```
N face = **2 Mesh drawcalls + side-table** (front + back share merged geometry).

### 2.2 Per-face metadata side-table

```ts
export interface FaceMetadata {
  faceIndex: number;        // W-δ stable index
  surface?: SurfacePromotion;
  boundaryPolygon?: Float32Array;  // ADR-086 O-δ
  axiaFaceId?: number;             // populated by injectIntoAxia
  vertStart: number;        // range in merged BufferGeometry
  vertCount: number;
  indexStart: number;
  indexCount: number;
}
```

Storage: `importGroup.userData.faceMetadata: Map<faceIndex, FaceMetadata>` — single shared side-table on parent Group. `vertStart`/`vertCount`/`indexStart`/`indexCount` 추가 → 향후 per-face picking via geometry sub-range 가능.

### 2.3 New helper: `_mergeFacesIntoSingleGeometry`

`StepIgesImporter._faceToMesh` 폐지 → `_mergeFacesIntoSingleGeometry(faces, warnings)` 신규:
1. First pass: count totals + filter valid + detect zero-fill normals
2. Allocate merged `Float32Array(totalVerts × 3)` × 2 (positions/normals) + `Uint32Array(totalIndices)`
3. Per-face copy: positions/normals 직접 복사, indices `+ vertOffset` rebase
4. Side-table 동시 build
5. `computeVertexNormals()` fallback if any face had zero-fill (matches legacy semantics)
6. `Uint32Array` index — safe for >65K vertices (typical STEP scenes)

### 2.4 `injectIntoAxia` refactor

- 기존: `group.children.filter(c => c.name.startsWith('face-'))` → per-face Group userData 읽음
- 신규: `group.userData.faceMetadata.entries()` 순회 → side-table 직접 사용
- `axiaFaceId` 저장 site: `faceGroup.userData.axiaFaceId` → `meta.axiaFaceId` (side-table entry)
- **New graceful path**: side-table 부재 (legacy / non-ADR-126 group) → 명시 warning 반환

### 2.5 Edges sub-group **UNCHANGED**

ADR-084 E-γ per-edge `LineSegments` 패턴 보존 (L-126-5):
- Edge count 는 보통 face count 보다 적음 (예: cube = 6 face, 12 edge — 비율 2:1)
- Per-edge hover/selection 이 entity-level 가치 (ADR-088 multi-segment edge 인프라 정합)
- Drawcall reduction priority 가 낮음 (별도 ADR 시 다룸)

### 2.6 Tests refactor

- **14 unit tests** (`StepIgesImporter.test.ts`) — 12 updated + 1 new
  - `_convertToThreeGroup` happy path + multi-face: check `faces-front`/`faces-back` Mesh + `userData.faceMetadata` Map (replace per-face Group child assertions)
  - E-γ edges tests: child count `1` → `2` (faces-front+back), check edges sub-group still present
  - `injectIntoAxia` tests: new `makeGroupWithMetadata` helper builds side-table, all 6 tests adapted
  - **NEW** "ADR-126 β: missing faceMetadata side-table → graceful warning" (defense-in-depth)
- **1 e2e test** (`web/e2e/occt-roundtrip.spec.ts`) — `childNames.includes('faces-front'/'faces-back')` + `faceMetadataSize` + `firstFaceAxiaId from side-table` invariants

---

## 3. Lock-ins (canonical, L-126-1 ~ L-126-9)

- **L-126-1** **Merged BufferGeometry pattern over InstancedMesh** — STEP face 의 per-face geometry variability 와 정합. InstancedMesh literal 사용은 거부 (ADR-122 Amendment 2 confirmed).
- **L-126-2** Per-face metadata → side-table (`group.userData.faceMetadata: Map<faceIndex, FaceMetadata>`) — single SSOT, per-face Three.js Object 폐지.
- **L-126-3** Side-table entry includes `vertStart`/`vertCount`/`indexStart`/`indexCount` — 향후 per-face picking via geometry sub-range 가능 (현재 hover/selection 은 `faceMap` Uint32Array 활용, ADR-122 audit Section 4 정합).
- **L-126-4** Front + back Mesh **share** the same merged BufferGeometry (ADR-018 two-tone preserved, 메모리 footprint 동일).
- **L-126-5** Edges sub-group (ADR-084 E-γ) UNCHANGED — per-edge `LineSegments` 패턴 보존 (entity-level hover/selection 가치).
- **L-126-6** `Uint32Array` index — safe for >65K vertices (typical STEP scenes 의 large mesh).
- **L-126-7** ADR-077 V-2 visual baseline 변경 0 — render output 동일 (동일 geometry vertices/normals, drawcalls only 감소).
- **L-126-8** ADR-086 O-δ DCEL injection 정합 — side-table refactor 의 새 graceful path 추가, surface dispatch + Plane basis_u 계산 UNCHANGED.
- **L-126-9** 절대 #[ignore] 금지.

---

## 4. 회귀 매트릭스 (실측)

| Layer | Before (per LOCKED #55) | After ADR-126 β | Delta |
|---|---|---|---|
| **vitest** | 1916 passed / 1 skipped | **1917 passed** / 1 skipped | **+1** (graceful guard test 추가) |
| `StepIgesImporter.test.ts` | 26 tests | **27 tests** | +1 |
| **axia-geo** (cargo) | 1392 | 1392 | UNCHANGED |
| **axia-core** (cargo) | 302 | 302 | UNCHANGED |
| **axia-wasm** (cargo) | 0 (cdylib only) | 0 | UNCHANGED |
| Playwright E2E | 15+ | 15+ (occt-roundtrip slow channel 미실행, opt-in) | UNCHANGED (count) |
| ADR-077 V-2 visual baselines | 3 baselines (group A/B outline) | 3 baselines | UNCHANGED (visual output 동일) |
| Initial bundle | 724.99 kB (LOCKED #54) | 724.99 kB | UNCHANGED (P20.C #2 strict 유지) |

**합계 +1 회귀** (절대 #[ignore] 금지 1/1 준수).

### 4.1 Drawcall reduction 예측

| Scene size | Before (N face × 2) | After (faces-front + faces-back) | 감소율 |
|---|---|---|---|
| STEP cube (6 face) | 12 drawcalls | **2** | **6× ↓** |
| STEP 50-face | 100 drawcalls | **2** | **50× ↓** |
| STEP 500-face | 1000 drawcalls | **2** | **500× ↓** |
| STEP 5000-face | 10000 drawcalls | **2** | **5000× ↓** |

Edges sub-group drawcalls = unchanged (E-γ entity-level 보존).

### 4.2 Memory footprint

| | Before | After | Note |
|---|---|---|---|
| Total vertex count | N × per-face | Same total | 정확히 동일 (concat) |
| Total triangle count | N × per-face | Same total | 정확히 동일 |
| BufferGeometry count | N | 1 (shared) | **N× 감소** (메모리 절감) |
| Mesh object count | N × 2 | 2 | **N× 감소** |
| Material count | 2 (frontMat/backMat shared) | 2 | UNCHANGED |

**Net memory**: BufferGeometry overhead per-instance × N → single BufferGeometry → 의미 있는 메모리 절감 (특히 1000+ face 시).

---

## 5. Out of Scope (별도 ADR per LOCKED #44)

- **Edges InstancedMesh** — Per-edge LineSegments 폐기 → InstancedMesh lines (KAYAC quad pattern 답습) — 별도 ADR 시 (ADR-122 §C hotspot — medium priority)
- **Per-face picking via geometry sub-range** — `faceMetadata.vertStart/vertCount` 활용한 per-face highlight (`BufferGeometry.addGroup` + material slot 또는 hit testing via face range index) — 별도 future ADR
- **STEP front+back two-tone via volumeFlags** — ADR-018 의 "closed solid wall vs open mesh sheet" per-face classification — 별도 future ADR
- **BatchedMesh (Three.js r155+) 도입 평가** — 향후 per-instance matrix 또는 per-instance visibility 필요 시 — 별도 audit ADR
- **Per-face geometry update (편집 후 in-place)** — 현재 import-time 만 merged; 편집 후 변경 face 별 sub-range update — 별도 ADR (ADR-111 β delta buffer Phase 2 와 cross-cut)

---

## 6. Cross-link

- **ADR-122** — α spec (Amendment 2 추가 — InstancedMesh → Merged BufferGeometry pivot lock-in)
- **ADR-125** — audit closure ADR (본 ADR 의 architectural anchor — pivot decision 명시 lock-in)
- **ADR-123** — Q2 default 재해석 ("ADR-122 α-1 후속" → "ADR-122 α-2 후속")
- **ADR-124** — 직전 closure (engine-side SIMD), 본 ADR 은 render-side β implementation
- **ADR-083 T-γ** — `_faceToMesh` 폐지 source (Merged BufferGeometry 로 collapse)
- **ADR-084 E-γ** — edges sub-group **preserved** (L-126-5 의 architectural decision)
- **ADR-086 O-δ** — DCEL injection (side-table refactor + 새 graceful path 추가)
- **ADR-074** — group outline merged geometry pattern (architectural inspiration for merged-geometry-per-type pattern)
- **ADR-077 V-2** — visual baseline 보존 (L-126-7)
- **ADR-046 P31 #4** — additive only (사용자 facing API + 시각 output UNCHANGED)
- **ADR-018** — two-tone front/back (front mat #e8e8e8 + back mat #9898b4, preserved)
- **ADR-088** — multi-segment edge owner-id grouping (edges sub-group 보존 정합)
- **LOCKED #44** — Complete Meaning per Merge (single atomic PR per LOCKED #44)
- **LOCKED #55** — ADR-125 audit closure + ADR-122 Amendment 1 (본 ADR 의 직접 anchor)
- **LOCKED #56** (본 PR) — ADR-126 β implementation closure

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| Refactor `_convertToThreeGroup` → `_mergeFacesIntoSingleGeometry` | ✅ | merged BufferGeometry + side-table |
| Refactor `injectIntoAxia` to use side-table | ✅ | reads `userData.faceMetadata`, writes `meta.axiaFaceId` |
| Add `FaceMetadata` interface export | ✅ | typed side-table entry |
| Update 14 unit tests + add 1 graceful guard test | ✅ | 27 tests pass (was 26) |
| Update e2e occt-roundtrip.spec.ts invariants | ✅ | `childNames`/`faceMetadataSize`/`firstFaceAxiaId` from side-table |
| TypeScript typecheck | ✅ | no errors |
| Vitest full suite | ✅ | 1917 passed (+1) / 1 skipped / 0 failed |
| Native cargo (axia-core / axia-geo / axia-wasm) | ✅ | 302 / 1392 / 0 UNCHANGED |
| ADR-122 Amendment 2 추가 | ✅ | `docs/adr/122-*.md` Amendment 2 section |
| CLAUDE.md LOCKED #56 entry | ✅ | LOCKED #56 |

---

## E. Lessons (canonical for future Three.js merged-geometry ADRs)

- **L-126-α-1 — 사전 audit 의 architectural value (3번째 적용)**: ADR-122 α-1 pivot (ADR-125), ADR-122 α-2 wording pivot (본 ADR), 두 audit-first 발견 모두 silent 강행 회피. *ADR-125 L-125-1 의 검증* — pre-implementation audit canonical 이 *체계적 패턴* 으로 정착. 향후 모든 α spec → β impl 진입 시 audit 우선 강제 권장.
- **L-126-α-2 — Three.js API 정확성**: spec wording (특히 5개월 누적 ADR 의 옛 표기) 가 기술적으로 부정확할 수 있음. *intent* (drawcall reduction) 와 *mechanism* (InstancedMesh vs Merged BufferGeometry vs BatchedMesh) 의 분리 — 본 ADR 에서 처음 명시. 향후 architectural ADR 의 implementation 결정 시 *Three.js API surface audit* 우선 권장.
- **L-126-α-3 — Side-table pattern canonical**: per-face Three.js Object 폐지 + `Map<id, Metadata>` side-table 이 *render-perf 와 metadata-access 동시 해소*. ADR-074 group outline merged geometry pattern (per-group merged + boundary BFS) 의 자연 진화 — 향후 다른 per-instance metadata 패턴 (예: Helper lines per-axis, snap markers per-type) 도 동일 답습 권장.
- **L-126-α-4 — Vertex offset rebase**: per-face indices 의 `+ vertOffset` rebase 가 merged geometry 의 핵심 mechanic. `Uint32Array` index (vs `Uint16Array`) 가 large mesh 정합 — 향후 InstancedMesh / BatchedMesh ADR 시에도 동일 고려 필요.
- **L-126-α-5 — Spec preservation pattern 적용 (ADR-122 Amendment 2)**: ADR-122 α-2 spec 자체는 supersede 하지 않고 Amendment 2 추가 (ADR-125 §A1.3 패턴 답습). InstancedMesh wording 의 보존 + Merged BufferGeometry pivot 명시 — 향후 selection > 1000 faces 시 InstancedMesh 변형 trigger 가능 시 context 보존.
