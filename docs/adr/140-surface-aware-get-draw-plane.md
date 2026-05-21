# ADR-140 — Surface-aware `getDrawPlane` (곡면 face 위 도구 정확도 본격 활성)

**Status**: α spec (β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-23
**Author**: WYKO + Claude
**Trigger**: 외부 에이전트 audit (사용자 공유 2026-05-23) P1 권장 +
  본 세션 chain (PR #140 K3 / PR #141 demo / PR #142 Path B annulus
  owner_id / PR #143 K1 MVP / PR #144 P2) 의 자연 architectural anchor.
**Supersedes 가능**: 보고서 권장 ADR-101 (closed-curve split) 번호 정정
  — ADR-101 은 이미 main 의 "Coplanar Partial Overlap Auto-Intersect"
  (LOCKED #41). 보고서의 ADR-101 권장 → **ADR-140** (본 ADR).

## Canonical anchor (외부 에이전트 audit, 2026-05-23)

> "곡면 face — CHORD FALLBACK (핵심 결함)
>  - getDrawPlane()가 surface-aware 아님 — 단일 DCEL face normal만 사용
>  - ADR-038 P23 (surface-aware normals)이 render에만 적용, 도구 입력
>    경로 미적용
>  - 첫 click은 정확(raycast hit point), 두 번째부터 chord plane 강제
>  - DCEL split + surface metadata clone OK, 그러나 결과 line은 chord
>    substitute (helix/geodesic 아님)
>  - 실린더 옆면, Sphere, Cone, Torus, NURBS surface 모두 chord plane
>    fallback"

→ **getDrawPlane 의 surface-aware 정합 강제** — ADR-038 P23 render 인프라
의 도구 입력 경로 1:1 mirror.

## 1. Problem statement

### 1.1 현재 동작 (chord fallback)

```
사용자 시연 시나리오 — Cylinder 측면 (Path B annulus) 위에 DrawLine:
1. 첫 click on cylinder side surface
   → Three.js raycast hit point (정확한 surface 위치) ✓
2. getDrawPlane(faceId) 호출
   → DCEL face.normal() 반환 (single plane normal)
   → Cylinder annulus 의 face normal 은 실제로는 **각 위치마다 다른 radial direction**
3. 두 번째 click — raycaster 가 chord plane 과 intersect
   → click 위치는 cylinder surface 가 아닌 chord plane 위
4. drawLineAsShape(p1, p2) 호출
   → DCEL 에 chord line 추가 (cylinder surface 위 helix/geodesic 아님)
5. 결과 split line = chord substitute (시각 정합 어긋남)
```

### 1.2 영향 surface kinds (5개)

ADR-031 Phase D analytic surface primitives:
- **Cylinder** (axis + radius) — 첫 click 정확 / 두 번째부터 chord
- **Sphere** (center + radius) — 동일
- **Cone** (apex + half_angle) — 동일
- **Torus** (major + minor radius) — 동일
- **NURBS** (Bezier/BSpline/NURBS surface) — 동일

### 1.3 architectural gap

| 측면 | 현재 | 필요 |
|---|---|---|
| Render layer (ADR-038 P23) | ✅ Surface-aware normals (Gouraud smoothing) | 활성 |
| Tool input layer (getDrawPlane) | ❌ DCEL face.normal() only | **활성 필요** |
| WASM bridge | ✅ `bridge.faceSurfaceKind(fid)` 존재 | 재활용 |
| AnalyticSurface API | ✅ `normal_at_world_pos()` 존재 | 재활용 |

→ **인프라는 이미 존재** — getDrawPlane 분기 추가만 필요. 새 알고리즘 0.

## 2. Solution — Surface-aware `getDrawPlane`

### 2.1 기본 원칙

`getDrawPlane(faceId)` 가 호출되면:
1. **kind ≤ 1 (Plane / None)** — 기존 동작 보존 (DCEL face.normal())
2. **kind ≥ 2 (Cylinder/Sphere/Cone/Torus/NURBS)** — surface-aware path:
   - 현재 raycast hit point P 받기
   - `AnalyticSurface::normal_at_world_pos(P)` evaluate
   - tangent plane at P 반환 (origin=P, normal=evaluated)

### 2.2 코드 path (제안)

**TS** (Viewport.ts / ToolManager.ts):
```typescript
getDrawPlane(faceId: number, hitPoint?: THREE.Vector3): DrawPlane | null {
  if (faceId < 0) return this.fallbackToGroundPlane();
  
  const kind = this.bridge.faceSurfaceKind(faceId);
  if (kind <= 1) {
    // Plane / None — 기존 DCEL face normal
    return this.bridge.getFaceDrawPlane(faceId);
  }
  
  // Surface-aware (kind ≥ 2)
  if (hitPoint) {
    const result = this.bridge.faceSurfaceNormalAtPos(
      faceId,
      hitPoint.x, hitPoint.y, hitPoint.z,
    );
    if (result) {
      return {
        origin: new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z),
        normal: new THREE.Vector3(result.nx, result.ny, result.nz),
        surfaceKind: kind,  // surface-aware flag
      };
    }
  }
  
  // Fallback: DCEL face normal (chord substitute, current behavior)
  return this.bridge.getFaceDrawPlane(faceId);
}
```

**Rust/WASM** (axia-wasm/src/lib.rs):
```rust
#[wasm_bindgen(js_name = "faceSurfaceNormalAtPos")]
pub fn face_surface_normal_at_pos(
    &self,
    face_id: u32,
    x: f64, y: f64, z: f64,
) -> Option<NormalResult> {
    let fid = FaceId::from_raw(face_id);
    let face = self.scene.mesh.faces.get(fid)?;
    let surface = face.surface().as_ref()?;
    let point = DVec3::new(x, y, z);
    let normal = surface.normal_at_world_pos(point)?;
    Some(NormalResult { nx: normal.x, ny: normal.y, nz: normal.z })
}
```

### 2.3 Surface-aware path 적용 사례

#### Cylinder side (annulus)
```
hit point P on cylinder surface
  → AnalyticSurface::Cylinder.normal_at_world_pos(P)
  → radial direction (P - axis_projection) / radius
→ tangent plane: origin=P, normal=radial_outward
→ 두 번째 click 이 tangent plane 위 (cylinder surface 매우 근접)
→ split line = tangent chord (cylinder 따라가는 자연 근사)
```

#### Sphere surface
```
hit point P on sphere
  → AnalyticSurface::Sphere.normal_at_world_pos(P)
  → (P - center) / radius
→ tangent plane: origin=P, normal=radial
→ 두 번째 click 이 sphere tangent plane 위 (geodesic 근사)
```

#### NURBS surface
```
hit point P on NURBS surface
  → AnalyticSurface::NURBSSurface.normal_at_world_pos(P)
  → ∂S/∂u × ∂S/∂v at projected (u, v)
→ tangent plane: origin=P, normal=evaluated
```

## 3. Sub-step plan (Path Z atomic)

### 3.1 Plan 매트릭스

| Sub-step | Scope | 비용 |
|---|---|---|
| **140-α** | 본 ADR spec (본 commit) | 30분 |
| **140-β** | WASM bridge — `face_surface_normal_at_pos` export 신규 | ~1일 |
| **140-γ** | TS bridge wrapper + interface | ~1시간 |
| **140-δ** | `getDrawPlane(faceId, hitPoint?)` signature 확장 + dispatch | ~1일 |
| **140-ε** | 도구별 통합 (DrawLine / DrawRect / DrawCircle / Sketch) | ~1-2일 |
| **140-ζ** | 회귀 자산 추가 (~20~30 tests) — Cylinder/Sphere/Cone/Torus chord error 측정 | ~1-2일 |
| **140-η** | E2E + 사용자 시연 검증 | ~1일 |

**총 예상 소요**: ~6-8일 atomic.

### 3.2 Path Z atomic 답습 (ADR-094 / ADR-097 / ADR-139)

- 140-β: 가장 작은 sub-step (WASM export 1개 추가, ADR-093 D-γ 패턴 답습)
- 140-δ: getDrawPlane signature 확장 — backward compat (`hitPoint?: optional`)
- 140-ε: 도구별 분기 add — 기존 도구 회귀 0 보장
- 140-η: 사용자 시연 게이트 (ADR-087 K-ζ canonical 답습)

### 3.3 Sub-step 별 회귀 자산 예상

| Sub-step | 회귀 추가 |
|---|---|
| 140-β | axia-wasm +1 (export_baseline) + axia-geo +3 (surface normal eval) |
| 140-δ | vitest TS +5 (kind dispatch) |
| 140-ε | vitest TS +10 (도구별 surface-aware) |
| 140-ζ | axia-geo +15 (chord error 측정 — Cylinder/Sphere/Cone/Torus) |
| **합계** | ~34 회귀 자산 |

## 4. Lock-ins (β implementation 진행 시)

- **L-140-1** ADR-038 P23 render 인프라 1:1 mirror (새 알고리즘 0)
- **L-140-2** Backward compat — `hitPoint?` optional signature (기존 caller 영향 0)
- **L-140-3** Surface kind ≤ 1 (Plane/None) 경로 보존 — 기존 DCEL face
  normal 동작 유지
- **L-140-4** Surface kind ≥ 2 (Cylinder/Sphere/Cone/Torus/NURBS) 모두
  통합 — 별도 분기 없이 `normal_at_world_pos` 한 path
- **L-140-5** Fallback: surface 없거나 normal_at_world_pos 실패 시 기존
  DCEL face normal (graceful degradation)
- **L-140-6** 도구별 영향 — DrawLine / DrawRect / DrawCircle / Sketch 모두
  자동 혜택 (getDrawPlane 의 단일 SSOT)
- **L-140-7** ADR-139 vision 정합 — 명시 trigger (사용자 click) + 자동
  보정 (surface-aware) 결합
- **L-140-8** 절대 #[ignore] 금지

## 5. 사용자 facing 변화 (140-ε 후)

### Before (chord fallback)

```
사용자: Cylinder 측면 위에 DrawLine 그리기
  첫 click → 정확한 위치 ✓
  두 번째 click → chord plane 위 (cylinder surface 와 어긋남)
  결과: split line = chord substitute (geodesic 아님)
```

### After (surface-aware)

```
사용자: Cylinder 측면 위에 DrawLine 그리기
  첫 click → 정확한 위치 ✓
  두 번째 click → tangent plane 위 (cylinder surface 근접)
  결과: split line = tangent chord (cylinder 따라가는 자연 근사)
```

→ **사용자 facing 곡면 도구 정확도 즉시 향상** (ADR-038 P23 render 인프라
의 도구 입력 path 통합).

## 6. Out of scope

- True geodesic line (cylinder helix / sphere great circle) — 별도 ADR
  (curve-on-surface 정합)
- Sketch on cylindrical face — ADR-046 P31 Phase 3 mode workspace
- Multi-face draw (cylinder side + top edge 연결) — 별도 ADR
- NURBS surface UV-based draw — Phase L NURBS roadmap

## 7. Cross-link

- 보고서 audit (외부 에이전트 2026-05-23) — P1 권장 source
- ADR-038 P23 (Surface-aware normals — render 인프라, 본 ADR 의 1:1 mirror anchor)
- ADR-031 Phase D (AnalyticSurface primitives — `normal_at_world_pos` source)
- ADR-093 D-γ (WASM bridge export 패턴 답습)
- ADR-089 (closed-curve face canonical — Cylinder/Sphere annulus)
- ADR-094 (Path B kernel-native cylinder)
- ADR-104 (Path B Expansion — Sphere/Cone/Torus)
- 본 세션 chain: PR #140 K3 / PR #141 demo / PR #142 Path B annulus
  owner_id / PR #143 K1 MVP / PR #144 P2
- ADR-139 (Boundary tool vision — 명시 trigger + 자동 보정 정합)
- 메타-원칙 #4 (SSOT — getDrawPlane 단일 진입점)
- 메타-원칙 #14 (WHAT 결과 invariant — 정확한 surface 위치)

## 8. Acceptance Log

- **2026-05-23 α** (본 commit) — α spec + sub-step plan + lock-ins.
- **(β implementation, multi-day)** — atomic Path Z sub-step (140-β ~ 140-η)
  별도 사용자 결재 후 진행.

---

**다음 trigger**: β implementation 진입 결재 (140-β WASM export 부터)
또는 우선순위 priority track 결정 (Track A P7 / Track B β-3 등과의
비교).
