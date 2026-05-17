# ADR-117 — Cylinder Direct Dispatch + TorusTool UI Bindings (ADR-104 family 100% closure)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — α (cylinder dispatch) + β (TorusTool menu/keyboard) bundle (single PR per LOCKED #44, 사용자 결재 ε) |
| Date | 2026-05-17 |
| Supersedes | — |
| Closes | ADR-116 α-1 finding (cylinder dispatch asymmetry), ADR-115 δ-next (TorusTool menu+keyboard). **ADR-104 Path B family 100% architectural + user-facing closure**. |
| Related | ADR-094/113/114/115/116 (Path B family predecessors), ADR-104 (Path B Expansion spec) |

---

## 1. Canonical Anchor

ADR-104 Path B family 의 **architectural symmetry 완성 + user-facing 마지막 layer 결합**. 사용자 결재 ε (α + β 묶음):

- **α (γ-next)**: ADR-116 α-1 architectural finding 해소 — `create_cylinder` direct dispatch 추가 (sphere/cone/torus 패턴 1:1 mirror, **4th successful template reproduction**)
- **β (δ-next)**: TorusTool menu / keyboard binding — primitive menu 항목 + `D` keyboard shortcut

**사용자 결재 anchor (2026-05-17)**:
> "✅ 결재: ε (α + β 묶음) — 지금 단계에서 가장 완전한 closure 선택"

## 2. α — Cylinder Primitive Direct Dispatch (architectural symmetry)

### 2.1 ADR-116 α-1 finding 해소

ADR-116 γ verification 이 locked-in 한 architectural asymmetry:
- Sphere/Cone/Torus → direct primitive create 에서 Path B dispatch
- **Cylinder → only via create_solid extrude path** (ADR-094 design)

본 ADR α 가 이 asymmetry 해소 — `create_cylinder` 의 시작에 dispatch 추가:

```rust
pub fn create_cylinder(...) -> Result<Vec<FaceId>> {
    if self.cylinder_path_b_default {
        return self.create_cylinder_kernel_native_via_extrude(...);
    }
    // ... legacy Path A polygonal (variables 18 faces for N=16)
}
```

### 2.2 `create_cylinder_kernel_native_via_extrude` helper

새 helper (mesh::operations::primitives.rs) — 3-step pipeline:

