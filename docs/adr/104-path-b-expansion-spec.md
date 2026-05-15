# ADR-104 — Path B Expansion (Sphere / Cone / Torus)

| Field | Value |
|---|---|
| Status | **Proposed (α — spec only, sub-step roadmap pending sign-off)** |
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
