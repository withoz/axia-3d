# ADR-038: Surface-Aware Normals — Analytic Evaluate Priority

**Status**: **Accepted** (2026-05-01) — LOCKED 정책 #16
**Initiative**: AxiA 3D 렌더링 normal 계산 SSOT
**Builds on**: ADR-014 메타-원칙 #13 (One Source, Two Views), ADR-018
(Uniform Surface Render Policy), ADR-031 (Phase D Analytic Surfaces),
ADR-033 (Phase E NURBS Surfaces), ADR-037 (Pick → Promote)

## Context

ADR-037 P22 로 selection 의미론이 owner ID 단위로 잠긴 상태. 다음 단계
는 **선택된 곡면이 시각적으로도 한 덩어리처럼 보이도록 빛 계산을 개선**.

### Step A 진단 결과 (commit 전 측정 — 본 ADR 의 정량 근거)

#### 축 1 — Rust `Mesh::export_buffers()` (mesh.rs:3272-3413)

```rust
// 라인 3285: face 의 representative normal (단일 평면 normal)
let normal = face.normal();

// 라인 3319: vertex 별 smooth normal — DCEL fan 으로 averaging
let smooth = self.compute_smooth_normal_at(loop_hes[i], vid, normal);
//   → 인접 face 들의 normal 을 EDGE_VISIBILITY_ANGLE_DEG 임계 내에서 평균
```

| 검증 | 결과 |
|---|---|
| Per-triangle flat normal 사용 | ❌ (사용 안 함) |
| Per-vertex averaged via DCEL fan | ✅ (적용) |
| AnalyticSurface evaluate | ❌ (`tessellate_face_surface()` 가 mesh.rs:446 에 존재하지만 export_buffers 에 통합 안 됨) |

#### 축 2 — WASM `getMeshBuffers()` 출력

- Layout: parallel array (per-vertex)
- Vertex sharing: **face 별 vertex 분리** (라인 3410: `vert_offset += positions_3d.len()`) — 같은 XYZ 가 face 경계에서 N개 vertex index 로 중복 등장 (의도적 hard edge 보장)

#### 축 3 — Three.js `Viewport.smoothNormals()` (Viewport.ts:1426-1485)

```typescript
// 라인 1417-1421: draw / topology change 후 자동 호출
frameScheduler.schedule('smoothNormals', () => {
  this.smoothNormals(geometry, angleDeg);  // ← Rust normal 덮어씀
});

// 라인 1473-1483: 위치 기준 vertex 용접 (P=0.01mm)
const posMap = new Map<string, number[]>();
//   → Rust 가 face 경계에서 분리한 vertex 들을 다시 위치 기준 그룹화
//   → 연결된 triangle fan 의 normal 평균 + angleDeg threshold
```

| 검증 | 결과 |
|---|---|
| `smoothNormals()` 자동 호출 | ✅ (draw/topology change trigger) |
| Vertex 위치 기준 재용접 | ✅ (P=0.01mm tolerance) |
| Angle threshold 기반 hard edge cull | ✅ (cosThreshold) |
| **Rust normal 을 완전히 덮어씀** | ⚠️ 의도적이지만 Rust 와 일관성 유지 필수 |

#### 발견 — Threshold 불일치

| Layer | 변수 | 값 | 위치 |
|---|---|---|---|
| Rust | `EDGE_VISIBILITY_ANGLE_DEG` | **20.1°** | tolerances.rs:106 |
| Three.js | `angleDeg` | **30°** | Viewport.ts:984 |

→ Rust 가 "hard edge" 로 분리하는 20.1°~30° 사이의 face 경계가 Three.js 에서는 다시 smooth 처리됨. 최종 결과는 Three.js 30° 가 결정 (덮어씀이라). 사용자 인지 영향은 작지만 **architectural drift** 로 잠재 회귀 source.

### 정량화 — 현재 vs 목표

| 항목 | 현재 | 목표 | Gap |
|---|---|---|---|
| Per-triangle flat 회피 | ✅ 적용 | ✅ | 0% |
| Vertex averaging (smooth shading) | ✅ 양쪽 적용 | ✅ | 0% |
| Hard edge cull (angle threshold) | ✅ 양쪽 적용 | ✅ | 0% |
| Threshold 일관성 | ⚠️ 20.1° vs 30° | 단일 SSOT | **drift 차단 필요** |
| AnalyticSurface evaluate | ❌ 0% 적용 | ✅ Phase D/E 활용 | **100% 작업 필요** |

