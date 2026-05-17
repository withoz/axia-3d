# ADR-123 — AxiA-Native Optimization Audit (α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — option lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 자기-내성 질문 → Claude audit + spec) |
| Anchor | 사용자 질문 (2026-05-17): *"우리 엔진 자체 내에서 해결방법은 없는지요?"* — KAYAC GPU instancing 검토 (ADR-122) 후 AxiA 자체 architectural 자산 활용 가능성 검토 요청 |
| Cross-cut | ADR-122 (KAYAC GPU instancing — *외부 패턴 도입* 의 자연 대비), ADR-111 α (BVH defer — *내부 자산 활용* 의 선행 사례), ADR-118 / ADR-120 / ADR-122 답습 (α spec → β implementation atomic) / ADR-046 P31 (P1 + P3 가치) |

---

## 0. Summary

> ADR-122 가 *KAYAC 외부 패턴 (WGPU GPU instancing)* 도입 검토 라면, ADR-123 은 사용자 질문 *"우리 엔진 자체 내에서 해결방법은 없는지요?"* 의 architectural answer. AxiA 의 5개월 누적 자산 (ADR-031 AnalyticSurface / ADR-088 owner-id / ADR-091 Mesh-level Map / ADR-104 Path B family / ADR-111 α defer 등) 을 *외부 의존 없이* 활용해 큰 scene 성능을 개선하는 10 lettered options 매트릭스. WGPU 전환 / Three.js InstancedMesh 도입 (ADR-122) 과 직교 — 사용자가 두 ADR 중 어느 path 우선 또는 병행 진행 결재. Multi-week scope, LOCKED #44 의미 단위 분할 강제.

---

## 1. Context

### 1.1 사용자 질문 (canonical anchor)

ADR-122 KAYAC GPU instancing 검토 직후 (2026-05-17):

> **사용자**: "우리 엔진 자체 내에서 해결방법은 없는지요?"

KAYAC 의 WGPU + GPU instancing 패턴은 architecturally 강력하지만 **AxiA 의 5개월 누적 자산** 도 동등하거나 더 큰 성능 unlock 가능성 존재. 본 ADR 은 *외부 패턴 도입 대신* 또는 *병행 진행 시* 의 AxiA-native 옵션 audit.

### 1.2 AxiA 5개월 architectural 자산 audit

| 자산 | 출처 ADR | 활용 가능성 |
|---|---|---|
| **AnalyticSurface** (Plane/Cylinder/Sphere/Cone/Torus + 3 NURBS) | ADR-031 Phase D / ADR-033 Phase E | Surface deduplication — 같은 kind+params 의 face 들이 tessellation 공유 |
| **face_to_surface_owner_id Map** | ADR-093 D-β / LOCKED #33 | Surface 그룹화 — owner_id 별 한번만 tessellate + N face 가 공유 |
| **Path B kernel-native** (cylinder/sphere/cone/torus) | ADR-094/113/114/115 | 1 anchor + 1 self-loop edge + 1-3 face 의 canonical form — *자연 instancing* 후보 |
| **Mesh-level HashMap canonical** | ADR-091 §E L1 | Struct field 추가 없이 추가 데이터 attach 가능 (snapshot 호환 보존) |
| **Delta buffer Phase 1** | 2026-04-13 commit / LOCKED #40 | translate/rotate/scale 만 in-place 패치 — create/Boolean 은 full rebuild |
| **BVH lazy rebuild (ADR-111 α)** | ADR-111 | RAF defer 패턴 — 다른 syncMesh 내부 작업에도 답습 가능 |
| **Render chord_tol (LOCKED #40)** | LOCKED #40 §L1 | Render-only chord_tol 분리됨 — distance-based LOD 자연 확장 가능 |
| **tessellate_face_surface API** | ADR-031 Phase D | Surface metadata 기반 tessellation — 결과 caching 미구현 |
| **WASM `--target web` build** | wasm-pack default | SIMD target-feature 미활성 (audit 결과 confirmed) |

### 1.3 현재 미활용 가능성 정량 audit

**1) WASM SIMD 미활성**:
```bash
$ grep -r "target-feature" web/ crates/ scripts/  →  no output
```
- `wasm-pack build --target web` default 는 SIMD off
- `RUSTFLAGS="-C target-feature=+simd128"` 추가 시 vector ops (Vec3 dot/cross/normalize) 2-4× 가속 기대
- **Risk**: 매우 낮음 (modern browsers 99%+ SIMD 지원, Safari 16.4+)

