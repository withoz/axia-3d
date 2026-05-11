# ADR-062 — Phase L₂ Path Z: Validated Surface Attach (Pilot)

**Status**: Draft + Amendment 1 (refinements 적용 2026-05-04, Step 1 진입 승인)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase L₂, Path Z 좁은 pilot)
**Parent**: ADR-052 §2.x Phase L₂
**Prerequisites**: ADR-061 Phase P-narrow 완료 (917 axia-geo + 7 axia-wasm
+ 21 cache invariants)
**Related**: ADR-031 Phase D (Surface attach), ADR-038 P23 (Surface-Aware
Normals), ADR-057 Phase L₁ (Advanced surfaces), ADR-061 (Phase P-narrow)
**Future**: ADR-063 (Path Y full mutation), ADR-064 (NURBS Boolean →
DCEL), ADR-065 (Surface-true STEP export) — 본 ADR 의 stepping stones

---

## 0. Summary (4 lines)

> Phase L₂ "Surface SSOT" 전체 선언은 scope 폭발 (6+개월). Path Z 좁은
> pilot — 사용자가 face 에 analytic surface 를 **검증과 함께** 부착할
> 수 있는 최소 단위. modify (radius 변경 등) 는 별도 ADR. tensor surface
> 와 boundary 자동 재생성도 별도. 6 회귀 / 1.5-2주.

---

## 1. Context — Why Path Z 만 진행하는가

### 1.1 Phase L₂ 풀 scope 의 위험

ADR-062 사전 검토에서 발견:
- Phase L₂ "Surface SSOT" 단일 ADR 시 6+개월 작업
- 5개 sub-ADR (062-A ~ 062-E) 분할 권장됨
- 사용자 결정: **Path Z = Validated Attach pilot 만**

### 1.2 현재 코드의 비대칭

```
attach 경로 존재 (Phase O 도구):
  - Phase O Step 5 fillet_brep_constant_linear → set_face_surface(Cylinder)
  - Phase O Step 3 push_pull → set_face_surface(translated Plane)
  - Phase D primitive tool → set_face_surface(primitive)

검증 경로 부재:
  - 사용자 / AI agent / script 가 set_face_surface 직접 호출 시 검증 없음
  - 잘못된 surface attach → ADR-038 normal 깨짐 (silent wrong-render)
  - Phase P-narrow cache 가 wrong-but-version-matched 데이터 저장
```

### 1.3 Path Z 가 풀 사용자 pain

**P1 (한 명의 페르소나)**: 사용자가 face 를 보고 "이건 사실 Cylinder 다"
선언 가능해야 함. 시스템이 boundary 가 cylinder 위에 있음을 검증 후 부착.

**P3 (AI agent)**: WASM endpoint 로 외부 코드가 surface 를 attach 할 때
검증 받아야 — silent wrong attach 차단.

---

## 2. Decision — Z.2 Validated Attach + 7개 D 결정 + 6 영구 Lock-in

### 2.1 §A — Z.2 의미 (Z.1 modify 와의 구분)

**채택 (Z.2)**: 새 surface 를 부착할 때 boundary verts 가 surface 위에
±tolerance 이내인지 검증 → 통과 시 attach, 실패 시 명시 거부.

**제외 (Z.1)**: 기존 surface 의 필드 (radius / control point 등) 직접
변경. drift 발생 위험 → Path Y full 별도.

**제외 (Z.3)**: u_range / v_range 등 parameterization 만 변경. 의미는
안전하나 사용자 가치 거의 없음 → 후속 결정.

### 2.2 §B — API 형태 (Rust)

```rust
/// ADR-062 §B — Outcome of validated surface attach (Amendment 1: 6 variants).
#[derive(Clone, Debug, PartialEq)]
pub enum SurfaceAttachOutcome {
    /// Successfully attached. `previous_kind` records what was there
    /// (None if face was polygon / Some("Plane") etc.).
    Attached { previous_kind: Option<&'static str> },
    /// Some boundary vertex's distance to the new surface exceeds tol.
    BoundaryDriftExceedsTol {
        max_drift_mm: f64,
        tol_mm: f64,
        worst_vertex_idx: usize,
    },
    /// Surface kind not yet supported by Path Z pilot (tensor variants).
    UnsupportedSurfaceKind { kind: &'static str },
    /// Face has no outer loop (degenerate).
    NoOuterLoop,
    /// Face is inactive (soft-deleted).
    InactiveFace,
    /// **Amendment 1** — Surface input has degenerate parameters
    /// (radius ≤ 0, axis_dir ≈ ZERO, half_angle ≤ 0 or ≥ π/2, etc.).
    /// Detected pre-distance to avoid NaN/Inf cascade.
    DegenerateSurfaceInput { reason: &'static str },
}

impl Mesh {
    /// ADR-062 Path Z — Validated surface attach.
    ///
    /// Computes the closed-form distance from each face outer-loop
    /// vertex to the new surface. If max distance ≤ `tol_mm`, calls
    /// `set_face_surface` (existing raw API) which auto-bumps Phase
    /// P-narrow normal cache. Otherwise rejects with explicit reason.
    pub fn attach_surface_validated(
        &mut self,
        face_id: FaceId,
        surface: AnalyticSurface,
        tol_mm: f64,
    ) -> SurfaceAttachOutcome
}
```

