# ADR-104 — Path B Expansion (Sphere / Cone / Torus)

| Field | Value |
|---|---|
| Status | **Proposed (Amendment 2, 2026-05-15)** — Q1 revision: (c) seam edge → **(b) 2-hemisphere** (manifold + ADR-021 P7 strict 정합). 메타-원칙 #14 (face derives from closed boundary) 정합. β-1-β (engine 본체) 진입 사용자 명시 결재 대기. |
| Date | 2026-05-15 |
| Supersedes | — |
| Related | ADR-027 (NURBS Kernel kickoff), ADR-031 (Phase D — Sphere/Cone/Torus analytic), ADR-032 (P17 primitive Path B activation), ADR-079 (Create Solid surface-native), ADR-080 (Offset dimension-aware), ADR-089 (Phase 2 closed-curve face), ADR-094 (Cylinder Path B-full canonical), LOCKED #1 (P7 manifold), LOCKED #26 (Two-Layer Citizenship), LOCKED #41 (ADR-101 closure), LOCKED #42 (ADR-102 closure), LOCKED #43 (ADR-103 Z-up closure) |

---

## 1. Canonical Anchor

ADR-094 의 Cylinder Path B-full closure (3 face / 2 edge / 2 vert annulus topology — 95%+ memory reduction vs Path A 25/69/46) 의 자연 확장. **Sphere / Cone / Torus 3 primitive** 의 동일 architectural unlock.

LOCKED #43 ADR-103 closure 직후 진입 — Z-up 좌표계 정합 완료 위에 *기능 확장* 첫 트랙. 사용자 결재 절대 우선순위 §2 답습:

```
1. ADR-103 Z-up         ✅ closure
2. Path B (Sphere/Cone/Torus 확장)   ← 본 ADR
3. STEP timing 단축
4. NURBS-aware coplanar intersect
```

### 1.1 Path A → Path B 의미

| 측면 | Path A (legacy polygon) | Path B (kernel-native) |
|---|---|---|
| 표현 | N-segment polygon strip | 1 surface face + analytic curves |
| Cylinder (r=5, N=24) | 25 face / 69 edge / 46 vert | **3 / 2 / 2** (annulus + 2 caps) |
| Sphere (r=5, N=24, M=12) | ~289 face | **1 surface face + 2 pole verts** |
| Cone (r=5, h=10, N=24) | 25 face | **2 face + 1 apex** |
| Torus (R=5, r=2, N=24, M=12) | ~289 face | **1 surface face** |
| 메모리 | O(N²) for Sphere/Torus | O(1) constant |
| 정확도 | chord error R·(1-cos(π/N)) | 정확 (NURBS evaluate) |
| Boolean / Offset / Push-Pull | polygon approximation 필요 | analytic curve dispatch (ADR-064/066/080) |
| STEP export | polygon facets | analytic NURBSSurface (round-trip 1e-3 mm) |

### 1.2 ADR-094 의 canonical 답습 사항

ADR-094 의 7 sub-step Path Z atomic (B-α ~ B-θ) 의 *additive-first + multi-gate atomic* 패턴 답습:

- **B-α** spec (본 ADR)
- **B-γ-prep** Mesh-level Map (face_to_boundary_loops 답습)
- **B-δ-prep** `extrude_*_kernel_native` API (3 primitive)
- **B-ζ-prep** Render — 기존 framework 자연 처리 (zero-code-change)
- **B-ε-prep** Boolean dispatch — surface-driven 자연 처리
- **B-η** architectural switch (engine OFF + production ON localStorage)
- **B-θ** real Chromium 시연 PASS

---

## 2. 현재 상태 (audit, 2026-05-15)

### 2.1 Path B 활성화 상태

| Primitive | Path B 활성 | 기본 |
|---|---|---|
| **Cylinder** | ✅ ADR-094 closure | localStorage `axia:cylinder-path-b-mode` default ON |
| **Sphere** | ❌ Path A only | 본 ADR scope |
| **Cone** | ❌ Path A only | 본 ADR scope |
| **Torus** | ❌ Path A only | 본 ADR scope |

### 2.2 기존 인프라 (ADR-104 cross-link)

