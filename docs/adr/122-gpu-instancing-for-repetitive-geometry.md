# ADR-122 — GPU Instancing for Repetitive Geometry (α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — hotspot lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 KAYAC engine 검토 요청 → Claude audit + spec) |
| Anchor | KAYAC `documents/BoundingBox그리기 리뉴얼.txt` canonical pattern + AxiA hotspot audit |
| Cross-cut | ADR-111 α (BVH defer) — render hotspot 후속 / ADR-118 / ADR-120 답습 (α spec → β implementation atomic) / ADR-046 P31 (P1 + P3 가치) |

---

## 0. Summary

> KAYAC AI Studio (WGPU + Rust + WebAssembly) 의 *큰 파일 처리 핵심 기법* = **GPU Instancing** (단일 unit mesh + N instance buffer = 1 drawcall). 사용자 검토 요청 (`E:/KAYAC`) 으로 audit 한 결과, KAYAC 의 architectural value 가 AxiA 에 *Three.js InstancedMesh* / *LineSegments2* 활용으로 **WGPU 전환 없이도 90% 효과** 도입 가능 확인. 본 ADR 은 4 hotspot × 5 lettered options 매트릭스 결재 받음 → 채택된 sub-step 만 별도 atomic implementation PR. Multi-week scope, LOCKED #44 의미 단위 분할 강제.

---

## 1. Context

### 1.1 KAYAC 검토 결과 (canonical evidence)

`E:/KAYAC/native/rust/src/documents/BoundingBox그리기 리뉴얼.txt`:
> "10K objects 선택 시 BBox: **단일 유닛 박스 + 인스턴싱**. 인스턴스당 24B (center + halfExtents). 10K → 240KB/frame, 1 drawcall."

KAYAC 의 production-level pattern. `helper_line_draw_manager.rs:400+` 에서 `rpass.draw(0..4, 0..instances_count)` — 단 4 vertices (quad) + N instance count → N line segments = 1 drawcall.

### 1.2 AxiA 현재 hotspot audit

**Mesh / LineSegments 생성 위치 22 files** (web/src 전체):
- `import/StepIgesImporter.ts` — STEP face per `THREE.Mesh` × 각 face × 2 (front+back)
- `tools/BoxTool.ts` / `DrawRectTool.ts` / `DrawCircleTool.ts` — preview mesh
- `primitives/PrimitivePreviewManager.ts` — radius circle / height axis
- `tools/ClashDetection.ts` — collision visualization
- `viewport/SectionPlane.ts` / `ReferenceImage.ts` / `DraggableLabel.ts` — UI overlays
- `import/DxfSceneBuilder.ts` — DXF face per mesh

**현재 = 모든 mesh 별 drawcall** — 100+ primitives scene 에서 100+ drawcalls.

### 1.3 ADR-111 α (BVH defer) 와의 관계

ADR-111 α 가 BVH build 비용 145ms → 0 (RAF defer) 으로 click latency 해소. 본 ADR-122 는 *render-side throughput* 의 자연 후속 — drawcall overhead 해소. 두 ADR 모두 *큰 scene* 에 architectural value.

### 1.4 사용자 가치 anchor (ADR-046 P31)

- **P1 (건축/디자인)**: 100+ door/window/snap markers 가 즉시 응답 — production-grade architectural scene
- **P3 (AI 협업자)**: AI agent 가 batch primitive 생성 시 1000+ objects scene 안정 — automated workflow unlock

**Demo readiness**: 큰 scene (>100 primitives) FPS 개선 — 메모리 footprint 동일 but render time ↓.

---

## 2. AxiA Hotspot 매트릭스 (4 categories)

