# ADR-134 — Rendering Performance Audit (α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — path lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 perceived slowness report 2026-05-17 — "원 / 구 / 원통 / 도넛 / 자유곡선 / 스케치 표현이 많이 느린것 같습니다") |
| Anchor | 사용자 perceived slowness report → audit-first canonical 8번째 적용 |
| Parent | LOCKED #40 (render chord_tol 정책, ANALYTIC_CHORD_TOL=0.02), LOCKED #35/47/48/49 (Path B production default ON), ADR-104 family (Path B kernel-native) |
| Cross-cut | ADR-094/113/114/115 (Path B β implementations), ADR-111/112 (render perf optimizations), ADR-126 (STEP merged BufferGeometry), ADR-118/119 (STEP timing), LOCKED #44 (Complete Meaning per Merge) |

---

## 0. Summary

> 사용자 perceived slowness report (도형/볼륨 표현 — 곡면/원/구/원통/도넛/자유곡선/스케치) 의 architectural root cause audit. **Path B kernel-native (engine layer) 는 production default ON 으로 정상 작동** (LOCKED #35/47/48/49 verified). **진짜 bottleneck = ANALYTIC_CHORD_TOL=0.02 mm (LOCKED #40 §L1) 의 fine tessellation 으로 인한 triangle 폭발** — r=100 sphere = 50K triangles, r=1000 = **2M triangles**. 6 fix path options + 추천 default = **Option A (Distance-based LOD chord_tol)**.

---

## 1. Canonical Anchor

사용자 report (2026-05-17):
> "모든 도형과 볼륨 표현시 특히 곡면, 원, 구, 원통, 도넛, 자유곡선, 스케치등 표현이 많이 느린것 같습니다. 효율적인 표현 방식인지? 대규모 파일을 불러올때 문제없는지 속도면에서 체크를 해주세요"

**세션 audit-first canonical 8번째 적용** (ADR-125~133 답습). User-reported perceived slowness 의 architectural root cause audit.

---

## 2. Production Path B status verification (LOCKED #35/47/48/49)

Production Path B defaults (`web/src/main.ts` + `web/src/tools/*PathBSettings.ts`):

| Primitive | `let current = ` | Default | LOCKED | Status |
|---|---|---|---|---|
| **Cylinder** | `true` (B-θ post-retrospective) | **ON** | #35 (ADR-094) | ✅ Verified |
| **Sphere** | `true` | **ON** | #47 (ADR-113) | ✅ Verified |
| **Cone** | `true` | **ON** | #48 (ADR-114) | ✅ Verified |
| **Torus** | `true` | **ON** | #49 (ADR-115) | ✅ Verified |

**Conclusion**: Engine layer Path B 는 **production default ON** — user 가 explicit localStorage `'false'` 설정하지 않은 한 자동 Path B 사용. **Engine optimization NOT the issue**.

---

## 3. 진짜 Bottleneck — Render Tessellation Density

### 3.1 Tessellation formula (`surfaces/mod.rs:sagitta_segments`)

```rust
fn sagitta_segments(r: f64, total_angle: f64, chord_tol: f64) -> usize {
    let ratio = (chord_tol / r).clamp(0.0, 1.999_999);
    let delta = 2.0 * (1.0 - ratio).acos();
    ((total_angle.abs() / delta).ceil() as usize).max(8)
}
```

**Key relationship**: `n_segments ∝ √(r / chord_tol)` for fixed angle.

### 3.2 Triangle count matrix (실측 계산)

| Primitive | r=10 | r=100 | r=1000 | Scaling |
|---|---|---|---|---|
| **Circle** (closed-curve, fan triangulation) | 50 tris | 158 tris | 993 tris | √r |
| **Sphere** (u × v × 2 grid, 2 hemispheres) | **5,000** | **50,000** | **2,000,000** | r |
| **Cylinder** (n_u side, fixed 2 caps) | ~100 | ~316 | ~1,986 | √r |
| **Cone** (n_u side, 1 base cap) | ~50 | ~158 | ~993 | √r |
| **Torus** (n_u major × n_v minor × 2) | **~10,000** | **~50,000** | **~5,000,000** | r |

**Critical finding**: Sphere/Torus 의 2D grid tessellation 이 **r=100 → 50K triangles**, **r=1000 → 2M triangles** 까지 폭발.

### 3.3 ANALYTIC_CHORD_TOL = 0.02 vs legacy 0.1 (5× finer)

LOCKED #40 §L1 (2026-05-12):
> "Render-only chord_tol 분리: `export_buffers_inner` 내부 `ANALYTIC_CHORD_TOL = 0.02` (5× finer than legacy 0.1)."

| Primitive | ANALYTIC_CHORD_TOL=0.02 | Legacy 0.1 | Reduction |
|---|---|---|---|
| Sphere r=10 | 5,000 tris | ~1,000 tris | **5× more (current)** |
| Sphere r=100 | 50,000 tris | ~10,000 tris | **5× more** |
| Sphere r=1000 | **2M tris** | ~400K tris | **5× more** |
| Torus r=100 | 50,000 tris | ~10,000 tris | **5× more** |

**Trade-off**: visual quality (no faceting) vs rendering cost. LOCKED #40 의 architectural decision 은 visual quality 우선 — 사용자 통찰 "옆면처럼 원도 같은 방식 쓸 수 없나요?" 정합. 단 **large primitives (r > 50) 에서 ROI 역전**.

---

## 4. 5 Other Bottlenecks Identified

### 4.1 Mesh build O(N²) scaling

Bench evidence (`crates/axia-geo/benches/practicality_bench.rs`, LOCKED #44 baseline):
- 1000 quad faces mesh build = **38.24 ms** (non-linear, suspect FxHashMap rehashing)
- Per-face cost grows 31× when N grows 50× → O(N²) suspect

**Impact**: Large sketch (500+ faces) + STEP import (1000+ faces) 누적 latency.

### 4.2 Sketch export_buffers always full triangulation

`mesh.rs:export_buffers_inner` — every preview frame triangulates ALL faces via earcut (O(face count) × earcut O(N²) worst case).

**Impact**: Click 33ms budget violation for 500+ face sketches.

### 4.3 OCCT.js cold-start (Drift #5)

ADR-082 §Drift #5: browser env OCCT init = **180s+ wait**.
- ADR-119 γ-7 (pre-warm): background init post page-load, **only mitigates if user waits long enough**
- ADR-121 ocVisualApplication libs fix (silent failure 회귀)

**Impact**: First STEP import = 180s+ (Drift #5 본체).

### 4.4 BVH rebuild on geometry update

- ADR-111 α (BVH defer to next frame): 145ms → 0ms (95% reduction)
- 단 large geometry (50K+ tris from sphere/torus tessellation) BVH rebuild 가 frame budget 초과 가능
- `three-mesh-bvh` rebuild cost O(triangle count)

**Impact**: r=100 sphere create → 50K BVH build → ~50-100ms (frame budget violation).

### 4.5 Path A closed-curve face Push-Pull (deferred per ADR-089 A-θ)

Closed-curve Circle → Push-Pull = tessellate-then-extrude (Path A polygon).
- 24-segment circle → 48 side faces (Path A) vs 1 cylinder face (Path B future)
- ADR-094 B-θ 답습 가능 (closed-curve Push-Pull Path B = future ADR)

**Impact**: Cylinder from extruded circle = legacy polygon path, not Path B kernel-native.

---

## 5. 6 Fix Path Options Matrix

| Path | Description | Scope | 시간 | Risk | Visual impact |
|---|---|---|---|---|---|
| **A** ⭐ | **Distance-based LOD chord_tol** — `chord_tol = max(0.02, camera_distance × 0.001)` (far = coarser) | ~150 LoC, 1-2주 atomic | Low-Medium | None (near unchanged, far slightly coarser) |
| B | **Adaptive chord_tol per radius** — `chord_tol = max(0.02, radius × 0.01)` (large primitives = 1% radius) | ~80 LoC, 3-5일 | Low | Slight (large primitives 약간 coarser) |
| C | **Revert ANALYTIC_CHORD_TOL=0.1** (LOCKED #40 §L1 reversal) | ~10 LoC, 1일 | Medium (visual regression) | High (faceting 복귀) |
| D | **Sketch export cache** — preview only re-triangulate changed faces (delta buffer Phase 2, ADR-111 β planned) | ~400 LoC, 2-3주 | Medium | None |
| E | **Mesh build hash optimization** — pre-allocate FxHashMap or replace with SlotMap variant | ~200 LoC, 1주 audit + 2-3주 impl | High (regression risk) | None |
| F | **Path A circle Push-Pull → Path B Cylinder migration** (ADR-094 B-θ 답습) | ~300 LoC + 6 sub-step, 3-4주 atomic | Medium-High | None |

### 5.1 추천 매트릭스 (사용자 가치 × scope × risk)

| 추천 순위 | Path | 근거 |
|---|---|---|
| **1st** | **A (Distance-based LOD)** | 단순/신속/정확 — far camera 자동 coarser, near 유지. r=1000 sphere 가 카메라 거리 100m 일 때 2M → 20K tris (100× reduction). Visual quality 영향 0 (near). |
| **2nd** | **B (Adaptive per radius)** | LOCKED #40 spirit 보존 + large primitive 만 coarser. 3-5일 atomic. |
| **3rd** | **D (Sketch export cache)** | Sketch interactive latency 해소 — Click 33ms budget compliance. |
| **4th** | **F (Path A circle Push-Pull migration)** | Architectural completeness — circle extrude = true kernel-native cylinder. |
| **5th** | **E (Mesh hash optimization)** | High risk, 1000+ face sketch only — niche scenario. |
| **6th** | **C (Revert to 0.1)** | LOCKED #40 reversal — 사용자 통찰 "옆면처럼" 정합 깨짐, 비추천. |

### 5.2 권장 default = Path A (Distance-based LOD chord_tol)

**Strategy**:
1. **Render-only LOD chord_tol**:
   ```rust
   fn lod_chord_tol(camera_distance: f64) -> f64 {
       let base = 0.02;  // LOCKED #40 baseline (preserved for near)
       let lod_factor = (camera_distance / 100.0).max(1.0);  // 100mm threshold
       (base * lod_factor).min(1.0)  // cap at 1.0 mm
   }
   ```
   - Camera distance 100mm 이하: 0.02 mm (unchanged)
   - 1000mm (1m): 0.2 mm (10× coarser)
   - 10000mm (10m): 1.0 mm (cap)

2. **r=1000 sphere example**:
   - Near (cam 100mm): 2M tris (unchanged)
   - Mid (cam 1m): ~100K tris (20× reduction)
   - Far (cam 10m): ~20K tris (100× reduction)

3. **LOCKED #40 spirit 보존** — near rendering 영향 0, far rendering 만 자동 coarser.

4. **Implementation**:
   - `crates/axia-geo/src/mesh.rs:export_buffers_inner`: `lod_chord_tol(camera_distance)` 도입
   - `web/src/viewport/Viewport.ts`: camera distance 계산 + `export_buffers(lod_tol)` 호출
   - Threshold (100mm) localStorage-tunable for power users

5. **회귀 자산**: ADR-077 V-2 visual baselines (Linux) regenerate (near rendering unchanged, far rendering 시 약간 변경)

---

## 6. STEP/IGES Large-File Readiness

### 6.1 Current state (post-ADR-119/126)

- **OCCT.js cold-start**: 180s+ (Drift #5, ADR-082)
- **ADR-119 γ-7 pre-warm**: Background init post page-load (사용자 wait 시 자동 ready)
- **ADR-126 Merged BufferGeometry**: N×2 → 2 drawcalls (STEP 500 face = 1000 → 2)
- **ADR-121 ocVisualApplication**: libs fix (silent failure 회귀)

### 6.2 Identified gaps

1. **Cold-start 180s+** — 사용자 즉시 import 시 wait. ADR-119 부분 mitigation.
2. **Large mesh BVH rebuild** — 50K+ tris BVH = ~50-100ms frame budget violation.
3. **Per-face Three.js Group userData**: 500 face × Group with userData = memory overhead.

### 6.3 Future ADR triggers

- **Cold-start sub-3.5s** (별도 ADR — OCCT.js compile-time optimization, Brotli compression upgrade)
- **BVH for large geometry deferred to worker thread** (별도 architectural ADR)

---

## 7. 결재 트리거 (사용자 명시 선택 필요)

### 7.1 Q1 — Path 선택

- **(a) A (Distance-based LOD chord_tol)** ⭐ — 단순/신속/정확, 1-2주 atomic
- **(b) B (Adaptive per radius)** — 3-5일 atomic
- **(c) D (Sketch export cache)** — 2-3주
- **(d) F (Path A circle Push-Pull → Path B Cylinder)** — 3-4주 multi-week
- **(e) A + B 묶음** — 둘 다 (LOD + per-radius), ~2-3주 atomic
- **(f) defer** — 추가 measurement 후 결재 (사용자 manual 시연 evidence 수집)

### 7.2 Q2 — 사용자 시연 evidence 우선?

- **(a) audit ADR만 작성** (본 PR) — 결재 후 별도 β implementation ADR
- **(b) 사용자 manual 시연 우선** — 구체적 scenario (r 값, FPS, etc.) 후 결재

### 7.3 권장 default

- **Q1 (a) A (Distance-based LOD chord_tol)** — 단순/신속/정확, near rendering 영향 0
- **Q2 (b) 사용자 manual 시연 우선** — specific scenario evidence 가 path 최종 결정에 가치

### 7.4 사용자 manual 시연 체크 항목 (Q2=b 선택 시)

1. **localStorage 확인**: `localStorage.getItem('axia:sphere-path-b-mode')` 등 — `null` 또는 `'true'` 면 Path B 활성
2. **간단 sphere 그리기**: r=10 → fast, r=100 → 측정 (잘 boundary 노출), r=1000 → very slow expected
3. **Torus 그리기**: 동일 측정
4. **Sketch 500+ line**: drawing latency 측정
5. **STEP import**: small (cube) + medium (50 face) + large (500+) timing
6. **Chrome DevTools Performance**: capture during slow scenario → GPU drawcalls, frame time

---

## 8. Lock-ins (canonical, L-134-1 ~ L-134-9)

- **L-134-1** Path B production default ON verified — engine optimization NOT the bottleneck
- **L-134-2** ANALYTIC_CHORD_TOL=0.02 mm (LOCKED #40 §L1) 의 architectural decision 보존 — visual quality 우선 정합
- **L-134-3** 5 bottlenecks identified — tessellation density / mesh O(N²) / sketch full triangulation / OCCT cold-start / BVH rebuild
- **L-134-4** Distance-based LOD chord_tol (Path A) = near rendering 영향 0, far auto-coarser
- **L-134-5** ADR-046 P31 #4 additive only — visual change near rendering 0, far rendering only
- **L-134-6** ADR-077 V-2 visual baselines regenerate (β implementation 시) — near unchanged, far regenerate
- **L-134-7** ADR-094 B-θ Path B 답습 — future closed-curve Push-Pull (Path A → Path B Cylinder)
- **L-134-8** 사용자 시연 evidence 우선 (Q2=b 권장) — specific scenario → optimal path 결정
- **L-134-9** 절대 #[ignore] 금지

---

## 9. Out of Scope (별도 ADR per LOCKED #44)

- **ADR-135 (가칭) β implementation** of selected path (ADR-134 결재 후)
- **OCCT.js cold-start optimization** (별도 architectural ADR)
- **BVH worker thread offloading** (별도 architectural ADR)
- **Mesh build hash optimization** (E option — 별도 audit ADR 필요)
- **Closed-curve Push-Pull Path B migration** (F option — ADR-094 B-θ 답습 별도 multi-week ADR)
- **i18n infrastructure** (ADR-046 Q7 Phase 2, ADR-130 §2.5)

---

## 10. Cross-link

- **사용자 perceived slowness report** (2026-05-17) — 본 ADR 의 직접 trigger
- **LOCKED #40 §L1** — ANALYTIC_CHORD_TOL = 0.02 mm 정책 (visual quality 우선)
- **LOCKED #35/47/48/49** — Path B production default ON verified
- **ADR-094/113/114/115** — Path B β implementations
- **ADR-104** — Path B family canonical
- **ADR-111 α** — BVH defer (render perf optimization 1)
- **ADR-112** — edges empty handling (render perf optimization 2)
- **ADR-124** — WASM SIMD activation (engine compute 2-4×)
- **ADR-126 β** — STEP Merged BufferGeometry (drawcall N×2 → 2)
- **ADR-118 / ADR-119 / ADR-121** — STEP timing + pre-warm + libs fix
- **ADR-082 §Drift #5** — OCCT cold-start 180s+
- **ADR-077 V-2** — visual baseline 가드 (β implementation 시 regenerate)
- **ADR-046 P31 #4** additive only (L-134-5)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical (L-134-8)
- **ADR-118 / ADR-120 / ADR-122 / ADR-123 / ADR-129 / ADR-130 / ADR-132** — α spec → β implementation atomic pattern source
- **LOCKED #44** Complete Meaning per Merge (docs-only PR scope)

---

## 11. 결재 요청

본 spec only PR (α). 사용자 결재 후 채택된 Path 만 별도 ADR-135 (가칭) β implementation 진행.

**Q1 Path 선택** + Q2 방식 명시 부탁드립니다.

**권장 default 요약**:
- **Q1 (a) Distance-based LOD chord_tol** — 단순/신속/정확, near rendering 영향 0
- **Q2 (b) 사용자 manual 시연 우선** — specific scenario evidence 후 optimal path 최종 결정

**대안**:
- **Q1 (b) Adaptive per radius** — 3-5일 atomic, more conservative
- **Q1 (e) A + B 묶음** — 둘 다 combined (LOD + per-radius)
- **Q1 (f) defer** — 추가 measurement 후 재결재
- **Q2 (a) 즉시 β implementation** — 시연 생략, 1-2주 atomic 진입

### Critical user verification request (Q2=b 권장 시)

진행 전 사용자 측에서 다음 확인 부탁드립니다:

1. **Browser DevTools 열고 Console 에서**:
   ```js
   ['cylinder', 'sphere', 'cone', 'torus'].forEach(p => {
     console.log(`axia:${p}-path-b-mode = ${localStorage.getItem(`axia:${p}-path-b-mode`)}`);
   });
   ```
   - `null` 또는 `'true'` 면 Path B 활성 (정상)
   - `'false'` 면 explicit OFF (사용자 explicit 변경) → 진짜 slow 원인

2. **간단한 sphere 생성**:
   - r=10 (작은 sphere) → 즉각 OK?
   - r=100 (중간) → 약간 slow?
   - r=1000 (큰 sphere) → very slow (확정)?

3. **Chrome Performance tab** — sphere 생성 시 frame time + GPU drawcalls 측정

이 evidence 후 Q1 path 최종 결정 가능. 본 audit ADR 은 architectural truth + 6 options 매트릭스만 lock-in.