- **ADR-031 Phase D**: Sphere / Cone / Torus `AnalyticSurface` variants 활성 (`SurfaceOps` trait — evaluate / normal / derivative_u / derivative_v / tessellate / parameter_range)
- **ADR-032 P17**: primitive 생성 시 face 별 surface attach 활성 (`mesh.set_face_surface`)
- **ADR-079 W-2-γ**: Create Solid `Cylinder/Sphere/Cone/Torus` 모두 surface-native dispatch 활성 (`offset_smooth_group_*`)
- **ADR-080 V-β-γ**: Offset Cylinder/Sphere/Cone/Torus host 활성
- **ADR-089 Phase 2**: 닫힌 곡선 (Circle/Bezier/BSpline/NURBS) 의 self-loop edge + 1 face canonical 표현 — Sphere 의 pole vertex / Torus 의 closed loop 의 인프라 자산
- **ADR-094 B-γ-prep**: `Mesh.face_to_boundary_loops` Mesh-level Map (multi-loop face 지원, bincode 호환 보존)

### 2.3 Sphere / Cone / Torus Path A 메모리 정량

ADR-089 A-Γ-β audit 패턴 답습:

| Primitive | Default (N=24, M=12) | High-res (N=64, M=32) |
|---|---|---|
| Sphere | 289 face / 561 edge / 290 vert | 2049 face / 4097 edge / 2050 vert |
| Cone | 25 face / 49 edge / 26 vert | 65 face / 129 edge / 66 vert |
| Torus | 289 face / 577 edge / 289 vert | 2049 face / 4097 edge / 2049 vert |

→ **Sphere / Torus 가 가장 큰 memory pressure** (O(N·M)). Path B 활성 시 모두 1 face → **99.7% reduction (N=64,M=32 기준)**.

---

## 3. 제안 작업 (atomic sub-step, ADR-103 stacked PR merge 이후 진입)

### 3.1 권장 순서 (ADR-094 답습)

| Phase | sub-step | scope |
|---|---|---|
| α (본 PR) | spec | 8-step roadmap + 8 lock-ins |
| β-1 | **Sphere Path B** — `extrude_sphere_kernel_native` + Mesh-level Map | 가장 큰 memory unlock |
| β-2 | **Cone Path B** — `extrude_cone_kernel_native` + apex vertex special-case | 중간 복잡도 (apex singularity) |
| β-3 | **Torus Path B** — `extrude_torus_kernel_native` + closed-loop boundary | u/v 모두 periodic 복잡 |
| γ | Render path zero-code-change 확인 (ADR-094 B-ζ-prep 답습) | tessellate_face_surface 자연 활용 |
| δ | Boolean / Offset / Push-Pull 자연 결합 (B-ε-prep 답습) | surface-driven dispatch 확인 |
| ε | architectural switch — engine default OFF + production localStorage ON | ADR-049 P-5e-α 답습 |
| ζ | Real Chromium 시연 PASS (Playwright slow channel) | ADR-094 B-θ 답습 |
| η | closure + LOCKED #44 entry | docs only |

### 3.2 β-1 Sphere Path B 상세

**1 surface face + 2 pole verts** canonical 표현:

```
Mesh structure:
- 2 pole verts: v_north (+Z radius), v_south (-Z radius)
- 0 edges (surface는 closed manifold)
- 1 face with AnalyticSurface::Sphere attached
  - outer loop: implicit (parameter space, no DCEL edges)
  - 또는 multi-loop face (B-γ-prep Mesh.face_to_boundary_loops 답습)
```

**Challenge**: face 가 *boundary loop 없는* 표현 가능 여부 — ADR-089 closed-curve face (1 anchor + 1 self-loop edge) 패턴 확장 필요. multi-loop face 의 빈 boundary case 또는 single-loop with closed seam.

**Lock-in 결정 요청** (사용자):
- (a) Sphere 를 2-pole 1-face 로 표현 (boundary 없음, ADR-021 P7 위반 가능성)
- (b) Sphere 를 4-piece (북반구 / 적도 / 남반구) 로 분할 (boundary 유지)
- (c) Sphere 를 single-face with seam edge (ADR-089 closed-curve self-loop 확장)

### 3.3 β-2 Cone Path B 상세

**2 face + 1 apex vertex** canonical:

```
- 1 apex vert: v_apex (z = h)
- N base ring verts (Path A 와 동일)
- 1 base disk face (Plane, polygonal)
- 1 cone side face with AnalyticSurface::Cone attached + apex singularity
```