1. **Build closed-curve Circle profile face** (ADR-089 canonical):
   - 1 anchor vertex at `center + (radius, 0, 0)` (Z-up, LOCKED #43)
   - `add_face_closed_curve(anchor, Circle{...}, material)` → 1 face with self-loop edge
   - Attach `AnalyticSurface::Plane` to profile face

2. **Call `create_solid(profile_face, Extrude { distance: height })`**:
   - ADR-094 B-η `cylinder_path_b_default=true` 라우팅 → Path B annulus
   - Returns `CreateSolidResult` with `profile_face`, `top_face`, `side_faces[]`

3. **Return canonical `[base, top, side]` order**:
   - profile_face = base disk
   - top_face = top disk
   - side_faces[0] = cylindrical annulus side

### 2.3 회귀 자산 (axia-geo, +6 + 2 γ updates)

`crates/axia-geo/src/operations/primitives.rs::tests` (ADR-117 dispatch):
- `adr117_cylinder_direct_dispatch_engine_default_path_a`
- `adr117_cylinder_direct_dispatch_path_b_active_after_flag_flip`
- `adr117_cylinder_direct_dispatch_path_a_default_off_preserved`
- `adr117_cylinder_direct_dispatch_bidirectional_toggle`
- `adr117_cylinder_direct_dispatch_invariants_pass`
- `adr117_cylinder_direct_dispatch_returns_canonical_face_order`

`crates/axia-geo/src/path_b_family_verification.rs` updates:
- `adr104_gamma_cylinder_create_direct_dispatches_to_path_b_when_flag_on` (replaces obsolete asymmetry test)
- `adr104_gamma_cylinder_create_direct_path_a_when_flag_off` (engine default preservation)
- `adr104_gamma_path_b_family_constant_dcel_invariant` (now includes Cylinder = 3 face)

**ADR-104 architectural symmetry achieved**: All 4 primitives dispatch in direct `create_*` with same `{kind}_path_b_default` flag pattern.

## 3. β — TorusTool Menu / Keyboard Binding

### 3.1 Menu entry (primitive 메뉴)

`web/index.html`:
```html
<div class="menu-action" data-action="tool-torus">토러스 (Torus)<span class="mk">D</span></div>
```

위치: 프리미티브 메뉴 안 (구 / 원통 / 원뿔 / **토러스** / 박스 순).

### 3.2 Keyboard shortcut

`web/src/ui/KeyboardShortcuts.ts`:
```ts
'd': 'torus', 'D': 'torus',  // ADR-117 δ — D = donut/torus mnemonic
```

`D` 키 (사용 안 된 letter, donut mnemonic) 매핑.

### 3.3 Action dispatch + display name

`web/src/ui/MenuBar.ts`:
```ts
toolNames.torus = 'Torus';
case 'tool-torus': setActiveTool('torus'); break;
```

`web/src/commands/AxiaCommands.ts`:
```ts
cmds.push(tool('tool-torus', 'torus', 'primitive', '토러스 (Torus)', '토러스', 'D', false, undefined, deps));
```

### 3.4 사용자 facing 활성화 결과

- **메뉴**: 프리미티브 → 토러스 (Torus) 클릭 시 TorusTool 활성
- **키보드**: `D` 키 누르면 TorusTool 활성
- **3-click flow**: anchor → major_radius → minor_radius → commit
- **자동 라우팅**: bridge.create_torus → Path B kernel-native (1 face / 1 edge / 1 vert)

## 4. 본 PR 변경 사항

### 4.1 Engine layer (Rust)

- `crates/axia-geo/src/operations/primitives.rs`:
  - `create_cylinder` 시작에 dispatch 추가
  - `create_cylinder_kernel_native_via_extrude` helper 신규 (3-step pipeline)
  - +6 회귀 (ADR-117 dispatch suite, mirror β-1-ζ / β-2-ζ)
- `crates/axia-geo/src/path_b_family_verification.rs`:
  - asymmetry 회귀 → symmetry 회귀로 update (2 tests)
  - `adr104_gamma_path_b_family_constant_dcel_invariant` 가 Cylinder 포함하도록 update

### 4.2 TypeScript / UI layer

- `web/index.html`: 토러스 (Torus) 메뉴 항목 추가 (D 키 표시)
- `web/src/ui/MenuBar.ts`: torus display name + tool-torus action case
- `web/src/ui/KeyboardShortcuts.ts`: 'd' / 'D' → 'torus' mapping + torus display name
- `web/src/commands/AxiaCommands.ts`: tool-torus command registration

### 4.3 Docs

- `docs/adr/117-cylinder-symmetry-torustool-ui.md` (NEW)
- `CLAUDE.md`: LOCKED #51

## 5. Lock-ins

- **L-117-1** Single atomic PR for "ADR-104 family 100% closure" (α + β bundle per 사용자 결재 ε)
- **L-117-α-1** Cylinder direct dispatch via `create_cylinder_kernel_native_via_extrude` helper (3-step pipeline)
- **L-117-α-2** Profile = closed-curve Circle (ADR-089 1-anchor + 1-self-loop canonical + Plane surface)
- **L-117-α-3** Z-up canonical (LOCKED #43): axis = +Z, anchor at `center + (radius, 0, 0)`
- **L-117-α-4** create_solid dispatch reuses ADR-094 Path B (`extrude_cylinder_kernel_native` via cylinder_path_b_default flag)
- **L-117-α-5** Returns `[base_face, top_face, side_face]` canonical order
- **L-117-β-1** TorusTool keyboard shortcut = `D` (donut mnemonic, avoids conflict with 'U'=measure / 'T'=top view)
- **L-117-β-2** Menu position: 프리미티브 → 구 / 원통 / 원뿔 / **토러스** / 박스 (natural order, 작은→큰 spatial complexity)
- **L-117-2** ADR-046 P31 #4 additive only (no existing UX changes — torus 신규 등록만, cylinder dispatch는 flag default OFF 유지 — production layer 가 ON 명시)

## 6. 회귀

- axia-geo: 1379 → **1386 PASS** (+7 — 6 ADR-117 dispatch + 1 net γ update)
- vitest: **1894 PASS** (no change — UI bindings are runtime-only, no new unit tests required beyond TorusTool 회귀 이미 있음)
- 절대 #[ignore] 금지 7/7 준수

### ADR-104 family final cumulative (6 PRs)

| ADR | PR | 회귀 추가 |
|---|---|---|
| ADR-094 | (early) | base |
| ADR-113 | #76 | +21 (sphere) |
| ADR-114 | #77 | +27 (cone) |
| ADR-115 | #78 | +23 (torus) |
| ADR-116 | #79 | +20 (γ verification + ζ TorusTool) |
| **ADR-117** | **#80 (this)** | **+7 (cylinder dispatch + UI bindings)** |

**Cumulative across 6 PRs**: **+98+ across 6 PRs**, 절대 #[ignore] 금지 98+/98+ 준수.

## 7. ADR-104 Path B Family — 100% Architectural + User-Facing Closure

| Primitive | Engine | Direct dispatch | UI tool | Menu | Keyboard | Memory |
|---|---|---|---|---|---|---|
| Cylinder | ✅ ADR-094 | ✅ **ADR-117 α** | ✅ CylinderTool | ✅ | ✅ Y | 95% |
| Sphere | ✅ ADR-113 | ✅ ADR-113 ζ | ✅ SphereTool | ✅ | ✅ H | 99%+ |
| Cone | ✅ ADR-114 | ✅ ADR-114 ζ | ✅ ConeTool | ✅ | ✅ N | 92% |
| Torus | ✅ ADR-115 | ✅ ADR-115 + ADR-117 β | ✅ TorusTool | ✅ **ADR-117 β** | ✅ **D ADR-117 β** | 99.7% |

**🎉 ADR-104 Path B family 가 architectural (4 primitives × Path B) + user-facing (4 tools × menu + keyboard) 양쪽 layer 모두 100% 완성**.

## 8. Lessons

### L1 — Verification finding 의 자연 closure

ADR-116 α-1 finding 이 본 ADR α 에서 즉시 해소. Verification → finding → closure 의 atomic chain. 향후 verification ADR 다음에는 즉시 finding closure ADR 권장.

### L2 — 4th template reproduction (sphere → cone → torus → cylinder)

ADR-113 (sphere) → ADR-114 (cone) → ADR-115 (torus) → ADR-117 (cylinder) — 4번째 1:1 mirror reproduction. 4-layer template (engine dispatch + WASM (existing) + TS (existing) + flag (existing)) 완전 reproducible. Cylinder 는 기존 Path B engine 자산 (`extrude_cylinder_kernel_native`) 위에 dispatch wrapper 만 추가.

### L3 — Helper-based dispatch pattern

`create_cylinder_kernel_native_via_extrude` 가 closed-curve profile build + create_solid 호출 wrapper. Sphere/cone/torus 의 direct kernel-native 함수와 다른 패턴 — *bridge between Path A entry signature and Path B execution path*. 향후 어떤 primitive 든 Path A vs Path B entry signature 가 다른 경우 동일 wrapper 패턴 가능.

### L4 — Keyboard mnemonic discipline

'D' for Donut/Torus — avoids conflict with 'U' (measure) / 'T' (top view). Single-letter primitive shortcuts 누적 시 의미적 mnemonic 우선 ('H'=sphere=헬리콥터/원, 'Y'=cylinder=Y-shape, 'N'=cone, 'D'=donut). 향후 새 primitive 도 mnemonic 우선.

## 9. 후속 트랙 (별도 ADR per LOCKED #44)

### ε — STEP timing 단축 (LOCKED #43 priority #3)

ADR-082 Drift #5 (browser env OCCT init 180s+ wait) audit + fix. Multi-week architectural ADR (WASM streaming compile / parallel libs / cache).

### ζ — NURBS-aware coplanar intersect (LOCKED #43 priority #4)

ADR-101 §5 Vatti / Weiler-Atherton algorithm. Vertex-on-corner degeneracy 영구 해소. Multi-week algorithmic ADR.

### η — Surface-driven Boolean / Offset / Push-Pull pair-wise verification (ADR-104 §3.1)

Path B family 간 cross-cut ops (예: Sphere ∪ Cone Boolean, Cylinder offset, Torus push-pull) verification 매트릭스. ADR-116 γ verification 의 확장.

## 10. Cross-link

- ADR-094 (Cylinder Path B-full canonical) — α-1 finding 의 architectural 배경 + `extrude_cylinder_kernel_native` engine source
- ADR-113 (Sphere) — direct dispatch template source #1
- ADR-114 (Cone) — direct dispatch template source #2 (Q2 revision precedent)
- ADR-115 (Torus) — direct dispatch template source #3 (TorusTool engine)
- ADR-116 (γ verification + ζ TorusTool UI) — α-1 finding source + TorusTool registration
- ADR-104 (Path B Expansion spec) — family closure
- ADR-046 P31 #4 (additive only)
- ADR-089 (closed-curve face canonical — profile face build helper)
- LOCKED #43 (Z-up canonical)
- LOCKED #44 (Complete Meaning per Merge — bundle scope)