**2) Surface deduplication 미활성**:
- ADR-031 `AnalyticSurface::Sphere { center, radius, axis_dir, ref_dir }` — 같은 sphere 의 N face 가 *각자* tessellate
- ADR-093 `face_to_surface_owner_id` infrastructure 존재 — 그룹화만 추가 시 *tessellation 공유*
- 100 box scene (각 6 face × 동일 plane normal) = 600 tessellation → 6 (100× speedup)

**3) Pre-tessellation cache 미활성**:
- `tessellate_face_surface` 호출 시 매번 재계산
- Surface (kind + params) 기반 cache 미구현
- LRU + chord_tol 키로 cache 가능

**4) Distance-based LOD 미활성**:
- LOCKED #40 의 `ANALYTIC_CHORD_TOL = 0.02` 는 *고정* — 카메라 거리 무관
- 멀리 있는 face 는 큰 chord_tol 로 tessellate → memory + render time ↓

**5) Worker thread 미활성**:
```bash
$ grep -rn "Worker\b" web/src --include="*.ts"  →  no Worker usage
```
- 모든 mesh op + tessellation main thread 에서 실행
- syncMesh 의 무거운 부분 (Newell normal, BVH build) worker 후보

**6) Three.js WebGPURenderer 미활성**:
- 현재 `WebGLRenderer` 만 사용 (Viewport.ts:55)
- Three.js 0.170 WebGPURenderer experimental — 활용 가능 시 modern GPU 30-50% 성능 unlock (정확한 benchmark 후)

**7) Octree scene culling 미활성**:
- Three.js frustumCulled per-object (object level)
- Octree scene partitioning 미구현 — 큰 scene (1000+ object) 시 culling overhead

**8) Delta buffer Phase 2 미진행**:
- 현재 translate/rotate/scale 만 delta — create/push_pull/Boolean 은 full rebuild
- Topology 변경 후 *변경된 face 만* in-place 추가 가능 (ADR-111 β planned)

### 1.4 ADR-122 (KAYAC) 와의 직교 관계

| 측면 | ADR-122 (KAYAC) | ADR-123 (AxiA-native) |
|---|---|---|
| **접근** | 외부 패턴 도입 | 내부 자산 활용 |
| **API** | Three.js `InstancedMesh` (or custom shader) | Rust SIMD / Surface dedup / LOD / Worker |
| **Risk** | 중간 (per-face metadata mapping) | 낮음~중간 (자산 별 다름) |
| **효과** | drawcall 감소 (render-side) | tessellation / compute 감소 (engine-side) |
| **시너지** | ADR-123 D (SIMD) + ADR-122 α-2 = render + compute 모두 가속 | ADR-122 A (BBox InstancedMesh) + ADR-123 A (Surface dedup) — orthogonal |

**핵심**: 두 ADR 은 **상호 배타가 아님** — 사용자가 어느 path 우선/병행 결정.

### 1.5 사용자 가치 anchor (ADR-046 P31)

- **P1 (건축/디자인)**: 100+ primitives architectural scene 시 *현재 syncMesh 35ms 한계* → SIMD/LOD/cache 후 budget 여유
- **P3 (AI 협업자)**: AI agent 의 batch primitive 생성 시 tessellation 누적 — *전체 AxiA 엔진 성능 향상* 의 architectural value

