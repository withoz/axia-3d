# ADR-099: Layered Material 4-PBR Channels (Two-Layer Citizenship Phase 5-B)

- **Status**: Proposed (L-α — spec only)
- **Date**: 2026-05-10
- **Anchor**: LOCKED #26 Phase 5 약속 ("자산 라이브러리 3계층 +
  Layered material") + v3.2 §13 main promise. **본 ADR 완료 시
  LOCKED #26 Two-Layer Citizenship Model 5-Phase 로드맵 완전 closure**.
- **Parent**: ADR-049 (Two-Layer Citizenship Model)
- **Sibling**: ADR-050 (Phase 1 ✅), ADR-091 (Phase 2 ✅), ADR-095
  (Phase 3 ✅), ADR-097 (Phase 4 ✅), ADR-098 (Phase 5-A ✅),
  ADR-100 (Phase 5-C ✅)
- **Pattern evolution from ADR-097/100**: Recovery cascade 의 5-layer
  1:1 mirror 가 아닌 **Feature 추가** 6-layer atomic (Engine +
  Snapshot/Bridge + Render + UI + Bridge TS + E2E).

---

## A. Problem Statement

ADR-098 S-γ 가 3-Tier Material Scope (System/Project/User) 를
활성했지만 각 재질의 **시각 표현** 은 여전히 scalar (color/roughness/
metalness/opacity) + 단일 base texture (`TextureInfo`). 산업 표준
PBR (Physically Based Rendering) 의 **4 channel layered texture** (albedo
+ normal + roughness + metallic) 미지원 — 사용자 facing visible 가치의
가장 큰 gap.

v3.2 §13 promise:
- "자산 라이브러리 3계층" ✅ (ADR-098)
- **"Layered material"** (본 ADR)

**5개월 누적 자산** (audit):
- `VisualProperties { color, roughness, metalness, opacity }` — scalar
- `TextureInfo { dataUrl, projection, scale }` — single base texture
- `AuxTextureInfo` (axia-core) — **scaffold 존재, 실제 binding 없음**
- `TextureCache` (LRU + GPU dispose) — 활용 가능
- `TextureUploadDialog` — 1-channel UI, 확장 필요
- Three.js `MeshStandardMaterial.map` — single base binding only

**핵심 갭**: 다중 채널 (normal + roughness + metallic map) 의 storage /
render / UI 모두 미구현.

---

## B. Lock-ins (사용자 결재 2026-05-10)

### L-A — Channel 수: 4 PBR fixed (albedo / normal / roughness / metallic)
PBR 표준 (Disney BRDF + Unreal Engine + Three.js MeshStandardMaterial
공통). Future 채널 (emission / displacement / AO) 은 별도 ADR.

### L-B — Storage 모델: `VisualProperties.layered: Option<LayeredChannels>`
**ADR-091 §E L1 canonical 답습 (6번째 일관 적용)** — 기존 field
UNCHANGED, additive only. `#[serde(default)]` 로 bincode legacy 호환.
```rust
pub struct LayeredChannels {
    pub albedo: Option<TextureInfo>,
    pub normal: Option<TextureInfo>,
    pub roughness: Option<TextureInfo>,
    pub metallic: Option<TextureInfo>,
}

pub struct VisualProperties {
    pub color: u32,
    pub roughness: f64,
    pub metalness: f64,
    pub opacity: f64,
    #[serde(default)]  // ADR-099 L-β additive
    pub layered: Option<LayeredChannels>,
}
```

### L-C — Snapshot section 9 schema 자연 확장
ADR-098 S-γ 가 이미 material_library 전체를 직렬화 — `LayeredChannels`
는 `VisualProperties` 의 새 field 로 자연 포함. legacy snapshot 의
`VisualProperties` 가 `layered` 없이 deserialize → `None` default.

### L-D — Backward compat: TextureInfo → layered.albedo migrate
기존 single-texture material 의 `texture` field (현재는 visual 외부에
존재하면) 또는 `AuxTextureInfo` → `layered.albedo` 로 idempotent
migrate. Helper:
```rust
pub fn migrate_single_texture_to_layered(&mut self) -> usize;
```
ADR-098 S-D `migrate_legacy_materials` 패턴 답습.