### 2.3 §C — Per-kind distance helpers

```rust
impl AnalyticSurface {
    /// ADR-062 §C — Closed-form unsigned distance from world-space
    /// point to surface. Returns `None` for tensor variants (uv
    /// inversion deferred to Path Y).
    pub fn unsigned_distance_to(&self, pos: DVec3) -> Option<f64>;
}
```

5종 closed-form (Amendment 1: degeneracy 명시):
- **Plane**: `|(pos - origin) · normal|`
- **Cylinder**: `|radial_distance - radius|` where radial = pos projected ⊥ to axis.
  - **D-C lock-in**: u_range/v_range trim 무시 — primitive 위면 OK.
- **Sphere**: `|distance(pos, center) - radius|`. u_range/v_range 무시 (D-C).
- **Cone**: distance to nearest cone surface ray.
  - **D-A lock-in**: behind-apex (along -axis_dir) 점은 apex 거리로 취급
    (option a). Cone 은 +axis_dir 단방향 — behind 는 자연 거부됨.
- **Torus**: distance to torus = `|(pos - ring_center).length() - minor_radius|`
  where ring_center = (in-plane projection) × major_radius from center.
  - **D-B lock-in**: pos 가 torus axis 위 (in_plane = ZERO) → `Some(f64::INFINITY)`
    반환 (option c — 강제 거부). Validated attach 가 자동으로 BoundaryDrift
    로 거부.

Tensor (BezierPatch / BSplineSurface / NURBSSurface): `None` — 사용자가
attach_surface_validated 시 `UnsupportedSurfaceKind` 반환.

**ATTACH_VALIDATE_TOL 상수** (tolerances.rs 신규):
```rust
/// ADR-062 Path Z — Default tolerance for attach_surface_validated
/// boundary-fit check. 1μm absolute (mm). Above LOCKED #5 1.5μm dedup
/// floor. Caller can override per-call.
pub const ATTACH_VALIDATE_TOL: f64 = 1e-3;
```

### 2.4 §D — 7개 D 결정 (확정)

