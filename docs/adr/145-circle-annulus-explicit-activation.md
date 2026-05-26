# ADR-145 — Circle Annulus 명시 활성 (옵션 B, ContextMenu)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-26
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap S1) 의 ADR-145 reserve.
ADR-141 §1 결재 1 (면 생성 정책 옵션 B, 사용자 결재 2026-05-22):
> "Circle 두 번 그릴 때 두 별개 face 유지. 사용자가 우클릭
> 'annulus 만들기' 명시 trigger 시 promote."
**Sprint**: S1 (ADR-141 §3 — 3~5일 estimate, 회귀 +55 share ~10-15)

## Canonical anchor

ADR-141 §5 결재 1 (메타-원칙 #16 정합 강화):
| 자동화 후보 | 메타-원칙 #16 분류 | 정책 |
|---|---|---|
| 큰 Circle + 작은 Circle 내포 → 자동 annulus | **휴리스틱** | ❌ 폐기 |
| 사용자 우클릭 "annulus 만들기" → promote | **명시 의도** | ✅ canonical |

ADR-139 (Boundary tool 명시 only, 메타-원칙 #16 신설) 패턴 1:1 mirror —
휴리스틱 자동 trigger 폐기 + 사용자 명시 trigger canonical.

## 1. Problem statement

### 1.1 현재 동작 (자동 promote 없음, 두 별개 face)

`DrawCircleTool` 으로 큰 Circle + 작은 Circle 그릴 시:
- 두 별개 face 생성 (각각 1 anchor + 1 self-loop edge with `AnalyticCurve::Circle`)
- LOCKED #41 (ADR-101 coplanar partial overlap auto-intersect) 는
  ADR-139 로 supersede 됨 (자동 trigger 폐기)
- 두 Circle 이 fully contained (작은 ⊂ 큰) → 자동 annulus 안 됨

### 1.2 메타-원칙 #16 정합 분석

| 시나리오 | 사용자 의도 | 휴리스틱 risk |
|---|---|---|
| 큰 Circle + 작은 Circle 내포 (concentric) | annulus 가능 | 두 Circle 별개 의도일 수도 |
| 큰 Circle + 작은 Circle (off-center) | 두 별개 의도일 가능성 높음 | annulus 잘못 promote |
| 큰 Circle + 작은 Circle (partial overlap) | 두 별개 의도 | annulus 부적합 |

→ 휴리스틱 자동 promote = 사용자 의도 잘못 추측 위험 (메타-원칙 #16
"자동화는 사용자 의도를 미리 알 수 없다"). 명시 trigger = canonical.

### 1.3 missing functionality

사용자가 *진짜* annulus (ring shape) 가 필요할 때 명시 명령 부재:
- Cylinder hollow ring (annulus cross-section)
- Donut shape (Torus 와 다른 — flat annulus)
- Architectural details (column ring, base ring)

→ **사용자 명시 명령 추가 필요** (메타-원칙 #5 사용자 편의 + #16 명시).

## 2. Solution architecture

### 2.1 ContextMenu "annulus 만들기" 우클릭 action

사용자 워크플로우:
1. DrawCircleTool 으로 큰 Circle 그리기 → outer face
2. DrawCircleTool 으로 작은 Circle 그리기 → inner face (별개 face 유지)
3. 두 face 선택 (Ctrl+click 또는 drag select)
4. 우클릭 → ContextMenu "annulus 만들기" 명시 trigger
5. 검증: 두 face 가 coplanar + 두 face 의 Circle 이 fully contained
   (작은 ⊂ 큰)
6. promote: outer face 의 hole 로 inner Circle 추가, inner face 제거

### 2.2 Engine API (Rust)

```rust
// crates/axia-geo/src/mesh.rs (or operations/annulus.rs 신설)

/// ADR-145 — Circle annulus 명시 promote.
/// 두 coplanar Circle face (outer + inner) 를 annulus (outer with
/// inner hole) 로 promote. inner face 제거.
///
/// 사용자 명시 trigger only (메타-원칙 #16) — 휴리스틱 자동 detect 안 됨.
///
/// # Errors
/// - `AnnulusError::NotCoplanar` — outer + inner 가 다른 평면
/// - `AnnulusError::InnerNotContained` — inner Circle 이 outer Circle
///   안에 fully contained 안 됨 (off-center 또는 partial overlap)
/// - `AnnulusError::NotCircleFace` — outer 또는 inner 가 Circle face
///   가 아님 (closed-curve self-loop with AnalyticCurve::Circle 아님)
pub fn promote_circles_to_annulus(
    mesh: &mut Mesh,
    outer_face: FaceId,
    inner_face: FaceId,
) -> Result<(), AnnulusError>;
```

**Validation 4단계**:
1. outer + inner 둘 다 active face
2. outer + inner 둘 다 Circle face (1 self-loop edge with
   `AnalyticCurve::Circle`)
3. outer + inner coplanar (normal direction parity + plane equation)
4. inner Circle fully contained in outer Circle (center distance +
   radius ≤ outer radius)

### 2.3 WASM bridge

```rust
// crates/axia-wasm/src/lib.rs

#[wasm_bindgen(js_name = "promoteCirclesToAnnulus")]
pub fn promote_circles_to_annulus(
    &mut self,
    outer_face_id: u32,
    inner_face_id: u32,
) -> Result<(), JsValue>;
```

### 2.4 TS bridge wrapper

```typescript
// web/src/bridge/WasmBridge.ts

promoteCirclesToAnnulus(
  outerFaceId: number,
  innerFaceId: number,
): { success: boolean; error?: string } {
  // graceful fallback + structured error
}
```

### 2.5 ContextMenu integration

```typescript
// web/src/ui/ContextMenu.ts

// 우클릭 시 selection 검증 → "annulus 만들기" item 표시 조건:
//   - exactly 2 face selected
//   - 둘 다 Circle face (faceSurfaceKind === Plane + Edge curve === Circle)
//
// Click → bridge.promoteCirclesToAnnulus(outer, inner)
//   inner / outer 판정: smaller radius = inner
```

## 3. Sub-step plan (Path Z atomic)

### 3.1 Plan 매트릭스

| Sub-step | Scope | 비용 | 회귀 |
|---|---|---|---|
| **145-α** | 본 ADR spec (본 commit) | ~30분 | 0 |
| **145-β-1** | Engine API — `promote_circles_to_annulus` + `AnnulusError` enum | ~1일 | axia-geo +5 (4 validation + 1 happy path) |
| **145-β-2** | WASM bridge export | ~30분 | axia-wasm +2 (export + graceful) |
| **145-β-3** | TS bridge wrapper | ~30분 | vitest +3 (success + 4 error case) |
| **145-β-4** | ContextMenu integration | ~1시간 | vitest +3 (visibility + dispatch + error toast) |
| **145-γ** | 회귀 자산 (E2E + 사용자 시연 evidence) + closure | ~1시간 | Playwright +1 + closure docs |
| **합계** | **3-5일 (LOCKED #65 정합)** | | **+14 회귀** |

### 3.2 Path Z atomic 답습

ADR-139 (Boundary tool) / ADR-140 (Surface-aware getDrawPlane) / ADR-144
(Step 4.65 sweep) 패턴 답습 — sub-step 별 single atomic PR.

### 3.3 회귀 추정 (axia-geo / axia-wasm / vitest / Playwright)

ADR-141 share +55 의 ~10-15 = 18-27% (Sprint 1 share table 정합).

## 4. Lock-ins

- **L-145-1** 메타-원칙 #16 정합 — 휴리스틱 자동 annulus promote 없음.
  사용자 우클릭 ContextMenu "annulus 만들기" 명시 trigger only.
- **L-145-2** ADR-139 (Boundary tool 명시) pattern 1:1 mirror — 명시
  trigger + Engine API 분리 + UI integration.
- **L-145-3** 4 validation 강제 — active / Circle face / coplanar /
  contained. 어느 하나 실패 시 명시 Toast error (silent skip 차단).
- **L-145-4** ADR-027 NURBS Kernel 정합 — Circle 의 `AnalyticCurve::Circle`
  사용 (Ellipse 별도 ADR-158). Bezier/BSpline/NURBS curve face 의
  annulus 는 별도 ADR (가칭 ADR-XXX "Generic curve annulus").
- **L-145-5** LOCKED #44 (Complete Meaning per Merge) — 각 sub-step
  single atomic PR.
- **L-145-6** LOCKED #66 (ADR-164 Sunset Policy) — α "Proposed" / γ
  closure 시 "Accepted".
- **L-145-7** 절대 #[ignore] 금지 — 14 회귀 자산 모두 enabled.
- **L-145-8** Hole inheritance — annulus promote 후 outer face 의 hole
  loop 가 inner Circle 의 self-loop edge 사용 (LOCKED #1 P7 보존).

## 5. Out of scope (별도 ADR)

- **Ellipse annulus** — DrawEllipseTool (ADR-158) 후속 별도 ADR.
- **Generic curve annulus** — Bezier/BSpline/NURBS curve face 의 annulus
  (Circle 외) — 별도 ADR.
- **3D annulus** (cylinder hollow ring) — Push/Pull 의 separate ADR.
- **자동 annulus detect** — 메타-원칙 #16 위반, 영구 거부.

## 6. Cross-link

- **ADR-141** (Master Roadmap) — §1 결재 1 (옵션 B 면 생성), §5
  메타-원칙 #16 정합 강화 table
- **ADR-139** (Boundary tool 명시) — pattern 1:1 mirror
- **ADR-027** (NURBS Kernel) — `AnalyticCurve::Circle` 사용
- **ADR-089** Phase 2 (true kernel-native closed edges) — Circle face
  의 1 anchor + 1 self-loop topology
- **LOCKED #1 P7** (ADR-021) — hole loop manifold (Phase 7 STRICT)
- **LOCKED #44** (Complete Meaning per Merge) — sub-step atomic 분할
- **LOCKED #65** (ADR-141 Master Roadmap — Sprint 1 ADR-145 reserve)
- **LOCKED #66** (ADR-164 Sunset Policy — Status canonical)
- **메타-원칙 #5** (사용자 편의) — 명시 trigger 가 명확
- **메타-원칙 #16** (자동화 antipattern) — 휴리스틱 회피

## 7. Sub-step roadmap

| Sub-step | Scope | 회귀 | 비용 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) | 0 | ~30분 |
| **β-1** | Engine API + AnnulusError + 5 회귀 | +5 | ~1일 |
| **β-2** | WASM bridge export + 2 회귀 | +2 | ~30분 |
| **β-3** | TS bridge wrapper + 3 회귀 | +3 | ~30분 |
| **β-4** | ContextMenu integration + 3 회귀 | +3 | ~1시간 |
| **γ** | E2E + 사용자 시연 + closure docs | +1 | ~1시간 |
| **합계** | | **+14** | **~3-5일** |

각 sub-step single atomic PR (LOCKED #44).

## 8. Acceptance Log

- **2026-05-26 α** (PR #171, 4c79636) — α spec + sub-step plan + lock-ins.
- **2026-05-26 β-1** (PR #172, ba43537) — Engine API skeleton (validation +
  promote stub). 5 회귀 자산.
- **2026-05-26 β-1+** (본 commit) — Promote logic full implementation.
  `create_solid.rs` 의 annulus_face 패턴 1:1 답습:
  - **signature 변경**: `&Mesh` → `&mut Mesh` (mutation 필요)
  - **`AnnulusError::PromoteLogicDeferred` variant 제거** (β-1 scope 완료)
  - **Promote logic 5단계**:
    1. inner face 의 outer LoopRef HEs collect (1 self-loop HE)
    2. inner outer LoopRef Copy (Face::outer())
    3. HEs reparent (`set_face(outer_face)` + `set_outer(false)`)
    4. outer face `add_inner(inner_outer_loop)` (Face::add_inner → bumps
       boundary_version + invalidates normal_cache, ADR-061 Step 2)
    5. inner face `set_active(false)` (HE/edge/vert 보존, manifold safe)
  - **회귀 갱신 + 추가**: axia-geo **+1** (β-1 의 5 → 6 net):
    * `adr145_beta1plus_promote_concentric_circles_succeeds` (happy path
      `Ok(())` + outer.inners().len() == 1 + inner.is_active() == false)
    * `adr145_beta1_rejects_*` 4 tests 그대로 보존
    * **`adr145_beta1plus_annulus_preserves_manifold_invariants`** (신규)
      — `verify_face_invariants` 미위반 검증 (L-145-8 정합 evidence)
  - **사용자 facing 변화**: 사용자가 명시 trigger (β-4 ContextMenu)
    호출 시 outer face 가 annulus topology (hole 1) 로 변환. inner face
    deactivate. dev server 에서 검증 가능 (β-4 후).
- **2026-05-26 β-2** (본 commit) — WASM bridge export `promoteCirclesToAnnulus`.
  `crates/axia-wasm/src/lib.rs` 에 transaction-wrapped endpoint 추가
  (promote_shape_to_xia pattern 1:1 답습):
  - signature: `(outer_face_id: u32, inner_face_id: u32) -> Result<(), JsValue>`
  - Engine call: `axia_geo::operations::annulus::promote_circles_to_annulus`
  - Transaction: begin → set_before_snapshot → match Ok/Err → commit / cancel
  - Error format: `promoteCirclesToAnnulus: <AnnulusError Display>` (silent
    skip 차단, ADR-091 D-γ pattern 답습)
  회귀 axia-wasm **+2** (step6_additive_only.rs `adr145_beta2_*` block):
  - `adr145_beta2_promote_circles_to_annulus_endpoint_wired` — js_name +
    signature + Engine delegation 검증
  - `adr145_beta2_promote_uses_transaction_with_cancel_on_error` — begin
    + commit + cancel + 'promoteCirclesToAnnulus:' error prefix
  + `export_baseline.txt` 갱신 (promoteCirclesToAnnulus entry alphabetical
  insertion 전 promoteShapeToXia). `wasm_export_baseline_unchanged` test
  자동 PASS.
- **2026-05-26 β-3** (본 commit) — TS bridge wrapper 추가.
  `web/src/bridge/WasmBridge.ts` 갱신 (ADR-091 D-γ pattern 1:1 답습):
  - `AxiaEngineExtended` interface 에 optional `promoteCirclesToAnnulus?(outerFaceId, innerFaceId): void` 선언
  - `WasmBridge.promoteCirclesToAnnulus(outerFaceId, innerFaceId): void`
    typed wrapper — strict throw on error (WASM endpoint missing /
    AnnulusError Display)
  - `markDirty()` 호출 (cache invalidation)
  - Engine call: `this.engine.promoteCirclesToAnnulus(outerFaceId, innerFaceId)`
  회귀 vitest **+3** (WasmBridge.test.ts `ADR-145 β-3` block):
  - success path — `expect(fn).toHaveBeenCalledWith(10, 20)`
  - engine throw propagation — silent skip 차단 evidence
  - WASM endpoint missing feature gate
- **(β-4 + γ, ~2시간)** — ContextMenu "annulus 만들기" UI integration
  + E2E + closure docs. 별도 사용자 결재 후 진행.

---

**다음 trigger**: β-4 진입 결재 (ContextMenu "annulus 만들기" UI integration)
또는 β-4 + γ 묶음 (~2시간 multi)
또는 우선순위 priority track 결정.