### L-E — Render pipeline: Three.js 4-map binding
`MeshStandardMaterial` 의 4 슬롯 직접 binding:
- `material.map` ← albedo
- `material.normalMap` ← normal
- `material.roughnessMap` ← roughness
- `material.metalnessMap` ← metallic

`TextureCache` 4× 확장 (각 channel 별 LRU + GPU dispose). 기존
single-texture render path UNCHANGED — `layered === None` 면 legacy
path 그대로.

### L-F — UI: TextureUploadDialog 4-tab 확장
기존 single-tab → 4-tab (Albedo / Normal / Roughness / Metallic).
1-tab default (Albedo) 진입 → 사용자가 추가 tab 으로 expand. 기존
single-texture workflow 보존 — Albedo 만 upload 시 결과 = 현재 동작.

### L-G — Default 활성: Always available
ADR-094 default ON (메모리/시각 무관 변경) 패턴. opt-in flag 불필요 —
사용자가 4-tab 을 사용하지 않으면 기존 단일 texture workflow 와 동등.
ADR-097/098/100 의 default OFF 와 다름 (Feature 추가 vs self-modifying
op 의 분기).

### L-H — 6-Layer Atomic Stack (ADR-097/100 5-layer 와 다른 새 pattern)
ADR-097/100 의 5-layer (Engine + Bridge + UI Dialog + Orchestrator +
Settings + E2E) 와 달리, Feature 추가는 **Recovery layer 대신 Render
layer** 가 들어옴:
```
Engine (axia-core) — LayeredChannels struct + migrate
  ↓
Snapshot Section 9 자연 확장
  ↓
WASM Bridge (axia-wasm) — 5 endpoints
  ↓
Render Pipeline (Three.js Viewport) — 4-map binding   ← NEW LAYER
  ↓
UI (TextureUploadDialog 4-tab + Inspector preview)
  ↓
Bridge TS wrappers + Real Chromium E2E
```

---

## C. Path Z atomic 7-단계 (Multi-week)

본 ADR 은 **multi-week atomic** — sub-step 단위 atomic, 사용자 시연
게이트 분리. 각 sub-step standalone usable.

| # | Sub-step | 산출물 | 회귀 |
|---|----------|--------|------|
| 1 | **L-α** spec (본 commit) | 본 ADR | 0 |
| 2 | **L-β** Rust core | `LayeredChannels` struct + `VisualProperties.layered` 확장 + migrate helper + validation | axia-core +12~15 |
| 3 | **L-γ** Snapshot section 9 확장 + WASM bridge | section 9 struct field additive, 5 endpoints (`getLayeredChannels` / `setLayeredChannel` / `clearLayeredChannel` / `migrateLegacyTextureToLayered` / `hasLayeredMaterial`) + export_baseline.txt additive | axia-core +8, axia-wasm +5 |
| 4 | **L-δ** Render pipeline (Three.js) | Viewport.ts `MeshStandardMaterial` 4-map binding + TextureCache 4× + material refresh | vitest +10 (viewport tests) |
| 5 | **L-ε** UI integration | TextureUploadDialog 4-tab 확장 + XiaInspector / AssetLibraryPanel layered preview | vitest +15 (UI tests) |
| 6 | **L-ζ** Bridge TS wrappers + Toast | WasmBridge.ts typed wrappers (5 신규, ADR-097/100 답습) + Toast feedback | vitest +10 (bridge tests) |
| 7 | **L-η** Real Chromium 시연 + closure | Playwright 6+ scenarios + Visual regression baseline (ADR-077 V-2 답습) | Playwright +6 |

**예상 총합**: axia-core +20, axia-wasm +5, vitest +35, Playwright
+6 = **~+66**, 절대 #[ignore] 금지.

**Multi-week 기간**: 6 sub-step (L-β ~ L-η) × ~1 세션 = 6 세션.
사용자 시연 게이트는 L-δ (Render) 와 L-ε (UI) 각각 separate session
권장 (visible 효과 검증).

---

## D. Risk Matrix