**Demo readiness**: ADR-122 가 render-side throughput unlock 이라면, ADR-123 은 *engine-side throughput* unlock — 두 가속이 가장 큰 시너지.

---

## 2. AxiA-Native Options Matrix (10 options A~J)

각 option 의 시간 estimate + risk + 효과 + 의존 자산.

| Option | scope | 예상 효과 | 시간 estimate | risk | 의존 자산 |
|---|---|---|---|---|---|
| **A — Surface deduplication** | `face_to_surface_owner_id` 그룹화 + `tessellate_surface_owner_id` 단일 호출 (N face 공유) + Render group key | **100 box → 100× tessellation 감소** (600 → 6). 큰 scene memory ↓ | 1-2주 atomic | 중간 (faceMap drift risk) | ADR-031 / ADR-093 / ADR-091 §E L1 |
| **B — Pre-tessellation cache + LOD** | Surface (kind+params+chord_tol) 기반 LRU cache + camera distance-based chord_tol | tessellate 즉시 (cache hit) + 멀리 = 거친 mesh | 1주 atomic | 낮음 (cache invalidation surface mutation 시) | ADR-031 / LOCKED #40 |
| **C — Scene Octree culling** | Three.js `Octree` scene partition + frustum cull per-leaf | 1000+ primitives scene 시 render time ↓ (보이지 않는 face skip) | 1-2주 atomic | 중간 (mesh update 시 octree rebuild) | Three.js 0.170 Octree |
| **D — WASM SIMD activation** ⭐ | `RUSTFLAGS="-C target-feature=+simd128"` + Vec3 ops vectorize (Newell normal / dot / cross / normalize) | **2-4× engine compute 가속** (Newell normal / Boolean SSI 등). 매우 단순. | 2-3일 atomic | **매우 낮음** (modern browsers 99%+ 지원, Safari 16.4+) | wasm-pack default override |
| **E — Delta buffer Phase 2** | Topology 변경 후 변경 face 만 delta 추가 (ADR-111 β planned) | create/push_pull/Boolean 후 full rebuild 회피 | 1-2주 atomic | 중간 (face_to_buffer_range 정합) | ADR-111 / LOCKED #40 |
| **F — Three.js WebGPURenderer** | `WebGLRenderer` → `WebGPURenderer` switch + shader 호환 audit | modern GPU 30-50% render time ↓ (실측 후 확정) | 1-2주 atomic | 높음 (Three.js WebGPU experimental, shader/material 호환성 audit) | Three.js 0.170+ |
| **G — Worker thread mesh processing** | Heavy syncMesh 작업 (Newell, BVH build, normal smoothing) worker offload | main thread responsive, syncMesh budget 33ms 안정 | 2-3주 atomic | 높음 (WASM module sharing + postMessage 비용 audit) | Web Worker + SharedArrayBuffer |
| **H — Path B natural instancing** | ADR-104 Path B (1 anchor + 1 self-loop edge + 1-3 face) 가 *자연 instancing* — render path 에서 `InstancedMesh` 자동 생성 | 100 sphere 가 1 sphere mesh + N instance 자연 변환 | 1-2주 atomic | 중간 (Path B family 의 Three.js 매핑 audit) | ADR-104 family / Three.js InstancedMesh |
| **I — 묶음 A + B** (AxiA-native 강점 극대화) | Surface dedup (engine) + cache + LOD (render) | tessellation 100× ↓ + 멀리 코어스 + cache | 2-3주 atomic | 중간 | ADR-031 / ADR-091 §E L1 / LOCKED #40 |
| **J — 묶음 A + D + H** (full AxiA-native) | Surface dedup + SIMD + Path B natural instancing | engine + render + structural 3축 동시 | 3-4주 multi-week | 중간~높음 | ADR-031 / ADR-093 / ADR-104 family |

### 2.1 추천 매트릭스 (사용자 가치 × scope × risk)