apex singularity 처리: ADR-094 cylinder 의 quad face 답습 불가 (apex 가 0-radius). triangle fan 또는 NURBS surface 의 control point degeneracy 활용.

### 3.4 β-3 Torus Path B 상세

**1 surface face** with periodic u + periodic v:

```
- N major ring verts (u direction)
- 0 minor circle verts (v direction implicit via surface eval)
- 1 face with AnalyticSurface::Torus attached
- u/v both periodic (no seam edges 또는 2 seam edges)
```

가장 복잡 — u, v 모두 periodic. ADR-094 의 single-axis periodic 패턴 확장.

---

## 4. 제외 (out of scope)

- **AnalyticSurface 새 variant 추가** — Bezier/BSpline/NURBS surface 의 Path B 는 별도 ADR (ADR-027 Phase X 답습)
- **Path B → Path A fallback UI** — ADR-094 의 localStorage 답습, 별도 sub-step 가능
- **Sphere 의 4-piece 표현** — 본 ADR 의 β-1 lock-in 결정 시 채택 가능

---

## 5. Lock-ins (canonical for ADR-104)

- **L-104-1 절대 우선순위 답습**: ADR-103 closure 이후 진입. Path B 가 STEP timing / NURBS coplanar 보다 우선 (사용자 canonical 결재).
- **L-104-2 ADR-094 7 sub-step atomic 답습**: additive-first + multi-gate gate + engine OFF + production ON.
- **L-104-3 Mesh-level Map canonical** (ADR-091 §E L1): `Mesh.face_to_boundary_loops` 의 자연 확장 — Sphere / Cone / Torus 모두 face 별 boundary loop 매핑. struct field 추가 0, snapshot schema 호환 보존.
- **L-104-4 Render zero-code-change** (ADR-094 §E L3 답습): `tessellate_face_surface` framework 자연 활용. Sphere/Cone/Torus 의 chord-tolerant tessellation 이미 구현 (ADR-031 Phase D).
- **L-104-5 사용자 시연 ζ-step 필수**: ADR-087 K-ζ / ADR-094 B-θ canonical 답습. test 자산만으로 architectural 회귀 보장 불가.
- **L-104-6 engine default OFF + production ON** (ADR-049 P-5e-α 답습): localStorage `axia:sphere/cone/torus-path-b-mode`. 회귀 자산 245+ 보존 + 사용자 facing 즉시 활성.
- **L-104-7 절대 #[ignore] 금지**: 모든 sub-step 회귀 자산 절대 ignore 안 함.
- **L-104-8 ADR-046 P31 #4 (additive only)**: 사용자 facing API 변경 0. `create_sphere/cone/torus` signature 보존.

---

## 6. 사용자 facing 변화 예측

| Sphere (r=5, default segments) | Before | After |
|---|---|---|
| face count | 289 | **1** |
| edge count | 561 | **0** (또는 1 seam, β-1 lock-in 따라) |
| vert count | 290 | **2** (poles) |
| 메모리 | ~100 KB | **<1 KB** (99.7%↓) |
| Boolean SSI 정확도 | chord approximation | NURBS direct |
| STEP export | polygon facets | analytic NURBSSurface |

Cone / Torus 유사 매트릭스. ADR-094 의 95%+ reduction 자연 답습.

---

## 7. 사용자 결재 트리거

