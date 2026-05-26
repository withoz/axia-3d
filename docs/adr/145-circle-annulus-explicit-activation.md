# ADR-145 — Circle Annulus 명시 활성 (옵션 B, ContextMenu)

**Status**: Accepted (γ closure 2026-05-26 — Path Z atomic 7 sub-step
α + β-1 + β-1+ + β-2 + β-3 + β-4 + γ 모두 closure)
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
- **2026-05-26 β-4** (본 commit) — ContextMenu "Annulus 만들기" UI integration.
  - `web/index.html` 의 context menu 에 `.ctx-annulus-item` (data-action
    `promote-circles-to-annulus`) 추가 (`merge-as-hole` 직후).
  - `web/src/ui/ContextMenu.ts`:
    * Visibility — `selected.length === 2` 일 때만 표시 (Engine 4-validation
      이 Circle face / coplanar / contained 최종 검증, UI 사전 검출은 별도 ADR)
    * Click handler — `bridge.promoteCirclesToAnnulus(faceA, faceB)` 호출.
      `InnerNotContained` Error 시 swap retry `(faceB, faceA)`. 두 ordering
      모두 실패 → `Toast.error` (Engine error message). 성공 시 `Toast.success`
      + `clearSelection()` + `syncMesh()`.
  회귀 vitest **+4** (ContextMenu.test.ts `ADR-145 β-4 Annulus 만들기` block):
  - visibility — 0/1/2/3 face selected 4가지 path 검증
  - dispatch — bridge.promoteCirclesToAnnulus(10, 20) 정확 호출 + success
    Toast + clearSelection + syncMesh
  - InnerNotContained swap retry — 첫 (A,B) 실패 시 (B,A) 재시도, 두 번째
    성공 → Toast.success
  - error toast — NotCoplanar (non-InnerNotContained) Error → 1회 호출만,
    Toast.error 메시지 전달
  - 합계 27/27 PASS (기존 24 + 신규 4 — spec 의 +3 보다 1개 추가)
- **2026-05-26 γ** (본 commit) — Closure: E2E + Status flip + Lessons.
  - `web/e2e/adr-145-annulus-demo.spec.ts` 신규 (Playwright + 2 specs):
    * **γ-1**: `promoteCirclesToAnnulus` WASM endpoint smoke (strict throw
      on InactiveFace) — ADR-091 D-ζ smoke 패턴 1:1 mirror. β-1
      validation #1 의 browser-runtime evidence.
    * **γ-2**: Concentric Circles happy-path round-trip — `drawCircleAsCurve
      × 2 (outer r=5, inner r=2)` + `promoteCirclesToAnnulus` →
      `getStats().faces` decreases by 1 (β-1+ L-145-8 inner deactivation
      evidence). β-1+ Rust integration test 의 browser counterpart.
  - **§9 Lessons** 신규 — 4-항목 회고 (Path Z 7-sub-step 효율성 + atomic
    splitting + LOCKED #44 정합 + 메타-원칙 #16 enforcement).
  - **Status**: Proposed → **Accepted** (header).
  - **README catalog** (`docs/adr/README.md`) — Sprint 1 row 의 ADR-145
    entry Status: `Proposed` → `Accepted`.
  - 회귀 Playwright **+2** (`adr-145-annulus-demo.spec.ts`). 합계 — 절대
    #[ignore] 금지 2/2 준수.

---

**ADR-145 closure**: Path Z atomic 7 sub-step 완료. 사용자 facing 즉시
가치 — DrawCircle × 2 → 우클릭 → "Annulus 만들기" → 정확 annulus topology
(outer with inner hole, LOCKED #1 P7 manifold). 휴리스틱 자동 promote 0
(메타-원칙 #16 정합). 다음 trigger: Sprint 1 잔존 ADRs (ADR-141 §3 매트릭스
participation) 또는 sample/ 문서 학습 자료 ADR (별도 anchor).

## 9. Lessons (canonical for future "사용자 명시 promote" ADRs)

ADR-145 Path Z atomic 7-sub-step closure 의 4개 회고 항목:

### L1 — Path Z atomic 7-sub-step 의 사용자 결재 효율성

α spec → β-1 / β-1+ / β-2 / β-3 / β-4 → γ closure. 각 sub-step single
atomic PR (LOCKED #44 정합). 본 ADR 은 ADR-139 (Boundary tool) 패턴
1:1 mirror 의 *명시 promote 변형* — 7 sub-step 각각이 self-contained
PR 로 사용자 결재 cycle 최소화 (β-1 후 β-1+ 의 logic split 자연 흡수).

향후 "사용자 명시 promote" ADR 가이드 — α (spec) → β-1 (Engine API
skeleton + validation) → β-1+ (full logic, if separable) → β-2 (WASM
bridge) → β-3 (TS wrapper) → β-4 (UI integration) → γ (E2E + closure)
의 canonical 7-step.

### L2 — Engine validation 의 UI 단순화 가치

β-4 UI 에서 *사전 검출* (Circle face 인지 / coplanar 인지 / contained
인지) 안 함 — Engine 4-validation 에 위임. 결과: ContextMenu 가시성
로직 *단순* (`selected.length === 2`), 사용자 facing failure mode 명시
(Toast.error with Engine error message). 향후 명시 trigger UI 가이드 —
*검증 책임은 Engine*, *UI 는 시도 + error toast*.

예외 — UX 한 단계: InnerNotContained Error 시 swap retry. 두 ordering
모두 실패만 final error. 사용자 facing "어느 게 outer 인지 신경 쓸 필요
없음" 가치.

### L3 — 메타-원칙 #16 정합 강화 (ADR-139 후속 evidence)

ADR-139 (Boundary tool 명시 only) 의 자연 후속. ADR-145 가 *명시 promote*
의 첫 follow-up ADR. 결과 — *큰 Circle + 작은 Circle 자동 annulus 안
됨* (휴리스틱 회피) + *사용자 우클릭 명시 trigger 만 promote* (의도
명확).

향후 메타-원칙 #16 정합 ADR 가이드 — 자동 trigger 거부 + 명시 UI entry
(우클릭 / 메뉴 / 단축키) 분리. ADR-145 의 ContextMenu integration 이
canonical entry pattern.

### L4 — LOCKED #1 P7 manifold 보존 (β-1+ L-145-8 evidence)

`promote_circles_to_annulus` 의 promote logic 5단계 (HE reparent +
LoopRef add_inner + face deactivate) 가 LOCKED #1 P7 manifold invariant
보존. β-1+ 의 `adr145_beta1plus_annulus_preserves_manifold_invariants`
회귀가 `verify_face_invariants` 미위반 evidence — 향후 hole inheritance
ADR 가이드 — `create_solid.rs` 의 `annulus_face` 패턴 1:1 mirror 답습.

### L5 — Sprint 1 자연 진행 (사용자 결재 직계 evidence)

본 ADR closure 후 사용자 결재 anchor — *sample/ 문서 학습 자료 반영
이 더 가치 있다* 가 별도 ADR trigger 가능. LOCKED #65 ADR-141 Sprint 1
ADR-145 reserve 의 자연 closure 완료 — Sprint 1 잔존 ADRs (ADR-141 §3
매트릭스) 또는 외부 anchor (sample/ 5 학습 문서) 모두 candidate.

향후 Sprint scope 결정 가이드 — 사용자 명시 결재 anchor (사용자
"무엇이 가장 가치 있는가" 응답) 우선. 본 ADR 의 trigger 결재 (옵션 B
2026-05-22) 가 spec 작성 → β implementation → γ closure → 다음 결재
cycle 의 canonical evidence.