**결론**: "이미 80% 와 있고, 남은 20% 는 (1) AnalyticSurface 통합 + (2) threshold SSOT 일치."

## Decision

### P23 — 새 원칙: Surface-Aware Normal Priority

> **모든 tessellation vertex 의 normal 은 다음 우선순위로 계산한다:**
> 1. **`Face.surface = Some(AnalyticSurface)`** → `AnalyticSurface::normal(u, v)` 직접 evaluate (precision-first, ADR-014 메타-원칙 #13 의 Truth)
> 2. **`Face.surface = None`** → DCEL fan vertex averaging (within `EDGE_VISIBILITY_ANGLE_DEG`) — 산업 CAD 표준
> 3. **Per-triangle flat normal** → 절대 금지 (facet lighting 발생)

### P23 세부 규칙

**P23.1 — Analytic surface evaluate 통합 (신규 작업)**

`Mesh::export_buffers()` 가 face 마다:
1. `face.surface()` 검사
2. `Some(s)` 면 `s.tessellate(chord_tol)` 결과를 사용:
   - 추가 interior vertex 발생 (sphere 의 메리디안 sample 등)
   - 각 vertex 의 (u, v) 에서 `s.normal(u, v)` 정확 평가
3. `None` 면 기존 face plane normal + DCEL fan averaging 유지

**P23.2 — Tessellation chord tolerance 정책**

- Default: 0.1mm (시각 품질 vs 메모리 균형)
- 줌 단계별 LOD: 별도 phase (현 ADR scope 외)
- **`tessellate_face_surface()` 의 chord_tol** 파라미터로 호출자 제어

**P23.3 — Hard / Soft edge angle SSOT**

WASM bridge 가 `angleDeg` 를 export 하여 Rust 와 Three.js 가 동일 값 사용:

```rust
// axia-geo/tolerances.rs (SSOT)
pub const EDGE_VISIBILITY_ANGLE_DEG: f64 = 20.1;
```

```typescript
// Viewport.ts — bridge 에서 가져오기 (hardcode 30 제거)
const angleDeg = bridge.getEdgeVisibilityAngleDeg();  // ← 신규 WASM API
```

새 WASM API: `getEdgeVisibilityAngleDeg(): number` — 단순 const reflect.

**P23.4 — Three.js smoothNormals 가 Rust 결과 존중**

현재 Three.js 가 Rust normal 을 무조건 덮어씀. P23.4 변경:
- Rust 가 analytic evaluate 한 normal 인지 식별 (예: face 의 `has_analytic_surface` flag → vertex 별 메타데이터)
- Analytic 인 vertex 는 Three.js 가 덮어쓰지 않음 (Rust truth 유지)
- 비-analytic 인 vertex 만 Three.js smoothNormals 적용

**P23.5 — 분석적 surface 의 vertex 위치 / normal 정합**

`AnalyticSurface::tessellate(chord_tol)` 의 출력:
```rust
pub struct SurfaceTessellation {
    pub positions: Vec<DVec3>,     // (u, v) 평가 결과
    pub normals: Vec<DVec3>,       // ∂S/∂u × ∂S/∂v 정규화
    pub uvs: Vec<(f64, f64)>,      // 디버깅 / trim 검사용
    pub indices: Vec<u32>,         // triangle list
}
```

`normals[i]` 는 `positions[i]` 의 (uv) 에서 직접 evaluate — averaging 없음.
이게 **AxiA 가 산업 CAD 보다 정확한 이유**:
- 산업 CAD: BRep tessellate → vertex averaging (artifacts)
- AxiA: AnalyticSurface 보존 → exact normal evaluate

**P23.6 — Selection highlight 일관성 (ADR-037 P22.4 cross-link)**

P22.4 의 "owner ID 기준 highlight" + P23 의 "analytic normal" 결합:
- Sphere face 클릭 → 256 triangles 모두 동일 FaceId (P22.5)
- 각 triangle 의 vertex 가 정확한 sphere normal (P23.1)
- 결과: 매끈한 곡면 하이라이트 (segment 끊김 없음)

**P23.7 — 검증 회귀 테스트 (절대 #[ignore] 금지)**

1. **`analytic_sphere_face_emits_evaluated_normals`** — sphere face 의 vertex normal 이 (vertex - center).normalize() 와 1e-6 일치
2. **`analytic_cylinder_face_emits_radial_normals`** — cylinder face 의 vertex normal 이 axis 에 수직 + radial 방향
3. **`planar_face_uses_dcel_averaging_unchanged`** — 기존 planar mesh 의 normal 회귀 0 (regression guard)
4. **`edge_visibility_angle_threshold_matches_rust_and_ts`** — WASM bridge `getEdgeVisibilityAngleDeg()` 가 EDGE_VISIBILITY_ANGLE_DEG 반환

## Implementation

### Module 변경

**Rust 측** (`crates/axia-geo/src/mesh.rs`):
```rust
pub fn export_buffers(&self) -> Result<(...)> {
    for (face_id, face) in self.faces.iter() {
        if let Some(surface) = face.surface() {
            // P23.1 — analytic evaluate path
            let tess = surface.tessellate(0.1);
            // emit positions, normals from tess.positions / tess.normals
        } else {
            // 기존 path (P23.2 — DCEL fan averaging)
            // ...
        }
    }
}
```

**WASM bridge** (`crates/axia-wasm/src/lib.rs`):
```rust
#[wasm_bindgen(js_name = getEdgeVisibilityAngleDeg)]
pub fn get_edge_visibility_angle_deg() -> f64 {
    axia_geo::tolerances::EDGE_VISIBILITY_ANGLE_DEG
}
```

**Three.js 측** (`Viewport.ts`):
```typescript
// 라인 984 변경
const angleDeg = this.bridge.getEdgeVisibilityAngleDeg();
this._scheduleSmoothNormals(geometry, angleDeg);
```

### Migration 단계

1. **P23.3 SSOT 통일** (가장 안전, 별도 PR) — angleDeg 30 → 20.1
   - 시각 변화: 미미함 (대부분 face 경계는 60°+)
   - 회귀 위험: 낮음
2. **P23.1 analytic evaluate 통합** (별도 PR) — Sphere/Cylinder/Cone/Torus/Plane 부터
   - 회귀 위험: 중간 (export_buffers signature 안 바뀌지만 데이터 양 ↑)
3. **P23.4 Three.js 의 Rust 존중** (P23.1 후) — analytic vertex 식별 메타데이터
   - 회귀 위험: 중간

이번 ADR commit 은 결정 잠금 만. 실제 코드 작업은 별도 PR.

## Risks & Mitigations

- **R1** — Analytic tessellation 메모리 ↑: chord_tol 0.1mm 기준 Sphere 32×32 ≈ 1024 vertex. 큰 이슈 아님 (평균 face 의 50배).
- **R2** — Tessellation 시간 ↑: dirty face 만 재tessellate (delta buffer 시스템 활용).
- **R3** — `tessellate_face_surface()` 와 `face.outer_loop` 의 정합 — analytic surface 의 trim_loops 과 face boundary 의 일관성. ADR-033 P18.10 (Surface ≠ Face) 와 cross-check.
- **R4** — Threshold 변경 (30° → 20.1°) 의 사용자 인지: 기존 box/cube 등 90° edge 는 영향 없음. 곡면 polygon (6각/8각 prism 의 60°/45° edge) 만 영향 — 시각적으로 더 sharp 하게 보일 수 있음.
- **R5** — Three.js smoothNormals 가 analytic evaluate 결과를 덮어쓰지 않도록 변경 — flag 기반 선택적 skip.

## Success Criteria

- ✅ ADR-038 의 P23 가 commit 으로 고정 (이 PR)
- ✅ CLAUDE.md LOCKED #16 추가
- ⏳ P23.3 SSOT 통일 (별도 PR)
- ⏳ P23.1 analytic evaluate 통합 + P23.7 4 회귀 테스트
- ⏳ Sphere / Cylinder visualization 검증

## References

- ADR-014 메타-원칙 #13 (One Source, Two Views)
- ADR-018 (Uniform Surface Render Policy — sheet vs wall 구분)
- ADR-031 (Phase D Analytic Surfaces — `SurfaceOps::tessellate / normal`)
- ADR-033 (Phase E NURBS Surfaces)
- ADR-037 (Pick → Promote)
- 산업 CAD 의 BRep visualization (Parasolid Render Mesh, OCCT
  BRepMesh_IncrementalMesh)

## 변경 이력

- **2026-05-01 (initial)**: P23 채택. Step A 진단 결과를 정량 근거로 사용.
  3 단계 우선순위 (Analytic evaluate → DCEL averaging → ❌Flat) +
  threshold SSOT 통일 (P23.3) + Three.js 가 Rust 존중 (P23.4) + 4
  회귀 테스트 (P23.7).