본 ADR 의 작업은 **3-5 주 scope**. 사용자 명시 결재 + LOCKED 정책 (`docs/adr/README.md` 메타-원칙 #10) 답습. ADR-094 의 cylinder closure 패턴 답습 가능.

### 7.1 결재 사항 (사전 검토)

- **Q1** β-1 Sphere boundary 표현 — (a) no-boundary / (b) 4-piece / (c) seam edge
- **Q2** Cone apex singularity — triangle fan / NURBS degenerate control points / Sphere 답습
- **Q3** Torus u/v periodic — single face (no seam) / 2-seam edges (axial + meridional)
- **Q4** 사용자 시연 게이트 (ζ-step) 가 architectural 진입 전 또는 후
- **Q5** Path A → Path B migration UX — 자동 전환 vs 명시 사용자 액션

---

## 8. Cross-link

- **ADR-094** — Cylinder Path B-full canonical, 본 ADR 의 모범 사례
- **ADR-031 Phase D** — Sphere/Cone/Torus `AnalyticSurface` 인프라
- **ADR-032 P17** — primitive face surface attach 활성
- **ADR-079** — Create Solid surface-native (Sphere/Cone/Torus 모두 활성)
- **ADR-080** — Offset Sphere/Cone/Torus host 활성
- **ADR-089 Phase 2** — closed-curve face self-loop edge 인프라 (Torus periodic 패턴 답습)
- **ADR-091 §E L1** — Mesh-level Map canonical (face_to_boundary_loops 답습)
- **ADR-049 P-5e-α** — engine OFF + production ON pattern
- **ADR-046 P31 #4** — additive only
- **ADR-087 K-ζ / ADR-094 B-θ** — 사용자 시연 게이트
- **LOCKED #1 ADR-021 P7** — manifold rule
- **LOCKED #26** — Two-Layer Citizenship (Sphere/Cone/Torus 모두 Shape/Xia 시민권 적용)
- **LOCKED #41/42/43** — ADR-101/102/103 closure 답습 cumulative

---

## 9. Amendment 1 — Q1-Q5 default answers + β-1 sub-step decomposition (2026-05-15)

§7 의 5 결재 사항 (Q1-Q5) 에 대한 **default answer** + β-1 (Sphere Path B) **sub-step decomposition** 명시. 사용자가 default 와 다른 결정을 원할 시 본 PR 검토 시 정정. default 채택 시 별도 결재 없이 β-1-α 진입.

### 9.1 Q1 — Sphere boundary 표현

**Default: (c) seam edge** (ADR-089 closed-curve self-loop 답습).

- 1 anchor vertex (north pole at +Z·radius)
- 1 self-loop edge with `AnalyticCurve` = none (parameter-space seam, no curve metadata)
- 1 face with `AnalyticSurface::Sphere` attached
- 추가 vertex: 1 south pole vertex (-Z·radius), 0 edges (manifold via face's analytic surface)

**왜 (c)**:
- ADR-021 P7 (closed edge cycle divides face) 정합 — self-loop edge 가 boundary
- ADR-089 Phase 2 의 *kernel-native canonical* 1-anchor + 1-self-loop pattern 자연 확장
- Render path 의 `tessellate_face_surface` 가 ADR-031 Phase D 의 sphere chord-tolerant tessellation 자동 활용
- Sphere 의 closed manifold 위상 보존 (north + south pole = 2 isolated verts, surface 의 *poles* 표현)

**Reject 이유**:
- (a) no-boundary: ADR-021 P7 explicit violation, manifold invariant 위반
- (b) 4-piece split: 4 face × 4 boundary edges = 16 edges/4 faces — Path A 보다 더 복잡, memory unlock 손실

### 9.2 Q2 — Cone apex singularity

**Default: NURBS degenerate parameter edge** (kernel-native).

- 1 base disk face (Plane, polygonal — 기존 Path A 답습)
- 1 cone side face with `AnalyticSurface::Cone` attached
  - boundary: base circle (N polyline edges OR ADR-089 self-loop with `AnalyticCurve::Circle`)
  - apex: parameter space v=0 (degenerate — `evaluate(u, 0) = apex` for all u)
- 1 apex vertex (degenerate boundary point)

**왜 NURBS degenerate**:
- `AnalyticSurface::Cone` 의 parameter range `v ∈ [0, height]` 에서 v=0 = apex (rolling u sweep collapses to point)
- DCEL 측면: apex 는 face boundary 의 *isolated point* 가 아닌, parameter space 의 degenerate edge
- Memory: 2 face + 1 apex + N base ring (vs Path A 25 face) — 92% reduction
- Render: `tessellate_face_surface` 의 chord-tolerant 가 apex 근처 narrow triangle 자동 처리

**Reject 이유**:
- triangle fan: 25 triangles 그대로 = Path A 와 동일, kernel-native unlock 손실

### 9.3 Q3 — Torus u/v periodic

**Default: single face with 2 seam edges** (axial + meridional).

- 1 surface face with `AnalyticSurface::Torus` attached
- 2 seam edges (ADR-089 self-loop variant — *parameter space seam*):
  - axial seam: u=0 → u=2π (major direction closure)
  - meridional seam: v=0 → v=2π (minor direction closure)
- 1 vertex at (u=0, v=0) — intersection of two seams
- 0 polygon ring verts (모두 surface evaluate 로)

**왜 2-seam**:
- u, v 모두 periodic — 두 seam 모두 명시
- ADR-021 P7 manifold 정합 (각 seam 이 boundary)
- Render `tessellate_face_surface` 의 torus chord-tolerant 자동 활용
- Memory: 1 face + 2 edges + 1 vert (vs Path A 289 face) — 99.7% reduction

**Reject 이유**:
- single face (no seam): ADR-021 P7 boundary requirement 위반 가능
- 4-piece split: 복잡, memory unlock 손실

### 9.4 Q4 — 사용자 시연 ζ-step timing

**Default: ε (production flip) **전** 시연 게이트** (ADR-094 B-θ 답습).

- β-1 closure (engine OFF, opt-in localStorage flag 활성) 후
- ε (production ON default) 진입 전
- 사용자가 localStorage flag 명시 활성 후 Real Chromium 시연 PASS 검증

### 9.5 Q5 — Path A → Path B migration UX

**Default: engine default OFF + production localStorage ON + V3 snapshot 호환**.

ADR-094 + ADR-103-ε-1 답습:

- Engine `Mesh::cylinder_path_b_default = false` 답습 (회귀 자산 보존)
- Production layer: `main.ts` 가 `localStorage` 에서 default ON 활성
  - `axia:sphere-path-b-mode = 'true'` (default ON)
  - `axia:cone-path-b-mode = 'true'`
  - `axia:torus-path-b-mode = 'true'`
- Legacy preference: `'false'` 명시 OFF 시 Path A 보존 (ADR-094 답습)
- V3 snapshot 으로 저장 (이미 ADR-103-ε 활성) — Path B 결과 자동 직렬화
- V2 snapshot load: Path A 그대로 로드 (마이그레이션 trigger 안 함, 사용자 명시 후 재생성)

---

## 10. β-1 sub-step decomposition (Sphere Path B)

ADR-094 의 7 sub-step Path Z atomic 답습. β-1 sub-step (β-1-α ~ β-1-η):

| Sub-step | scope | 회귀 estimate | dependency |
|---|---|---|---|
| **β-1-α** | spec sub-PR + Q1-Q5 결재 lock-in | docs only | 본 PR |
| **β-1-β** | Engine `Mesh::create_sphere_kernel_native` (Path B 본체) | +5-8 axia-geo (face count + boundary + invariant) | β-1-α |
| **β-1-γ** | Mesh-level Map `face_to_boundary_loops` 자연 확장 (B-γ-prep 답습) | +2 axia-geo | β-1-β |
| **β-1-δ** | WASM bridge `createSphereKernelNative` + TS wrapper | axia-wasm +2, vitest +3 | β-1-γ |
| **β-1-ε** | Render zero-code-change 확인 + tessellate_face_surface verification | axia-geo +2 (regression guard) | β-1-δ |
| **β-1-ζ** | localStorage `axia:sphere-path-b-mode` flag + production default ON | vitest +3, main.ts wiring | β-1-ε |
| **β-1-η** | Real Chromium 시연 (Playwright slow channel) + closure docs | Playwright +1, docs | β-1-ζ |

### 10.1 β-1-β API design (Sphere Path B engine 본체)

```rust
impl Mesh {
    /// ADR-104 β-1 — Kernel-native sphere creation (Path B).
    ///
    /// Creates a sphere with 1 surface face + 2 pole verts + 1 self-loop
    /// seam edge. 99.7% memory reduction vs Path A polygonal sphere.
    ///
    /// # Lock-ins (ADR-104 Amendment 1 Q1=(c))
    /// - 1 anchor vertex at +Z·radius (north pole)
    /// - 1 south pole vertex at -Z·radius
    /// - 1 self-loop edge (parameter-space seam, no AnalyticCurve metadata)
    /// - 1 face with AnalyticSurface::Sphere attached (chord-tolerant tessellation
    ///   via existing `tessellate_face_surface`)
    ///
    /// # Returns
    /// `Result<FaceId>` — the single Sphere surface face id.
    pub fn create_sphere_kernel_native(
        &mut self,
        center: DVec3,
        radius: f64,
        material: MaterialId,
    ) -> Result<FaceId> { /* ... */ }

    /// ADR-104 β-1-ζ — Default flag for new sphere creation.
    /// `true` → kernel-native (Path B), `false` → polygonal (Path A).
    /// Engine default: `false`. Production caller (main.ts) sets via
    /// localStorage `axia:sphere-path-b-mode`.
    #[serde(skip, default)]
    pub sphere_path_b_default: bool,
}
```

### 10.2 회귀 자산 강제 (절대 #[ignore] 금지)

각 sub-step 별 회귀 자산:

- β-1-β: `adr104_sphere_kernel_native_face_count_1` + `adr104_sphere_kernel_native_2_pole_verts` + `adr104_sphere_kernel_native_invariants_pass` + `adr104_sphere_kernel_native_surface_attached` + `adr104_sphere_kernel_native_memory_reduction_corpus`
- β-1-γ: face_to_boundary_loops 자연 정합 검증
- β-1-δ: TS wrapper round-trip
- β-1-ε: tessellate_face_surface chord-tolerant verification
- β-1-ζ: localStorage round-trip + default ON preference
- β-1-η: real Chromium memory metric capture

---

## 11. β-2 / β-3 sub-step decomposition (간략)

Cone (β-2) 와 Torus (β-3) 도 β-1 패턴 답습 (각각 7 sub-step). 상세는 β-1 closure 후 별도 Amendment.

### 11.1 β-2 Cone Path B API draft

```rust
impl Mesh {
    pub fn create_cone_kernel_native(
        &mut self,
        center: DVec3,
        radius: f64,    // base radius
        height: f64,
        material: MaterialId,
    ) -> Result<Vec<FaceId>>;  // [base_disk, cone_side]
}
```

### 11.2 β-3 Torus Path B API draft

```rust
impl Mesh {
    pub fn create_torus_kernel_native(
        &mut self,
        center: DVec3,
        major_radius: f64,
        minor_radius: f64,
        material: MaterialId,
    ) -> Result<FaceId>;  // single torus surface
}
```

---

## 12. β-1 진입 결재 트리거

**default Q1-Q5 채택 + β-1-α (sub-step decomposition spec) merge 후 β-1-β (engine 본체) 즉시 진입**.

사용자가 default 와 다른 결정을 원할 시 본 PR 검토 시 정정 — Amendment 1 → Amendment 2 sequential evolution 패턴 (ADR-103 답습).

### 12.1 β-1 총 기간 estimate

- β-1-α (spec) : 1일 ✅ 완료 (본 PR)
- β-1-β (engine) : 2-3일
- β-1-γ (Mesh-level Map) : 1일
- β-1-δ (WASM bridge + TS) : 1일
- β-1-ε (Render verification) : 1일
- β-1-ζ (localStorage flag + production ON) : 1일
- β-1-η (시연 + closure) : 1일

→ **β-1 총 1-1.5주 atomic** (ADR-094 답습).

β-2 (Cone) + β-3 (Torus) 동일 estimate → ADR-104 전체 **3-5주 atomic** (§7 답습).

---

## 13. Amendment 2 — Q1 Revision: (c) seam edge → (b) 2-hemisphere (2026-05-15)

Amendment 1 §9.1 의 Q1 default 가 **위상적 misapplication** 으로 판정되어 revision. ADR 불변 정책 (메타-원칙 #10) 정합 — Amendment 1 history 보존, Amendment 2 가 supersede.

### 13.1 Revision 근거

| 항목 | (c) seam edge (Amendment 1) | (b) 2-hemisphere (Amendment 2, 채택) |
|---|---|---|
| **위상** | Sphere = S² (closed manifold, no boundary). Self-loop seam 은 parameter-space 절단일 뿐 실제 manifold 절단 아님 | 적도 closed edge = real Jordan curve in surface, sphere 를 두 영역 (북반구 / 남반구) 으로 분할 |
| **ADR-021 P7** | "closed edge cycle divides face" — 단일 self-loop seam 이 S² 표면을 두 영역으로 분할하지 않음 (Jordan curve theorem 은 평면에서만) | 적도 closed edge 가 sphere 를 정확히 2 영역으로 분할 — strict 정합 |
| **ADR-007 manifold** | 2 isolated pole verts (HE endpoint 아닌 vertex) → invariant 위반 | 각 edge 가 정확히 2 face-bearing HE — clean manifold |
| **ADR-089 답습** | ADR-089 self-loop 는 *planar polygon* boundary (Jordan curve in plane). Sphere seam 은 S² topology — misapplication | ADR-094 Cylinder Path B-full 의 *annulus topology* (3 face / 2 edge / 2 vert) 답습 — *동일 surface manifold split* 패턴 |
| **메타-원칙 #14** | "면은 닫힌 경계로부터 유도된다" — sphere 의 닫힌 경계는 적도 (S² 의 nontrivial cycle). Seam 은 경계 아님 | 적도가 자연 boundary, 면 2개 자연 유도 |
| **Memory** | 1 face + 0 edges + 2 verts (이론) | 2 face + N 적도 edges + N 적도 verts |
| **Memory vs Path A 289 face** | 99.7% reduction (이론) | **99.0%+ reduction** (실제 measurement, 충분히 큰 unlock) |
| **Engine API** | `Result<FaceId>` | `Result<Vec<FaceId>>` ([north_hemi_id, south_hemi_id]) |

### 13.2 채택 사항 (Q1=(b) 2-hemisphere)

**Sphere Path B canonical representation**:

- **2 face**:
  - North hemisphere face: `AnalyticSurface::Sphere` with `uv_range_v ∈ [0, π/2]` (북반구)
  - South hemisphere face: `AnalyticSurface::Sphere` with `uv_range_v ∈ [-π/2, 0]` (남반구)
- **1 equator edge** (closed circular loop):
  - `AnalyticCurve::Circle` with `center, radius, normal = +Z` (ADR-089 closed-curve self-loop on equator vertex)
  - 또는 N polyline edges (chord-tolerant, ADR-031 Phase D infra 활용)
  - **Lock-in**: ADR-089 self-loop variant 채택 (1 anchor vertex on equator + 1 self-loop edge with Circle curve)
- **1 equator anchor vertex** (e.g., `(radius, 0, 0)` — Z-up canonical, ADR-103-ε)
- **0 pole vertices** (sphere 의 pole 은 surface evaluate 의 degenerate point, DCEL vertex 아님 — render 가 `tessellate_face_surface` 의 v-range subset 으로 자동 처리)

### 13.3 ADR-094 답습 패턴

ADR-094 Cylinder Path B-full canonical:

- Cylinder = 3 face (top disk + side annulus + bottom disk) / 2 edge (top/bottom rim) / 2 vert (rim anchors)
- 95% memory reduction vs Path A 25/69/46

Sphere Path B (Q1=(b) 채택):

- Sphere = 2 face (north + south hemisphere) / 1 edge (equator) / 1 vert (equator anchor)
- 99%+ memory reduction vs Path A 289/561/290

→ 동일 architectural 패턴 (single closed curve divides surface into 2 face). Cylinder 가 *두 rim* 으로 *3 face* (top/side/bottom), Sphere 는 *한 적도* 로 *2 face* (north/south). ADR-094 5-Layer Atomic Stack 패턴 1:1 mirror 가능.

### 13.4 β-1-β Engine API 갱신

```rust
impl Mesh {
    /// ADR-104 β-1 (Amendment 2) — Kernel-native sphere creation (Path B,
    /// 2-hemisphere canonical).
    ///
    /// Creates a sphere with 2 hemisphere faces joined at equator.
    /// 99%+ memory reduction vs Path A polygonal sphere.
    ///
    /// # Lock-ins (ADR-104 Amendment 2 Q1=(b))
    /// - 2 hemisphere faces with `AnalyticSurface::Sphere`:
    ///   - North: `uv_range_v ∈ [0, π/2]`
    ///   - South: `uv_range_v ∈ [-π/2, 0]`
    /// - 1 equator anchor vertex (radius * ref_dir, Z-up canonical)
    /// - 1 self-loop edge with `AnalyticCurve::Circle` (center=sphere center,
    ///   radius=sphere radius, normal=+Z)
    /// - ADR-021 P7 strict: equator divides sphere into 2 manifold regions
    /// - ADR-007 manifold: each HE pair has exactly 2 face-bearing HEs
    /// - Tessellate via existing `tessellate_face_surface` with v-range subset
    ///
    /// # Returns
    /// `Result<Vec<FaceId>>` — `[north_hemisphere, south_hemisphere]`
    pub fn create_sphere_kernel_native(
        &mut self,
        center: DVec3,
        radius: f64,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> { /* ... */ }
}
```

### 13.5 회귀 자산 갱신 (Amendment 2)

β-1-β 회귀 자산 변경 (절대 #[ignore] 금지):

- `adr104_sphere_kernel_native_face_count_2` (1 → 2, hemisphere count)
- `adr104_sphere_kernel_native_equator_anchor_vertex_count_1`
- `adr104_sphere_kernel_native_equator_self_loop_edge` (Circle curve attached)
- `adr104_sphere_kernel_native_invariants_pass` (ADR-007 manifold + ADR-021 P7)
- `adr104_sphere_kernel_native_surface_attached_both_hemispheres`
- `adr104_sphere_kernel_native_uv_range_v_subset` (north: [0, π/2], south: [-π/2, 0])
- `adr104_sphere_kernel_native_memory_reduction_corpus` (vs Path A 289/561/290 baseline)
- `adr104_sphere_kernel_native_adr021_p7_equator_divides_strict`
- `adr104_sphere_kernel_native_adr094_pattern_mirror` (cylinder annulus 답습 검증)

### 13.6 Q2 / Q3 영향 평가 (deferred)

Q2 (Cone apex singularity) 와 Q3 (Torus periodic) 도 (b) 답습 가능성 사전 검토:

- **Q2 Cone**: apex 는 degenerate parameter point — 현재 Amendment 1 default (NURBS degenerate edge) 유지 가능. β-2 진입 시 재평가.
- **Q3 Torus**: u/v 모두 periodic — 2-seam (Amendment 1 default) vs 4-piece split. β-3 진입 시 재평가.

본 Amendment 2 는 **Q1 만 revision**, Q2/Q3 는 β-2/β-3 진입 시 별도 Amendment 결재.

### 13.7 Lock-ins (Amendment 2)

- **L-104-Q1-1** (위상 정합): Sphere Path B = 2 hemisphere face joined at equator. (c) seam edge approach 폐기.
- **L-104-Q1-2** (ADR-021 P7 strict): equator closed edge cycle 이 face 분할 boundary. Self-loop seam 의 *parameter-space* 절단 misapplication 영구 차단.
- **L-104-Q1-3** (ADR-094 답습): Cylinder 의 3-face annulus 패턴 1:1 mirror. 단일 closed curve 가 surface 를 N face 로 분할하는 architectural 패턴 일반화.
- **L-104-Q1-4** (Memory unlock 보존): 99%+ reduction 유지 (실제 measurement 가 1 face 이론값보다 N edges 추가 — 큰 model 에서 무시 가능).
- **L-104-Q1-5** (Amendment 1 history 보존): 메타-원칙 #10 정합. Amendment 1 §9.1 의 (c) seam edge 결정 이력 보존, Amendment 2 가 supersede.

### 13.8 β-1-β 진입 unblock

본 Amendment 2 merge 후 β-1-β (engine 본체) 즉시 진입 가능. 사용자 별도 결재 불필요 (Amendment 2 가 default 결재 자체).

**β-1-β atomic merge 강제** (사용자 directive 2026-05-15 정합):
- Engine `create_sphere_kernel_native` + AnalyticSurface uv_range subset + equator edge + WASM bridge + TS wrapper + render verification → **단일 PR atomic** (좌표계/시민권 의미 atomic 정책 답습)
- 중간 상태 (engine 만 / WASM 만 / render 만) 미허용

---

## 14. β-1-β 진입 트리거 (Amendment 2 후)

Amendment 2 merge 후 β-1-β atomic PR 작성:

1. `Mesh::create_sphere_kernel_native` Rust 본체
2. `AnalyticSurface::Sphere` uv_range subset 검증
3. WASM bridge `createSphereKernelNative` + TS wrapper
4. Mesh-level Map `face_to_boundary_loops` 자연 확장
5. Render `tessellate_face_surface` v-range subset 검증
6. 회귀 자산 +9 (Amendment 2 §13.5)

**예상 회귀**: axia-geo +9 (sphere kernel-native) + axia-wasm +2 (bridge) + vitest +3 (TS wrapper) = **+14 atomic**

**예상 기간**: 2-3일 (engine + WASM + TS + render 단일 PR atomic)
