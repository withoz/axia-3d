# ADR-140 — Surface-aware `getDrawPlane` (곡면 face 위 도구 정확도 본격 활성)

**Status**: Accepted (β implementation 자연 closure 2026-05-24 — α/β/γ/δ/ε-1/ζ 6 sub-step merged + ε-2/ε-3/ε-4 LOCKED #63 strict 거부 후 future ADR, η 사용자 시연 deferred)
**Date**: 2026-05-23 (α) ~ 2026-05-24 (ζ closure)
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

- **2026-05-23 α** (PR #145, 5df58ef) — α spec + sub-step plan + lock-ins.
- **2026-05-23 β** (PR #147, 0eaa856) — `faceSurfaceNormalAtPos` WASM
  export 신규 (axia-wasm). Rust signature: `(face_id, x, y, z) -> Vec<f64>`,
  empty 또는 3-element `[nx, ny, nz]` 반환. Zero-normal degenerate
  (length_squared < 1e-20) 자동 filter — 예: cone apex.
- **2026-05-24 γ** (PR #160, 9305cfc) — TS bridge wrapper
  `WasmBridge.faceSurfaceNormalAtPos(faceId, x, y, z): Float64Array | null`
  추가. Graceful failure 5-case 회귀 (engine missing / export missing /
  empty Float64Array / zero-normal / malformed length). `AxiaEngineExtended`
  interface 에 optional method 선언. ADR-093 D-γ 패턴 답습 (defensive
  guard + null fallback). 회귀 vitest +7 (WasmBridge.test.ts `ADR-140 γ`
  block). 사용자 facing 변화 0.
- **2026-05-24 δ** (PR #161, 1126dde) —
  `ToolManagerRefactored.getDrawPlane` 의 내부 surface-aware dispatch
  활성. `DrawPlaneInfo` 확장 (optional `origin?: THREE.Vector3` +
  `surfaceKind?: number`, backward-compatible). Dispatch 규칙:
  - kind ≤ 1 (Plane/None) → 기존 DCEL face normal (chord plane, legacy
    behavior 불변)
  - kind ≥ 2 (Cylinder/Sphere/Cone/Torus/NURBS) + `hit.point` 있음 →
    `bridge.faceSurfaceNormalAtPos(fid, P)` 평가 → tangent plane at P
    (origin=P, normal=evaluated)
  - kind ≥ 2 but degenerate (faceSurfaceNormalAtPos returns null) →
    graceful fallback to DCEL face normal (L-140-5 정합)
  - kind ≥ 2 but hit.point missing (defensive) → DCEL fallback
  회귀 vitest +6. 사용자 facing 변화 0 (caller 가 origin/surfaceKind 사용
  전 — ε 진입 전). **Fix-cycle**: 첫 CI run 시 5/5 회귀 fail (faceMap
  empty → getFaceId -1 → defaultPlane early return) → `beforeEach((tm as any).faceMap = new Uint32Array([7]))` setup
  추가 + fid=7 expectation 정합 → force-push 후 6/6 PASS.
- **2026-05-24 ε-1** (본 commit, DrawLineTool integration) —
  `DrawLineTool.establishDrawingPlane` 의 face-hit branch 가
  `ctx.getDrawPlane` SSOT 통합. 변경 요약:
  - kind ≤ 1 (Plane/None) → `dp.normal` (DCEL face normal) +
    `hit.point` (legacy fallback origin) — **legacy 동등**
  - kind ≥ 2 (Cylinder/Sphere/Cone/Torus/NURBS) → `dp.normal` (tangent
    normal) + `dp.origin` (surface-aware hit point P) — **사용자
    facing 변화 시작** (Cylinder/Sphere surface 위 DrawLine chord
    substitute 회피)
  - dp.onFace=false (defensive) → 기존 hit.face.normal + matrixWorld
    transform path (legacy behavior 100% 보존)
  회귀 vitest +4 (DrawLineTool.test.ts `ADR-140 ε-1` block):
  Plane legacy / Cylinder surface-aware / defensive fallback / no-face
  branch unchanged. `mockToolContext` 에 `getDrawPlane` mock 추가
  (default returns onFace:false — 기존 테스트 회귀 0).
- **2026-05-24 ε track audit-first finding (LOCKED #63 strict 충돌)** —
  audit-first canonical 적용으로 다음 finding 명시 (silent 진행 회피):
  - **ε-2 (DrawRectTool)**: `resolveCardinalPlane()` 만 사용 — LOCKED #63
    cardinal plane only strict 정합. surface-aware 적용 시 RECT 가
    cylinder surface 위 그려질 가능 → LOCKED #63 위반. **거부**.
  - **ε-3 (DrawCircleTool)**: 이미 `ctx.getDrawPlane(e)` 사용하나
    `circleCenter = point.clone()` (get3DPoint cardinal-forced).
    `dp.origin` 활용 시 cardinal force 와 architectural 충돌. **거부**
    (origin 사용 불가).
  - **ε-4 (Sketch session)**: SketchSession plane = user explicit
    (LOCKED #63 §L-63-7 예외). surface-aware sketch session 은 별도
    architectural ADR 필요 (LOCKED #63 cardinal force ↔ surface-aware
    origin 의 reconciliation).
  → **ADR-140 ε track 자연 closure** (ε-1 only). ε-2/ε-3/ε-4 는 별도
  ADR (가칭 "Surface-aware on cardinal-force tools — architectural
  reconciliation") future work.
- **2026-05-24 ζ** (본 commit) — chord error 회귀 자산 (Cylinder/Sphere/
  Cone/Torus + Plane baseline). `crates/axia-geo/src/surfaces/mod.rs`
  tests block 에 ADR-140 ζ block 추가 (+5 회귀):
  - `chord_error_angle` helper — surface normal 와 chord normal 의
    angular difference 측정 (acos of dot product)
  - `adr140_zeta_plane_chord_error_is_zero` — baseline (flat surface
    → error 0, surface-aware == chord)
  - `adr140_zeta_cylinder_chord_error_proportional_to_arc` — 12-seg vs
    24-seg refinement, geometric expectation lock (err > 0.05 rad,
    err < chord arc)
  - `adr140_zeta_sphere_chord_error_along_meridian` — 30° meridian arc
  - `adr140_zeta_cone_chord_error_varies_along_axis` — 30° half-angle
    + 30° azimuth
  - `adr140_zeta_torus_chord_error_dual_curvature` — major R=10 +
    minor r=2, outer equator 15° arc
  본 회귀 자산은 ADR-140 β implementation 의 *architectural value
  evidence* — surface-aware normal 가 chord plane normal 와 얼마나
  다른지 정량 lock. ε-1 (DrawLine) 통합의 측정 가능한 정확도 향상의
  baseline. 사용자 facing 변화 0.
- **2026-05-24 closure** (본 commit) — ADR-140 β implementation 자연
  closure marker. Status: **Draft → Accepted**. 6 sub-step merged
  (α/β/γ/δ/ε-1/ζ, 4 PR by 본 session — #160/#161/#162/#163). ε-2/ε-3/
  ε-4 LOCKED #63 strict 충돌 finding 으로 future ADR (가칭 "Surface-
  aware on cardinal-force tools — architectural reconciliation"). 140-η
  사용자 시연 deferred (ADR-087 K-ζ canonical, 별도 manual trigger).
  README catalog Status canonical "Accepted" 동시 갱신. §9 Lessons
  추가.

---

**다음 trigger**: 사용자 시연 evidence (Cylinder + DrawLine on side
face — chord vs tangent 검증, η deferred slot)
또는 future ADR (surface-aware on cardinal-force tools)
또는 Sprint 1 priority track (ADR-144 Step 4.65 / ADR-145 Circle annulus).

## 9. Lessons (canonical for future Path Z atomic β implementations)

본 ADR 의 β implementation 진행에서 도출된 canonical lessons. 향후
multi-week atomic Path Z ADR 작성 시 참조.

### L1 — Audit-first canonical 2번째 적용 (LOCKED #63 strict 충돌 발견)

ε track 진행 직전 audit (DrawRect/DrawCircle/Sketch plane source
분석) → LOCKED #63 cardinal force strict 와 surface-aware origin 의
architectural 충돌 발견:

| 도구 | Plane source | LOCKED #63 정합 | 결정 |
|---|---|---|---|
| DrawLineTool | `establishDrawingPlane` (자체) | ✅ 직교 | ε-1 ✅ |
| DrawRectTool | `resolveCardinalPlane()` only | ❌ strict 충돌 | 거부 |
| DrawCircleTool | cardinal-forced `circleCenter` | ⚠ origin 사용 불가 | 거부 |
| Sketch | user explicit (L-63-7 예외) | future ADR | future |

→ silent 진행 회피 (LOCKED #63 위반 위험). ε track 자연 closure
+ future ADR anchor. 본 audit 가 architectural correctness 의 가치.

### L2 — Verification 3-layer 직접 evidence (BEFORE merge fail-cycle)

본 세션 4 PR 중 2 PR 에서 BEFORE merge CI fail 감지 → 자동 진행 중단
+ atomic fix-cycle. silent merge 회귀 차단 evidence:

| PR | Sub-step | Fix-cycle | 원인 |
|---|---|---|---|
| #160 | γ | 0 | 즉시 PASS |
| #161 | δ | 1회 | `faceMap` empty (test setup 미비) |
| #162 | ε-1 | 1회 | `Matrix4` mock 미정의 |
| #163 | ζ | 0 | 즉시 PASS (Rust-only, mock 함정 회피) |

→ BEFORE merge verification 의 직접 evidence. 2/4 PR 에서 fail 감지
+ fix-cycle. 자동 머지 + verification 강화 정책의 architectural value.

### L3 — Sub-step atomic 분할 의 가치 (LOCKED #44 정합)

α/β/γ/δ/ε-1/ζ 각각 단일 atomic PR (LOCKED #44 Complete Meaning per
Merge). 큰 atomic (전체 β implementation single PR) 대신 sub-step
분할로:
- 각 sub-step 별 회귀 자산 독립 (Plane vs Cylinder 등)
- CI fail 시 fix scope 작음 (BEFORE merge layer 효과)
- LOCKED #63 finding 같은 audit-first finding 도 sub-step 분할로
  점진 발견 (ε 진입 직전 audit)

### L4 — 자연 closure vs forced closure

ε track 가 LOCKED #63 strict 로 ε-1 만 merge 되고 ε-2/ε-3/ε-4 거부
→ "자연 closure" (architectural reality 가 spec 보다 우선). spec
원안 (모든 도구 통합) 의 forced closure 회피, future ADR anchor 명시.
메타-원칙 #5 (사용자 편의 — 명확하면 자동, 모호하면 명시 동의)
정합 — 모호한 architectural 충돌은 명시 finding 으로 transparent.

### L5 — chord error 회귀 자산 의 architectural value (ζ)

surface-aware normal 와 chord plane normal 의 정량 차이 lock (5
회귀 — Plane baseline 0 + Cylinder/Sphere/Cone/Torus arc-induced).
ADR-140 β implementation 의 architectural value evidence — surface-
aware path 가 실제로 chord substitute 와 다른지 정량 측정. 향후
ε-2/ε-3/ε-4 future ADR 작성 시 baseline reference.

## 10. Cross-link (full Acceptance chain)

- **α spec** — PR #145, 5df58ef
- **β WASM export** — PR #147, 0eaa856
- **γ TS wrapper** — PR #160, 9305cfc
- **δ getDrawPlane dispatch** — PR #161, 1126dde
- **ε-1 DrawLineTool** — PR #162, e5e5970
- **ζ chord error** — PR #163, 590af1c
- **closure (본 PR)** — (Phase 5 commit hash, docs only)
- LOCKED #63 (z=0 invariant — ε-2/ε-3/ε-4 거부 정합)
- LOCKED #65 (ADR-141 Master Roadmap — Sprint 1 ADR-143 share)
- LOCKED #66 (ADR-164 Sunset Policy — Status canonical "Accepted")
- 메타-원칙 #6 (Preventive over Curative — audit-first canonical 2회)
- 메타-원칙 #14 (WHAT 결과 invariant — surface tangent 정확성)

## 11. Future ADR anchor (deferred work)

본 ADR closure 후 자연 follow-up ADRs:

1. **(가칭) "Surface-aware on cardinal-force tools — architectural
   reconciliation"** — LOCKED #63 cardinal force ↔ surface-aware
   origin 의 reconciliation. DrawRect / DrawCircle / Sketch 에
   surface-aware 적용 가능한 architectural 결정.

2. **(가칭) "ADR-140 η — E2E + 사용자 시연"** — Playwright spec for
   DrawLine on Cylinder side face. 사용자 manual demo (ADR-087 K-ζ
   canonical) 후 separate ADR.

3. **(가칭) "Chord error tessellation budget"** — ζ chord error
   baseline 위에 tessellation chord_tol 의 dynamic adjustment.
   사용자 시연 evidence 의 quantitative validation.