| 추천 순위 | Option | 근거 |
|---|---|---|
| **1st** | **D — WASM SIMD activation** | *단순/신속/정확* canonical 정합. 2-3일 atomic, 매우 낮은 risk, **2-4× engine 가속** — single PR, immediate gain. ADR-094/113~115/120 등 모든 engine-heavy ADR 의 누적 가속 |
| **2nd** | **B — Pre-tessellation cache + LOD** | 1주 atomic, 낮은 risk, *큰 scene memory + render time* 동시 개선. ADR-122 와 직교 시너지 |
| **3rd** | **I — 묶음 A + B** | LOCKED #44 의미 단위 ("AxiA engine performance essentials"). 2-3주 atomic, 중간 risk, *production-ready engine throughput unlock* |
| **4th** | **A — Surface deduplication only** | Architectural elegance — `face_to_surface_owner_id` 의 자연 확장. 1-2주 atomic |
| **5th** | **J — 묶음 A + D + H** | full AxiA-native, 3-4주 multi-week. ADR-122 안 하기 시 KAYAC parity 의 대안 |

### 2.2 ADR-122 와의 추천 path matrix (사용자 결재 가이드)

| 시나리오 | 추천 sequence | 이유 |
|---|---|---|
| **시연 readiness 최우선** | ADR-123 D (2-3일) → ADR-122 α-1 (2-3일) 순차 | 5-6일 내 engine + render 양축 가속 |
| **architectural completeness** | ADR-123 I (2-3주) → ADR-122 α-3 (1.5-2주) 순차 | 4-5주 atomic, AxiA + KAYAC 양 자산 활용 |
| **단일 path 선택** | ADR-123 D (단일 PR) | 가장 ROI 높음 (2-3일 / 매우 낮은 risk / 즉시 2-4× 가속) |
| **AxiA-only 자존심** | ADR-123 J (3-4주) | 외부 패턴 없이 AxiA 자산만으로 KAYAC parity 도달 |
| **defer 양쪽 다** | (다른 priority 진입) | LOCKED #43 priority audit 시 |

---

## 3. 결재 트리거 (사용자 명시 선택 필요)