| Risk | 영향 | 완화 |
|------|------|------|
| `VisualProperties` bincode 호환성 회귀 | 매우 높음 | `layered: Option<...>` + `#[serde(default)]` (ADR-091 §E L1 6번째 일관 적용) |
| Three.js 렌더 변경 회귀 (existing single-texture) | 매우 높음 | `layered === None` → legacy single-texture path UNCHANGED. 모든 기존 mesh 영향 0 |
| TextureCache 메모리 4× 증가 | 높음 | ADR-013 LRU eviction 정책 자연 작동. Channel 별 dispose 명시 |
| TextureUploadDialog UX 회귀 | 중 | 1-tab default (Albedo) → 사용자 명시 expand. 기존 workflow 보존 |
| Bundle size 증가 | 중 | Three.js features 이미 포함, 추가 dep 없음. 신규 4-tab dialog code 만 lazy chunk |
| LOCKED #26 Form-layer material-agnostic 위반 | 매우 높음 | Xia.material 의 VisualProperties 만 변경. Shape 영향 0. 회귀 test 강제 |
| Multi-week atomic 중단 risk | 높음 | sub-step 단위 atomic — 각각 standalone usable (e.g., L-β commit 만으로 schema only 사용 가능, L-δ commit 만으로 albedo 단일 render 가능) |
| AuxTextureInfo legacy data 처리 | 중 | `migrate_single_texture_to_layered` 헬퍼 — idempotent, ADR-098 S-D 패턴 답습 |

---

## E. Cross-link

- LOCKED #26 (Two-Layer Citizenship Phase 5-B 약속, **마지막 piece**)
- ADR-049 §2.2 (v3.2 §13 — Layered material)
- ADR-098 S-γ (section 9 — material_library 직렬화 위에 build)
- ADR-091 §E L1 (Mesh/Scene-level Map canonical, 6번째 적용)
- ADR-094 default ON (메모리/시각 무관 패턴, Always available 정합)
- ADR-097 / ADR-100 (5-layer atomic stack — 6-layer 로 evolve)
- ADR-013 (Memory Budget — TextureCache LRU 정책)
- ADR-046 P31 (UI/UX strategy — additive only)
- ADR-077 V-2 (Visual regression infrastructure — L-η 활용)

---

## F. ADR-097/100 → ADR-099 Pattern Evolution

| 측면 | ADR-097/100 (Recovery) | ADR-099 (Feature) |
|------|------------------------|-------------------|
| **본질** | Recovery cascade (자산 활용) | Feature 추가 (새 자산 도입) |
| **5-layer pattern** | 1:1 mirror (canonical) | **6-layer atomic** (Render 추가) |
| **사용자 facing** | Safety / 데이터 보호 | Visible / PBR rendering |
| **Default** | OFF (self-modifying safety) | Always available (ADR-094 답습) |
| **Multi-week** | Single session 가능 | **Multi-week strict** |
| **Sub-step** | 5~6 | 7 |
| **Pattern 가치** | reproducibility 증명 | evolution 증명 |

---

## G. Phase 5-B closure → LOCKED #26 완전 closure

본 ADR 의 L-η closure 시점:
- Phase 1 (ADR-050+051) ✅
- Phase 2 (ADR-091) ✅
- Phase 3 (ADR-095+096) ✅
- Phase 4 (ADR-097) ✅
- Phase 5-A (ADR-098) ✅
- Phase 5-C (ADR-100) ✅
- **Phase 5-B (본 ADR L-η) ✅ → LOCKED #26 완전 closure**

5-Phase 로드맵 모든 약속 정합 — Two-Layer Citizenship Model 완성.

---

## §D Acceptance Log

### L-α (본 commit)
- 본 ADR 작성. 사용자 결재 (2026-05-10): Q1~Q8 권장값 전체 동의 +
  R-α spec only 본 세션 + L-α ~ L-η 명명.
- 회귀 0 (spec only).
- 다음 진입점 — L-β Rust core (별도 세션, multi-week 첫 단계).