| Hotspot | 현재 (drawcall N) | Instancing 후 | 도입 risk | 사용자 가치 |
|---|---|---|---|---|
| **A — Selection BBox** (group select 시 N face outline) | N drawcalls | 1 (unit box + N instance) | 낮음 | 중간 (group selection UX) |
| **B — Snap markers** (vertex / midpoint / center / nearest 등 N markers) | N drawcalls (SnapVisual 2D canvas overlay) | N/A (현재 이미 2D canvas, GPU draw 아님) | — | — (이미 효율) |
| **C — Helper lines** (axis guides / dim lines / extension / parallel) | LineSegments2 별 drawcall | quad-instanced lines (KAYAC pattern) | 중간 (Line2 → quad-shader 변경) | 중간 |
| **D — Reference imported mesh** (STEP face × N, DXF entity × N) | N × 2 (front+back) Three.js Mesh | InstancedMesh group | 높음 (mesh metadata per-face) | **높음** (대용량 STEP/DXF unlock) |
| **E — Primitive preview** (rect/circle/arc 마우스 드래그 중) | Per-tool preview mesh | 단일 unit + dynamic update | 낮음 | 낮음 (이미 빠름) |
| **F — Construction lines / dimensions** (ADR-095 reference 시민권) | Line2 별 | quad-instanced | 중간 | 중간 |
| **G — Clash detection visualization** (collision pairs) | N pair × Mesh | InstancedMesh | 낮음 | 낮음 (rarely > 50 clashes) |

### 2.1 핵심 hotspot 우선순위

| 순위 | Hotspot | 근거 |
|---|---|---|
| **1st** | **D — Reference imported mesh** (STEP/DXF/SKP) | 대용량 vendor file 처리 — production-grade unlock |
| **2nd** | **A — Selection BBox** (group select) | UX 즉시 개선 (group select 즉시 응답) |
| **3rd** | **C — Helper lines** (axis / dim / guide) | medium frequency, medium gain |
| **4th** | **F — Construction lines** (ADR-095) | low frequency, medium gain |

---

## 3. Implementation Options Matrix

### 3.1 Three.js API 선택지

| API | scope | 적용 hotspot | maturity |
|---|---|---|---|
| `THREE.InstancedMesh` | mesh instancing (BoxGeometry / SphereGeometry 등) | A, D, E | stable since r110 |
| `THREE.InstancedBufferGeometry` | custom attribute instancing | C, F | stable |
| `LineSegments2 + LineSegmentsGeometry` (이미 사용) | thick lines, no instancing | (current state) | — |
| `GPU-instanced quad lines` (KAYAC pattern) | quad-shader line | C, F (replace LineSegments2) | manual shader |
| Custom InstancedBufferGeometry + WGSL/GLSL shader | full custom | A, D | high (full control) |

### 3.2 Path options (사용자 결재 결정 필요)

| Option | scope | 시간 | risk | 효과 |
|---|---|---|---|---|
| **α-1 A only — Selection BBox InstancedMesh** | ~150 LoC + 5 회귀 | 2-3일 atomic | 낮음 | group select 100+ objects 즉시 응답 |
| **α-2 D only — Reference imported mesh InstancedMesh** | ~300 LoC + 8 회귀 | 1주 atomic | 중간 (per-face metadata mapping) | 대용량 STEP/DXF unlock |
| **α-3 A + D 묶음 — UI critical + production-grade** | ~450 LoC + 13 회귀 | 1.5-2주 atomic | 중간 | 사용자 facing 큰 두 hotspot 동시 |
| **α-4 C only — Helper lines KAYAC pattern** | ~200 LoC + 6 회귀, shader 작성 | 1-2주 atomic | 중간 (custom shader) | 사용자 hover/snap 시 frame time 감소 |
| **α-5 4 hotspots 묶음 (A+C+D+F)** — full production-ready | ~900 LoC + 25 회귀 | 3-4주 multi-week | 높음 | KAYAC parity 달성 |
| **α-6 spec only (본 PR)** — implementation 0, lock-in 결재만 | docs only | 본 PR | 0 | 향후 atomic sub-step 의 anchor |

### 3.3 추천 매트릭스