| D | 결정 | 비고 |
|---|------|------|
| **D1** | Z.2 (validated attach) | Z.1 modify 별도 ADR, Z.3 미관심 |
| **D2** | 5종 primitives (Plane/Cylinder/Sphere/Cone/Torus) | tensor 거부 + reason |
| **D3** | Default tol = 1e-3 mm (1μm) | LOCKED #5 1.5μm 미세 위 |
| **D4** | Boundary regen 미포함 | Path Y full 별도 |
| **D5** | 기존 set_face_surface (raw, 검증 없음) 유지 | naming 구분: raw vs validated |
| **D6** | UI 도구 추가 별도 ADR | 본 ADR backend 만 |
| **D7** | 회귀 7개 (절대 #[ignore] 금지) | §X.5 lock-in #6 strict (Amendment 1: 6→7) |
| **D-A** | Cone behind-apex → apex 거리 | option (a) — tol 로 사용자 결정 |
| **D-B** | Torus axis-on-pos → `+∞` | option (c) — 강제 거부 |
| **D-C** | u/v range trim 검증 | option (a) 무시 — pilot 외 |
| **D-D** | WASM 5개 per-kind endpoint | W2 — 기존 setFaceSurface* 패턴 일관 |

### 2.5 §E — 6 영구 Lock-in

```
1. Validated attach 만 — modify (radius/ctrl_pt 변경) 본 ADR scope 외.
   변경 시 새 ADR + drift 정책 결정 필요.

2. Tensor surface (Bezier/BSpline/NURBS) MVP 제외.
   UnsupportedSurfaceKind 명시. 변경 시 uv inversion 알고리즘 + ADR.

3. Boundary 자동 재생성 금지.
   surface attach 후에도 mesh DCEL 변경 0. Path Y 별도.

4. tol 인자 명시 — silent default 거부.
   API caller 가 tol 명시. WASM endpoint 는 tol ≤ 0 → default 1e-3mm.

5. 기존 set_face_surface raw API 유지.
   Naming: raw 는 `set_face_surface()`, validated 는
   `attach_surface_validated()`. 두 path 모두 Phase P-narrow cache 자동
   invalidate (Step 1a 의 set_surface 자동 hook 활용).

6. WASM additive-only (ADR-060 §D 정합).
   기존 export 변경 0. baseline 회귀가 강제. W2 패턴: 5개 per-kind
   endpoint 신규 (Plane/Cylinder/Sphere/Cone/Torus 각각 attach 검증판).
```

---

## 3. Acceptance — 5-step + 6 회귀 (사용자 사인-오프 후)

### 3.1 Step 분해 (예상 1.5-2주)

| Step | 영역 | 회귀 | 위험 |
|------|------|------|------|
| 1 | `unsigned_distance_to` per-kind (5 primitives + degenerate detection) + `ATTACH_VALIDATE_TOL` 상수 | 2 | 저 |
| 2 | `SurfaceAttachOutcome` (6 variants) + `Mesh::attach_surface_validated` | 3 | 저 |
| 3 | WASM 5개 per-kind endpoint (Plane/Cylinder/Sphere/Cone/Torus) + JSON outcome | 1 | 저 |
| 4 | Phase O Step 3/5 비-충돌 + previous_kind 회귀 | 1 | 저 |
| 5 | 종합 + WASM 재빌드 + baseline 갱신 | 0 | 저 |
| **합계** | — | **7** | — |

### 3.2 7 회귀 invariants (Amendment 1: 6→7, 절대 #[ignore] 금지)

1. **`attach_validated_succeeds_when_boundary_fits`** — Cylinder 위 4 verts → `Attached { previous_kind: None }`
2. **`attach_validated_rejects_drift`** — 잘못된 radius → `BoundaryDriftExceedsTol { max_drift_mm > tol_mm }`
3. **`attach_validated_rejects_tensor_mvp`** — BezierPatch → `UnsupportedSurfaceKind { kind: "BezierPatch" }`
4. **`attach_validated_invalidates_normal_cache`** — Phase P-narrow §D #3 정합 (set_surface auto-bump 활용)
5. **`attach_validated_replace_existing_records_previous_kind`** — Plane → Cylinder → `previous_kind = Some("Plane")`
6. **`attach_validated_json_includes_schema_version`** — WASM JSON `{schemaVersion: 1, ok, outcome, ...}`
7. **`attach_validated_rejects_degenerate_input`** (Amendment 1) — Cylinder
   { radius: 0 } 또는 axis_dir = ZERO → `DegenerateSurfaceInput { reason }`

### 3.3 JSON outcome shape (Amendment 1 — WASM W2 패턴)

```json
{
  "schemaVersion": 1,
  "ok": true,
  "outcome": "Attached" | "BoundaryDriftExceedsTol" | "UnsupportedSurfaceKind"
           | "NoOuterLoop" | "InactiveFace" | "DegenerateSurfaceInput",
  "previousKind": "Plane" | null,
  "maxDriftMm": 0.0042,
  "tolMm": 0.001,
  "worstVertexIdx": 2,
  "unsupportedKind": "BezierPatch",
  "reason": "axis_dir is zero vector"
}
```

Discriminated union via `outcome` 키 — 각 outcome 마다 사용 필드 부분집합.
Consumer (TS) 는 `outcome` 분기 후 변종별 필드 access.

### 3.3 위험 매트릭스

| 위험 | 대책 |
|------|------|
| R1 drift 검증 부정확 | 회귀 1, 2 + per-kind 단위 테스트 |
| R2 tensor 미지원 사용자 혼란 | UnsupportedSurfaceKind reason + 문서 |
| R3 Phase P-narrow cache 통합 | set_surface 자동 hook 활용 (변경 0) |
| R4 raw API 와의 분리 | 명명 + ADR docs |
| R5 tol 정책 | LOCKED #5 floor + 사용자 인자 |
| R6 WASM additive 위반 | baseline 회귀가 강제 |
| R7 사용자 즉각 가치 작음 | UI 통합 별도 ADR — backend 만 명시 pilot |

---

## 4. Path Y 와의 관계 (Future ADR map)

```
ADR-062 (본 pilot, Path Z) — Validated Attach (현재)
  ↓ 안전한 surface 부착 가능
ADR-063 (Path Y mutation) — Surface modify + boundary regen
  ↓ control point 직접 편집
ADR-064 (Path Y Boolean) — NURBS Boolean → DCEL 실제 변환
  ↓ Phase O Step 4 mesh fallback 폐지
ADR-065 (Path Y STEP) — Surface-true STEP/IGES export
```

본 ADR 단독으로도 가치 있음 — surface attach 검증 인프라 확보.

---

## 5. References

- ADR-052 master roadmap §2.x Phase L₂
- ADR-031 Phase D (Surface attach foundation)
- ADR-038 P23 (Surface-Aware Normals — drift 발생 시 영향)
- ADR-057 Phase L₁ (Advanced surface types)
- ADR-061 Phase P-narrow (cache invalidation hooks 활용)
- ADR-060 §D (WASM additive-only)
- 사용자 사전 검토 + Path Z 채택 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Draft — Step 1 sign-off 대기