본 ADR α (spec only) 는 implementation 0 — 단지 매트릭스 audit + lettered options 제시. 사용자 결재 후 채택된 option 만 별도 atomic sub-step PR 진행 (LOCKED #44 정합).

### 3.1 핵심 결정 항목

- **Q1** Path 선택 — A / B / C / D / E / F / G / H / I / J 중 채택 (또는 defer)
- **Q2** ADR-122 와의 순서 — 병행 / ADR-123 우선 / ADR-122 우선 / 단일 path
- **Q3** Atomic 분할 단위 — single PR vs sub-step seq
- **Q4** 사용자 시연 게이트 위치 — implementation 후 즉시 (D 권장) vs incremental (I/J 분할 후)

### 3.2 권장 default (사용자 별도 결정 시 채택)

- **Q1 default**: **D (WASM SIMD activation)** — 단순/신속/정확 canonical 정합. 2-3일 atomic, 매우 낮은 risk, 2-4× immediate gain
- **Q2 default**: **ADR-123 D 먼저 (2-3일), ADR-122 α-1 후속 (2-3일)** — 5-6일 내 engine + render 양축 가속, 두 ADR 직교성 활용
- **Q3 default**: Single atomic PR per option (D 단독 → α-1 단독)
- **Q4 default**: Implementation 후 즉시 사용자 시연 (ADR-087 K-ζ canonical 답습)

---

## 4. Out of Scope (별도 ADR per LOCKED #44)

- **ADR-122 KAYAC GPU instancing 본체** — 별도 ADR (orthogonal)
- **Three.js WebGPURenderer 본격 도입** (F option β-impl) — experimental API audit + shader 호환성 검토 필수, 별도 architectural ADR
- **SharedArrayBuffer + Cross-Origin Isolation** (G option β-impl 시 필요) — headers 정책 변경 + Vite plugin 별도 ADR
- **Custom Rust mesh allocator** (memory pool / arena) — 큰 scene 시 알로케이션 비용 audit 필요, 별도 ADR
- **LOD chord_tol 정책 본격 lock-in** (B 의 distance-based chord_tol) — visual quality 정책 검토 (LOCKED #40 amendment 가능성), 별도 ADR
- **face_area cache 인프라 확장** (ADR-121 Path B face area 답습) — surface 별 area cache, 별도 ADR

---

## 5. Lock-ins (canonical for whichever path chosen)

- **L-123-1** AxiA 자산 우선 — 외부 패턴 (ADR-122 KAYAC) 도입 *전* 또는 *병행* 으로 내부 자산 활용 가능성 audit 강제
- **L-123-2** ADR-031 / ADR-093 / ADR-091 §E L1 / ADR-104 family / ADR-111 α 자산 모두 활용 후보 — 새 인프라 0 (자산 재사용)
- **L-123-3** Initial bundle 0MB strict 유지 (P20.C #2 답습) — engine-side 변경만, lazy chunk 영향 0
- **L-123-4** ADR-046 P31 #4 additive only — 사용자 facing API (createBox/Sphere/...) signature UNCHANGED
- **L-123-5** LOCKED #40 chord_tol 정책 보존 — B option 의 distance-based chord_tol 도 LOCKED #40 §L1 위에 *additive* (default 0.02 보존, 카메라 거리 ≥ threshold 시 coarser)
- **L-123-6** Path B family DCEL invariant 정합 (LOCKED #1, #5, #12, #15, #16, #26, #34) — engine 변경 시 모든 invariant 회귀 유지
- **L-123-7** 사용자 시연 게이트 필수 (ADR-087 K-ζ canonical) — implementation 후 100+ primitives stress test
- **L-123-8** ADR-122 와 직교 — 두 ADR 모두 적용 가능, 한 쪽이 다른 쪽 차단하지 않음
- **L-123-9** 절대 #[ignore] 금지

---

## 6. 사용자 facing 매트릭스 예측 (option 별)

각 option 의 사용자 측정 가능 변화 (5-sphere scene, current LOCKED #40 §L7 baseline).

| Scenario | Before (current) | After D (SIMD) | After B (cache+LOD) | After A (surface dedup) | After I (A+B) | After J (A+D+H) |
|---|---|---|---|---|---|---|
| **5-sphere syncMesh** (현재 35ms, LOCKED #46) | 35ms | **15-20ms** (Newell SIMD) | 25ms (cache hit) | 30ms (한번 tessellate) | 18ms | **12ms** |
| **100-box scene tessellation** | 600 tessellate | 600 (engine 가속 only) | 600 (cache 첫 hit, 후속 0) | **6 tessellate** (Surface dedup) | 6 + cache | 6 + InstancedMesh |
| **100-sphere render frame** | 100 drawcalls | 100 drawcalls (engine 가속 only) | 100 drawcalls | 100 drawcalls | 100 drawcalls | **1 drawcall** (H InstancedMesh) |
| **Boolean SSI compute** (5 obj × 4 op) | 100% baseline | **30-50% 감소** (SIMD) | 100% (cache 무관) | 100% | 30-50% | 30-50% |
| **Memory footprint** (1000 primitives) | 100% baseline | 100% (compute only) | 60% (LOD coarser) | **20% (surface dedup)** | 12% | 12% |
| **Frame time** @ 1000 primitives | 100-150ms (current) | 70-100ms | 60-90ms | 50-80ms | 40-60ms | **25-40ms** |

(All numbers are *order-of-magnitude estimates* — sub-step β implementation 시 실측 후 confirm.)

---

## 7. Cross-link

- **ADR-122** — 본 ADR 의 직접 대비 (KAYAC 외부 패턴 도입 검토). ADR-123 이 *사용자 질문 "우리 엔진 자체 내에서 해결방법은 없는지요?"* 의 architectural answer.
- **ADR-031 Phase D** — AnalyticSurface infrastructure (A option 의존)
- **ADR-093 D-β** — `face_to_surface_owner_id` Map (A option 의존, LOCKED #33)
- **ADR-091 §E L1** — Mesh-level HashMap canonical (A option 답습)
- **ADR-104 family** (ADR-094/113/114/115/116/117) — Path B kernel-native (H option 의존)
- **ADR-111 α** — RAF defer 패턴 (E option 답습 가능)
- **ADR-118 / ADR-120 / ADR-122** — α spec → β implementation atomic 패턴 답습
- **ADR-035 P20.C #2** — initial bundle 0MB strict (L-123-3)
- **ADR-046 P31** — P1 + P3 두 페르소나 가치 anchor / #4 additive only (L-123-4)
- **ADR-087 K-ζ** — 사용자 시연 게이트 canonical (L-123-7)
- **LOCKED #40** — render chord_tol 정책 보존 (L-123-5)
- **LOCKED #43** priority audit (본 ADR 은 priority 매트릭스 외부 — architectural performance optimization)
- **LOCKED #44** — Complete Meaning per Merge (α spec → β impl atomic)
- **LOCKED #46 (ADR-112)** — syncMesh 35ms 현재 baseline (Q1 default 의 측정 기준)

---

## 8. 결재 요청

본 spec only PR (α). 사용자 결재 후 채택된 Path 만 별도 atomic sub-step PR 진행.

**Q1-Q4 결정 요청**:

**권장 default 요약**:
- **Q1**: **D (WASM SIMD activation)** — 단순/신속/정확, 2-3일 atomic, 2-4× immediate gain
- **Q2**: **ADR-123 D 먼저 → ADR-122 α-1 후속** — 5-6일 내 engine + render 양축 가속
- **Q3**: Single atomic PR per option
- **Q4**: Implementation 후 즉시 사용자 시연

**대안 path**:
- 단일 path 선호: **D** (가장 ROI 높음)
- Architectural completeness: **I (A + B 묶음)** — 2-3주 atomic
- AxiA-only 자존심: **J (A + D + H)** — 3-4주, KAYAC 없이 parity

**ADR-122 와의 결재 sequence** 도 함께 명시 부탁드립니다 (병행 / ADR-123 우선 / ADR-122 우선 / 단일).

---

## D. Acceptance Log (sub-step 진행 시 갱신)

| Sub-step | Status | Commit | 회귀 |
|---|---|---|---|
| α (본 spec only) | In progress | (본 PR) | docs only — 0 회귀 |
| β implementation (Q1 결재 후) | TBD | TBD | TBD |
| 사용자 시연 게이트 | TBD | TBD | TBD |
| 회고 + LOCKED #N entry | TBD | TBD | TBD |

---

## E. Lessons (β closure 후 갱신 예정)

본 α spec 단계의 lessons (β 후 추가 lessons 누적):
- **L-α-1** — 사용자 자기-내성 질문 (*"우리 엔진 자체 내에서 해결방법은 없는지요?"*) 가 architectural ADR 의 anchor 가 되는 패턴. 외부 패턴 도입 검토 (ADR-122) 직후 *내부 자산 활용 audit* 의 자연 reflex. 향후 ADR 가이드: 외부 의존 (libraries / engines / frameworks) 도입 ADR 후 *반드시* AxiA-native 대안 audit ADR 병행 검토.
- **L-α-2** — 5개월 누적 architectural 자산 (ADR-031 / ADR-091 §E L1 / ADR-093 / ADR-104 family / ADR-111 α 등) 의 *횡단 활용 매트릭스* 가 본 audit 의 핵심 가치. 단순 *option list* 가 아닌 *어느 자산이 어느 option 의 의존성* 인지 명시.
- **L-α-3** — Q2 (ADR-122 와의 sequence) 가 핵심 결재 항목. 두 ADR 의 *직교성* (engine-side vs render-side, 내부 자산 vs 외부 패턴) 명시 → 사용자 path 선택 자유도 확보.