| 추천 | Path | 근거 |
|---|---|---|
| **1st** | **α-1 (A only — Selection BBox)** | 단순/신속/정확 — 사용자 facing 즉시 효과, 2-3일 atomic, low risk |
| **2nd** | **α-3 (A + D 묶음)** | LOCKED #44 의미 단위 ("user-facing GPU instancing essentials"), 1.5-2주 atomic |
| **3rd** | **α-2 (D only)** | 대용량 STEP/DXF unlock 우선 시 |
| **4th** | **α-5 (4 hotspots)** | KAYAC parity 우선 시 |

---

## 4. 결재 트리거 (사용자 명시 선택 필요)

### 4.1 Q1 — Hotspot 선택

- **(a) α-1 — Selection BBox only** (default 추천)
- **(b) α-2 — Reference imported mesh only**
- **(c) α-3 — A + D 묶음**
- **(d) α-4 — Helper lines KAYAC pattern**
- **(e) α-5 — 4 hotspots 묶음 (full)**
- **(f) defer — 다른 priority 진입**

### 4.2 Q2 — Three.js API

- **(a) `InstancedMesh`** (default, Box/Sphere 등 standard geometry)
- **(b) `InstancedBufferGeometry`** (custom attribute)
- **(c) Custom shader** (KAYAC pattern 직접 답습)

### 4.3 Q3 — User-facing UX 변화