### L-β (본 commit) — Rust core
- **commit**: 본 commit (axia-core)
- **신규 type 3 개**:
  * `TextureProjection` enum — Planar / Box / Cylindrical
    (`#[serde(rename_all = "lowercase")]` for TS interop)
  * `TextureChannelInfo` — Rust counterpart of TS `TextureInfo`
    (dataUrl + projection + scale + optional rotation + optional label)
    + `new()` factory + `validate()` (non-empty dataUrl + positive scale)
  * `LayeredChannels` — 4 Option<TextureChannelInfo> (albedo / normal
    / roughness / metallic) + `has_any_channel()` + `channel_count()`
    + `validate()` (per-channel, first-error)
- **VisualProperties 확장**: `layered: Option<LayeredChannels>` —
  ADR-091 §E L1 canonical **6번째 일관 적용** (additive only +
  `#[serde(default)]`)
- **사후 정정 — bincode 호환성 정밀화**: 초안에 `#[serde(default,
  skip_serializing_if = "Option::is_none")]` 적용했으나 bincode 의
  positional encoding 에서 `skip_serializing_if` 가 EOF 를 유발
  (test `visual_properties_bincode_roundtrip_with_legacy_payload`
  fail). 정정: `#[serde(default)]` 만 유지 (Option tag 1 byte 영구
  포함). Legacy snapshot 호환은 ADR-098 S-γ section 9 fallback 으로
  보장 (entire material_library 가 Scene::new 으로 fallback). **신규
  Lesson** — bincode positional 의 `skip_serializing_if` 함정.
- **MaterialLibrary 신규 helper 2개**:
  * `migrate_legacy_textures_to_layered() -> usize` — idempotent +
    monotonic counter (ADR-098 S-D 패턴 답습). 현재 axia-core 에
    legacy texture field 가 없어 empty layered payload normalization
    만 수행 — L-γ TS bridge wiring 시 본격 활용
  * `validate_layered_channels() -> Result<(), (MaterialId, String)>`
    — snapshot export 전 strict gate
- **24+ VisualProperties construction sites 일괄 패치**: material.rs
  의 12 built-ins + scene.rs 의 6 test sites + axia-wasm 의 2 sites
  모두 `layered: None,` 추가. Python regex sed 로 일괄 자동 적용
  (수동 편집 위험 회피)
- **회귀 (axia-core)**: +14 tests
  * texture_projection_default_is_planar
  * texture_channel_info_validate_accepts_minimal
  * texture_channel_info_validate_rejects_empty_dataurl
  * texture_channel_info_validate_rejects_nonpositive_scale (3 cases)
  * layered_channels_default_is_all_none
  * layered_channels_count_and_has_any_track_population
  * layered_channels_validate_emits_first_channel_error
  * visual_properties_layered_default_is_none
  * visual_properties_bincode_roundtrip_with_legacy_payload (bincode
    함정 회귀 차단)
  * material_library_migrate_legacy_textures_is_idempotent
  * material_library_migrate_strips_empty_layered_payloads
  * material_library_validate_layered_returns_ok_for_clean_library
  * material_library_validate_layered_emits_material_id_with_error
  * locked_26_form_layer_unaffected_by_layered_extension (LOCKED #26 guard)
- **Cargo sweep**: axia-core 267 → **281 PASS** (+14). axia-geo 1256
  unchanged. axia-wasm 49 PASS unchanged (2 VisualProperties sites
  patched to compile). 절대 #[ignore] 금지 14/14 준수.
- **누적 L-α ~ L-β**: docs +1 ADR, axia-core +14 = **+14**
- **Lessons applied**:
  * ADR-091 §E L1 canonical **6번째 적용** — additive only +
    `#[serde(default)]`
  * **신규 Lesson** — bincode positional 의 `skip_serializing_if`
    함정 (EOF 유발). 향후 bincode struct 에 Option 필드 추가 시
    `skip_serializing_if` 금지, default 만 사용
  * Python regex sed 일괄 패치 — 24+ site 의 struct 변경 시 수동
    편집 위험 회피 (ADR-087 K-ζ 답습 — sed + cargo catch)
  * Validation helper bulk + per-instance 분리 — `TextureChannelInfo::
    validate` (single) + `LayeredChannels::validate` (4-channel) +
    `MaterialLibrary::validate_layered_channels` (entire library)

### L-γ ~ L-η (예정, multi-week)
별도 sub-step 결재 시 commit 진행. 각 sub-step standalone usable
(atomic invariant).