- 사용자 facing API 변경 0 (additive only, ADR-046 P31 #4 정합)
- Visual change 0 (same shape, different render path)
- 시각 quality 보존 (chord-tolerant tessellation 영향 0)

### 4.4 Q4 — Atomic 분할

- single PR (α-1 단독)
- α spec → β implementation seq (ADR-118 / ADR-120 답습)
- multi-week incremental (D → A → C → F sub-steps)

### 4.5 권장 default (사용자 별도 결정 시 채택)

- Q1: **(a) α-1 (Selection BBox)** — 가장 단순/신속/정확
- Q2: **(a) `InstancedMesh`** — standard, well-tested
- Q3: API surface unchanged, additive only
- Q4: single atomic PR

---

## 5. Lock-ins (canonical for whichever path chosen)

- **L-122-1** KAYAC pattern 답습 — single unit mesh + N instance buffer = 1 drawcall
- **L-122-2** Three.js native API 활용 (`InstancedMesh` / `InstancedBufferGeometry`) — WGPU 전환 없이 90% 효과
- **L-122-3** ADR-111 α (BVH defer) 답습 — render hotspot 의 자연 후속
- **L-122-4** ADR-046 P31 #4 additive only — 사용자 facing API 변경 0
- **L-122-5** 시각 quality 보존 — chord-tolerant tessellation 정합 (LOCKED #40)
- **L-122-6** Path B family DCEL invariant 정합 — InstancedMesh 가 faceMap / edgeMap 영향 0 (render-only)
- **L-122-7** ADR-087 K-ζ canonical 사용자 시연 게이트 — implementation 후 100+ primitives stress test
- **L-122-8** 절대 #[ignore] 금지

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **WGPU 전환** (Three.js → WebGPU) — KAYAC architecture full mirror. multi-month, 별도 architectural ADR
- **Web Worker mesh processing** (Rayon 대안) — ADR-122 와 직교, 별도 ADR
- **Custom OCCT build** (STEP timing γ-6) — ADR-118 §2 후속
- **Persistent module cache γ-2** — ADR-118 §2 후속
- **Service worker** WASM streaming — γ-1-explicit ADR

---

## 7. 사용자 facing 매트릭스 예측 (Path 별)

| Scenario | Before | After α-1 | After α-3 (A+D) | After α-5 (4 hotspots) |
|---|---|---|---|---|
| 100 box scene group select | 100 BBox drawcalls | **1 drawcall** | 1 | 1 |
| STEP 500-face import | 1000 drawcalls (front+back) | 1000 (D 미적용) | **2 drawcalls** | 2 |
| Hover with 50 snap markers | 50 canvas paints (already 2D) | 50 | 50 | (B not applicable — already 2D) |
| Helper line 활성 (axis + dim) | 5-10 LineSegments2 | 5-10 | 5-10 | **1 (instanced quad)** |
| Frame time @ 1000 primitives | 100-150ms | 50-70ms | 30-50ms | **15-25ms** |

---

## 8. Cross-link

- KAYAC `documents/BoundingBox그리기 리뉴얼.txt` — canonical pattern source
- KAYAC `helper_line_draw_manager.rs:400+` — `rpass.draw(0..4, 0..instances_count)` evidence
- ADR-111 α (BVH defer) — render hotspot 의 자연 anchor
- ADR-118 / ADR-120 (α spec → β impl atomic pattern)
- ADR-035 P20.C #2 (initial bundle 0MB strict) — 본 ADR 도 동일 strict 유지
- ADR-046 P31 (P1 + P3 두 페르소나 가치 anchor)
- ADR-046 P31 #4 (additive only)
- ADR-087 K-ζ (사용자 시연 게이트 canonical)
- LOCKED #40 (chord_tol render quality 보존)
- LOCKED #43 priority audit (본 ADR 은 priority #4 와 직교 — 별도 architectural value)
- LOCKED #44 (Complete Meaning per Merge — α spec → β impl atomic)

---

## 9. 결재 요청

본 spec only PR (α). 사용자 결재 후 채택된 Path 만 별도 atomic sub-step PR 진행.

**Q1 Path 선택** + Q2-Q4 default 채택 여부 명시 부탁드립니다.

권장 default 요약:
- Q1: **(a) α-1 (Selection BBox)** — 단순/신속/정확, 2-3일 atomic
- 대안: **(c) α-3 (A + D)** — 사용자 facing 큰 두 hotspot 동시
- Q2-Q4: default 채택 (`InstancedMesh`, additive only, single PR)

> **⚠️ Amendment 1 (2026-05-17) — α-1 가정 무효, α-2 가 진짜 hotspot. §Amendment 1 참조.**

---

## Amendment 1 — Current State Correction (2026-05-17, ADR-125 audit closure)

**상태**: ADR-122 spec 본문 (§§1~9) 보존, 본 amendment 만 추가.
**Trigger**: ADR-125 pre-implementation audit (`SelectionManager.ts` 측정).
**사용자 결재**: 2026-05-17, "C → A 순차 — 가장 단순/신속/정확 승인합니다".

### A1.1 §2 hotspot 매트릭스 정정 (canonical truth)

ADR-122 §2 의 **A hotspot 가정 무효화** + **D hotspot 재확인**:

| Hotspot | §2 spec 가정 | 실측 (audit 2026-05-17) | 상태 |
|---|---|---|---|
| **A — Selection BBox** | "N drawcalls" | **1 drawcall** (merged LineSegments per type) | ❌ **가정 무효** |
| B — Snap markers | (이미 2D canvas) | 0 GPU drawcalls | ✅ 정합 |
| C — Helper lines | LineSegments2 별 drawcall | 1-5 per type | ⚠️ medium gain |
| **D — Reference imported mesh** | N × 2 (front+back) | **N × 2 (STEP 500 face = 1000 drawcalls)** | ✅ **진짜 hotspot 확인** |
| E — Primitive preview | Per-tool preview mesh | 1 (이미 single mesh) | ❌ 이미 optimal |

**Architectural reason** (A 가정 무효 사유): `SelectionManager.ts:1124` `rebuildSelectionMesh()` + `SelectionManager.ts:1851` `rebuildGroupOutlines()` 가 ADR-074 (2026-05-05) 시점에 *type-level merged geometry* 패턴 채택. ADR-122 §2 작성 시점 (2026-05-17) 에 이 implicit optimization 이 audit 누락. 자세히는 ADR-125 §2.1~2.2.

### A1.2 추천 순위 정정 (canonical)

| 추천 | 이전 (§2.1) | 이후 (Amendment 1) | 사유 |
|---|---|---|---|
| **1st** | α-1 (Selection BBox) | **α-2 (Reference imported mesh)** | 진짜 N-drawcall hotspot (audit confirmed) |
| **2nd** | α-3 (A + D 묶음) | α-2 단독 (먼저) → α-4 (Helper lines) 후속 | A 가정 무효, D 만 유효 |
| **3rd** | α-2 (D only) | α-4 (Helper lines KAYAC pattern) | D 후 medium-gain hotspot |
| **4th** | α-5 (4 hotspots) | (현재 priority 없음) | A 무효로 묶음 의미 감소 |

### A1.3 α-1 status — preserved (NOT superseded)

본 amendment 는 α-1 spec 을 *supersede 하지 않음*. 보존 사유:
- 향후 selection > 1000 faces 시 CPU rebuild perf 가 문제될 가능성 (ADR-125 §2.4)
- 그 trigger 시 α-1 의 "InstancedMesh 로 CPU rebuild → GPU instance matrix" 가 valid path 가능
- 부정 결정 lock-in (ADR-125 §3.2) — silent 거부 회피, *명시 documented*

### A1.4 ADR-123 Q2 default 재해석

ADR-123 §3.2 Q2 default ("ADR-123 D 먼저 → ADR-122 α-1 후속") 가 본 amendment 후:
- **재해석**: "ADR-123 D (ADR-124) 먼저 → ADR-122 **α-2** 후속" (별도 ADR-126 가칭, ADR-125 §3.3 anchor)
- ADR-123 본문은 *변경 없음* — Q2 default 의 의미가 audit 후 재해석.

### A1.5 회귀 / 산출물

- 본 amendment: docs only, 회귀 0
- ADR-125: docs only, 회귀 0
- ADR-126 (가칭, 후속): β implementation 시 별도 회귀 (회귀 명세는 ADR-126 작성 시 lock-in)

### A1.6 Cross-link (Amendment 1)

- **ADR-125** — 본 amendment 의 직접 trigger (audit closure ADR)
- **ADR-074** — type-level merged geometry pattern source (implicit optimization)
- **ADR-077 V-2** — visual baseline 가드 (α-1 강행 거부 사유)
- **ADR-123** — Q2 default 재해석 anchor

---

## Amendment 2 — α-2 API Choice Correction (2026-05-17, ADR-126 β implementation)

**상태**: ADR-122 spec 본문 (§§1~9) + Amendment 1 보존. 본 amendment 만 추가.
**Trigger**: ADR-125 §3.3 후속 — Step A 진입 사전 검토에서 추가 audit finding.
**사용자 결재**: 2026-05-17, "네 승인합니다" (Option A — Merged BufferGeometry, ADR-126 β single atomic PR).

### A2.1 §A1.2 α-2 implementation API 정정

α-2 ("Reference imported mesh InstancedMesh") wording 의 architectural reality 정정:

| 측면 | §3.1 §A1.2 spec wording | Audit finding (2026-05-17) |
|---|---|---|
| API | "InstancedMesh" | **InstancedMesh = "draw same geometry N times"** — STEP face 의 *각자 다른 polygon geometry* 와 부적합 |
| 진짜 적합 API | — | **Merged BufferGeometry** (모든 face geometry 를 single BufferGeometry 로 concat, 2 Mesh share) |
| 대안 검토 | — | BatchedMesh (Three.js r155+) — 향후 per-instance matrix 필요 시; 현재 Option I 가 minimum risk |

### A2.2 추천 매트릭스 정정 (canonical)

| 추천 | §A1.2 wording | 이후 (Amendment 2) | 사유 |
|---|---|---|---|
| **α-2 implementation API** | "Reference imported mesh InstancedMesh" | **Merged BufferGeometry pattern** (Option I) | per-face geometry variability 정합 |
| **2nd alternative** | — | BatchedMesh (Option II) | per-instance matrix 또는 visibility 필요 시 향후 ADR |

### A2.3 ADR-126 β implementation 명시 (canonical)

ADR-126 β implementation 채택:
- N face Group{front+back Mesh} → 2 Mesh (faces-front + faces-back) sharing merged BufferGeometry
- Per-face metadata → side-table `Map<faceIndex, FaceMetadata>` (with vertStart/vertCount/indexStart/indexCount for future per-face picking)
- Drawcalls: N×2 → 2 (e.g., STEP 500 face: 1000 → 2 = **500× 감소**)
- Edges sub-group (ADR-084 E-γ) UNCHANGED
- ADR-077 V-2 visual baseline 변경 0 (render output 동일)
- Vitest +1 (1916 → 1917), cargo UNCHANGED

### A2.4 InstancedMesh wording 보존 사유

ADR-122 spec §A1.2 의 `α-2 (Reference imported mesh InstancedMesh)` wording 은 **보존** (supersede 아님):
- 향후 selection > 1000 instances + 동일 geometry pattern (예: snap markers, helper unit boxes) 시 *진짜* InstancedMesh 사용 가능
- 본 amendment 는 *α-2 의 implementation API 선택* 만 명시 (intent = drawcall reduction 보존)

### A2.5 회귀 / 산출물

- 본 amendment: docs only, 회귀 0
- ADR-126: vitest +1 (graceful guard test), cargo UNCHANGED
- ADR-077 V-2 visual baseline UNCHANGED

### A2.6 Cross-link (Amendment 2)

- **ADR-126** — 본 amendment 의 implementation (Merged BufferGeometry pattern)
- **ADR-125** — audit-first canonical pattern source (L-125-1)
- **ADR-074** — merged-geometry-per-type pattern source (architectural inspiration)
- **ADR-018** — two-tone front/back (preserved)
- **ADR-077 V-2** — visual baseline 가드 (변경 0)
- **ADR-083 T-γ** — `_faceToMesh` 폐지 source (ADR-126 _mergeFacesIntoSingleGeometry 로 대체)
- **ADR-084 E-γ** — edges sub-group preserved
- **ADR-086 O-δ** — DCEL injection side-table refactor

---

## Amendment 3 — α-4 Helper Lines Audit Closure (2026-05-17, ADR-127 pivot)

**상태**: ADR-122 spec 본문 (§§1~9) + Amendment 1 + Amendment 2 보존. 본 amendment 만 추가.
**Trigger**: ADR-126 closure 후 ADR-123 Q2 default 정합으로 α-4 audit 진입. ADR-125 L-125-1 audit-first canonical 3번째 적용.
**사용자 결재**: 2026-05-17, "승인합니다" (Option A — 순수 audit closure ADR-127, ADR-125 답습).

### A3.1 §2 hotspot C 매트릭스 정정 (canonical truth, 3번째)

ADR-122 §2 hotspot C ("Helper lines") 가정의 audit 결과:

| Hotspot C source | §2 spec 가정 | Audit finding (2026-05-17) | 상태 |
|---|---|---|---|
| **SnapVisual** (snap guides) | "LineSegments2 별 drawcall" | **Canvas 2D 1 stroke per guide** | ❌ **3D 안 씀 — 가정 무효** |
| **DimensionLabel** (dim ticks) | LineSegments | **Canvas 2D N strokes** | ❌ **3D 안 씀 — 가정 무효** |
| **DrawPlaneIndicator** (axis gizmo) | "1 LineSegments per axis" | **3 separate `THREE.Line`** | ⚠️ marginal hotspot (2 drawcalls 절감 가능) |
| Viewport overlays (non-manifold / free edge) | not classified | `LineSegments2` (fast path) | ✅ 이미 fast |
| PrimitivePreview (radius/height) | not classified | 1-2 LineSegments per tool | ✅ lightweight |

**Architectural reason** (hotspot C 가정 largely 무효 사유): AxiA 의 SnapVisual + DimensionLabel 가 **2D Canvas overlay** 패턴 채택 — Three.js 3D scene 위에 별도 2D layer 로 helper 표시. 3D LineSegments 자체 사용 안 함 → drawcall hotspot 자연 부재. 자세히는 ADR-127 §2.1~2.2.

### A3.2 추천 매트릭스 정정 (canonical, 3번째 갱신)

| 추천 | Amendment 1 (이전) | 이후 (Amendment 3) | 사유 |
|---|---|---|---|
| **1st** | α-2 (Reference imported mesh) | α-2 (ADR-126 β implementation 완료) ✅ | ADR-126 closure |
| **2nd** | α-2 → α-4 순차 | **deprecation (α-4 무효)** | ADR-127 audit closure |
| **3rd** | α-4 (Helper lines KAYAC pattern) | **deprecated** | hotspot C 가정 largely 무효 |
| **4th** | (현재 priority 없음) | **deprecated** (α-3 / α-5 묶음 자연 deprecation) | A + C 가정 모두 무효 → 묶음 의미 감소 |

### A3.3 α-4 status — preserved (NOT superseded)

본 amendment 는 α-4 spec 을 *supersede 하지 않음*. 보존 사유:
- 향후 multi-tool 동시 활성 시점 (예: AI agent 가 10+ DrawPlaneIndicator 동시 활성) 시 *marginal merge* 가치 발생 가능
- DrawPlaneIndicator 3-Line → 1 LineSegments merge 가 valid path 가능
- 부정 결정 lock-in (ADR-127 §3.2) — silent 거부 회피, 명시 documented
- ADR-125 §A1.3 (α-1 preservation) + ADR-126 Amendment 2 §A2.4 (α-2 InstancedMesh wording 보존) 답습 — 3번째 적용

### A3.4 ADR-122 family 자연 closure

Amendment 1 + 2 + 3 누적으로 ADR-122 §2 hotspot 매트릭스 전체 closure:

| Hotspot | §2 가정 | Audit truth | Status | Closure ADR |
|---|---|---|---|---|
| A — Selection BBox | N drawcalls | 1 (merged per type) | ❌ 가정 무효 | **Amendment 1** (ADR-125) |
| B — Snap markers | 2D canvas | 0 GPU drawcalls | ✅ 정합 | (audit only) |
| **C — Helper lines** | **N drawcalls** | **Canvas 2D + 1-3 fixed** | ❌ **가정 largely 무효** | **Amendment 3** (ADR-127) |
| **D — Reference imported mesh** | N × 2 | N × 2 | ✅ **진짜 hotspot** | **Amendment 2 + β** (ADR-126) |
| E — Primitive preview | per-tool | 1 (이미 single) | ❌ 이미 optimal | (audit only) |
| F — Construction lines | N drawcalls | (future audit 필요) | (deferred) | future ADR |
| G — Clash detection | N drawcalls | rarely > 50 | (low priority) | future ADR |

**핵심 finding**: 7 hotspots 중 **단 1 (D)** 만 진짜 N-drawcall hotspot. ADR-126 가 그 single hotspot 해소. ADR-122 family 의 architectural value 가 *audit-first canonical 패턴 정착* 으로 발현 (3 finding pivots).

### A3.5 회귀 / 산출물

- 본 amendment: docs only, 회귀 0
- ADR-127: docs only, 회귀 0
- ADR-077 V-2 visual baseline UNCHANGED

### A3.6 Cross-link (Amendment 3)

- **ADR-127** — 본 amendment 의 직접 trigger (audit closure ADR)
- **ADR-125 / ADR-126** — audit-first canonical pattern source (1번째 / 2번째 success)
- **ADR-074** — type-level merged geometry pattern source (implicit optimization)
- **ADR-046 P31 #1** "가볍게" (DrawPlaneIndicator merge marginal gain 거부 사유)
- **ADR-046 P31 #4** additive only
- **ADR-076 §C-amendment-1** — 부정 결정 명시 lock-in 패턴 source (3번째 답습)
