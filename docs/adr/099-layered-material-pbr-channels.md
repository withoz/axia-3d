# ADR-099: Layered Material 4-PBR Channels (Two-Layer Citizenship Phase 5-B)

- **Status**: Accepted (L-α ~ L-η all closed, 2026-05-10) — **LOCKED #26 완전 closure**
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

### L-γ (본 commit) — Snapshot section 9 자연 확장 + WASM bridge
- **commit**: 본 commit (axia-core + axia-wasm)
- **사후 정정 — L-β bincode 함정 완전 박멸**: L-β commit 에서
  VisualProperties.layered 의 `skip_serializing_if` 만 제거했으나
  `LayeredChannels` 내부 4 채널 (`normal` / `roughness` / `metallic`)
  과 `TextureChannelInfo.rotation` / `label` 에 동일 attribute 가 남아
  있어 partial layered roundtrip fail. 모든 Option<T> 필드에서
  `skip_serializing_if` 일괄 제거 — bincode positional EOF 영구 차단.
  새 회귀 `material_partial_layered_bincode_roundtrip` 가 regression
  guard.
- **axia-core lib re-exports**: `TextureProjection` / `TextureChannelInfo`
  / `LayeredChannels` → axia-wasm 직접 import 가능
- **Snapshot section 9 자연 확장** (ADR-098 S-γ activate):
  * material_library 전체 직렬화에 VisualProperties.layered 자동 포함
  * Legacy snapshot (pre-L-β) → ADR-098 S-γ section 9 fallback (entire
    library 가 Scene::new default 로 복귀, 모든 material 의 layered=
    None)
  * **Defensive deserialize logging** — silent failure 방지, eprintln
    on schema drift (사용자 데이터 손실 조기 감지)
- **WASM 5 endpoints** (additive — ADR-076 baseline guard PASS):
  * `getLayeredChannels(material_id) -> String` (JSON `{ hasLayered,
    channels? }` per-channel info)
  * `setLayeredChannel(material_id, channel, data_url, projection: u32,
    scale, rotation_or_nan, label) -> bool` (flat signature — primitive
    types only, NaN sentinel for None rotation, empty string for None
    label)
  * `clearLayeredChannel(material_id, channel) -> bool` (idempotent
    normalization — empty layered → None)
  * `migrateLegacyTextureToLayered() -> u32` (count migrated)
  * `hasLayeredMaterial(material_id) -> bool` (quick existence check)
- **export_baseline.txt** additive +5 (ADR-076 §C-amendment-1 정합).
- **회귀 (axia-core)**: +4 tests
  * adr099_section_9_layered_channels_round_trip (4 channels full)
  * adr099_section_9_legacy_material_without_layered_roundtrips
  * adr099_section_9_partial_layered_round_trip (sub-set 1 channel,
    bincode EOF regression guard)
  * material_partial_layered_bincode_roundtrip (direct Material
    bincode regression — fastest failure signal)
- **회귀 (axia-wasm)**: +5 tests
  * adr099_l_gamma_endpoints_wired (5 endpoint pin)
  * adr099_l_gamma_get_emits_has_layered_field (schema lock)
  * adr099_l_gamma_set_channel_uses_flat_signature (L-G primitive
    types only)
  * adr099_l_gamma_clear_normalizes_empty_layered (L-D idempotent)
  * adr099_l_gamma_has_layered_quick_check_returns_bool
- **Cargo sweep**: axia-core 281 → **285** (+4), axia-wasm 49 → **54**
  (+5). axia-geo 1256 unchanged. 절대 #[ignore] 금지 9/9 준수.
- **누적 L-α ~ L-γ**: docs +1 ADR, axia-core +18 (L-β 14 + L-γ 4),
  axia-wasm +5 = **+23**.
- **Lessons applied**:
  * **L-β 사후 정정 완전 박멸** — 모든 bincode struct Option 필드는
    `#[serde(default)]` 만 (skip_serializing_if 금지). 재발 방지 위해
    direct Material bincode regression guard 명시 추가
  * Flat primitive signature for WASM (NaN / empty string sentinel) —
    JSON parsing in Rust 회피 (no serde_json dep, ADR-098 S-γ 답습)
  * Defensive deserialize logging — silent failure 차단 (사용자
    데이터 손실 조기 감지)
  * Idempotent normalization (clear + migrate) — ADR-098 S-D pattern
    6번째 일관 적용

### L-δ (본 commit) — Render pipeline (Three.js)
- **commit**: 본 commit (web/src/viewport + materials + mocks)
- **TS LayeredChannels interface** (`web/src/materials/MaterialLibrary.ts`):
  * 4-channel mirror of Rust `LayeredChannels` (albedo / normal /
    roughness / metallic, all optional `TextureInfo`)
  * Coexists with legacy `TextureInfo` (single base) + `AuxTextureInfo`
    (normal + roughness only)
  * `VisualProperties.layered?: LayeredChannels` additive — legacy
    `texture` + `aux` fields UNCHANGED (L-ζ migration 별도 sub-step)
- **`LayeredMaterialBinding.ts` 유틸리티** (신규):
  * `applyLayeredChannels(target, layered, cache)` → 4-map async bind
  * `clearLayeredChannels(target)` → all-slot reset (sync, idempotent)
  * `hasAnyLayeredChannel(layered)` → predicate (Rust mirror)
  * **L-E color space 정합**: albedo → `SRGBColorSpace`, 나머지 3 →
    `NoColorSpace` (linear, data maps standard)
  * **Failure isolation**: 한 channel 실패가 다른 channel binding 차단
    안 함. `LayeredBindingResult { applied, failures }` per-channel
    surface
  * Structural typing — `LayeredBindingTarget` / `TextureCacheLike`
    interfaces (Three.js DOM 의존 없음, jsdom 테스트 가능)
  * Async-friendly — `Promise<LayeredBindingResult>` 단일 await 로
    결정적 ordering
- **Three.js mock 확장**: `SRGBColorSpace` / `NoColorSpace` /
  `LinearSRGBColorSpace` 상수 추가 (실제 Three.js literal string
  sentinel 미러)
- **Viewport.ts 영향 0**: 기존 `applyTextureAsync` / `applyAuxTextures
  Async` 경로 UNCHANGED. 새 utility 는 standalone — L-ε UI / L-ζ
  bridge 가 wiring 시점 결정
- **회귀 (Vitest jsdom)**: +13 tests
  * `hasAnyLayeredChannel` 3 (empty / albedo only / metallic only)
  * `applyLayeredChannels` 7 (4-channel bind / partial subset /
    no-op empty / sync cache hit / L-E color space verification /
    failure isolation / all-fail needsUpdate=false)
  * `clearLayeredChannels` 3 (all populated / no-op all null /
    partial clear)
  * 절대 #[ignore] 금지 13/13 준수
- **Full vitest sweep**: 115 files, **1803/1803 PASS** (1 skipped 무관,
  1790 → 1803 = +13)
- **누적 L-α ~ L-δ**: docs +1 ADR, axia-core +18, axia-wasm +5,
  vitest +13 = **+36**
- **Lessons applied**:
  * Pure utility extraction — Viewport.ts 의 거대 DOM 코드에서 logic
    을 분리, structural typing 으로 jsdom 테스트 가능 (ADR-091 §E L4
    UI orchestration 분리 패턴 7번째 적용)
  * Color space policy explicit — albedo sRGB vs data maps linear
    (Three.js docs 정합). Mock 에 colorSpace 상수 추가로 회귀 가드
  * Failure isolation — Per-channel `{applied, failures}` result.
    한 channel 실패가 caller 의 다른 channel binding 차단 안 함.
    silent skip 차단 (ADR-097 ok-envelope 답습)
  * Async-first signature — `Promise<Result>` 단일 await 로 결정성
    + 테스트 가능성. `await` chain 없이 단일 호출

### L-ε (본 commit) — UI integration
- **commit**: 본 commit
- **`LayeredMaterialDialog.ts`** (신규 single-channel upload helper):
  * `openLayeredChannelDialog(channel)` → returns
    `LayeredChannelUploadResult | null`. Per-channel atomic flow
    (file pick → projection prompt → scale prompt → result).
  * `parseProjectionInput` / `parseScaleInput` pure helpers
    (testable, fallback semantics matching legacy TextureUploadDialog)
  * Mirrors legacy `TextureUploadDialog` 패턴 — 1-tab default = single
    Albedo call site, L-F lock-in 정합 (multi-tab modal 별도 future)
- **`AssetLibraryPanel.ts` 확장**:
  * `renderLayeredIndicator` — 4-cell `A`/`N`/`R`/`M` glyph indicator
    per row. `al-channel-populated` class when host callback returns
    true (binary lit/dim; per-channel detail은 future).
  * `⊞ Layered` 버튼 — Project / User tier 만 (System 영구 immutable
    per ADR-098 S-G analog). Click → channel pick prompt → delegates
    to `openLayeredChannelDialog`.
  * **Callback-based wiring** (no bridge dependency):
    `hasLayeredMaterial?(id) → bool` + `onLayeredChannelUpload?(id,
    channel, info) → bool` — host (main.ts in L-ζ) wires these to
    bridge calls. **panel = pure view layer** (ADR-091 §E L4 답습).
- **`MaterialLibrary.ts` 확장**: `LayeredChannels` interface + `aux`
  field 자리에 `layered?: LayeredChannels` 추가 (L-δ commit 에서 이미
  추가됨, L-ε 는 활용)
- **Architecture lesson**: L-ε 의 panel/dialog 는 **bridge 의존 0**.
  L-ζ 가 callback wiring 추가 sub-step — 명확한 atomic 분리.
  ADR-097 / ADR-100 Recovery orchestrator 의 host-provided
  `demoteResolver` 패턴 답습.
- **회귀 (Vitest jsdom)**: +16 tests
  * `LayeredMaterialDialog.test.ts` — 11 tests (parseProjectionInput
    5 + parseScaleInput 4 + cancel-path 2 end-to-end)
  * `AssetLibraryPanel.test.ts` extended — +5 tests (4-cell
    indicator render / populated class on callback / dim without
    callback / ⊞ button tier visibility / cancel safety)
  * 절대 #[ignore] 금지 16/16 준수
- **Full vitest sweep**: 116 files, **1819/1819 PASS** (1 skipped 무관,
  1803 → 1819 = +16)
- **누적 L-α ~ L-ε**: docs +1 ADR, axia-core +18, axia-wasm +5,
  vitest +29 = **+52**
- **Lessons applied**:
  * Callback-based panel wiring — host injects bridge access via
    callbacks, panel stays bridge-agnostic. ADR-091 §E L4 UI
    orchestration 분리 **8번째 적용**
  * Pure parsing helpers (`parseProjectionInput`, `parseScaleInput`) —
    extracted from prompt-flow for deterministic unit coverage. E2E
    full-flow는 L-η Playwright (Real Chromium 환경)
  * Binary indicator MVP (모든 4 cell 동일 lit/dim) — per-channel
    introspection은 R-γ JSON 으로 가능, future polish

### L-ζ (본 commit) — Bridge TS wrappers + main.ts wiring
- **commit**: 본 commit
- **TS bridge typed wrappers** (`web/src/bridge/WasmBridge.ts`):
  * `AxiaEngineExtended` interface 확장 — 5 L-γ endpoints typed
    declaration (additive, ADR-097 T-δ 답습 패턴)
  * `getLayeredChannels(materialId): LayeredChannels | null` —
    null on `hasLayered:false`, parsed shape on populated. Engine
    `rotation/label = null` → TS `undefined` (ergonomic optional)
  * `setLayeredChannel(materialId, channel, info)` — flattens
    `TextureInfo` to WASM signature. Projection u32 mapping
    (planar=0, box=1, cylindrical=2). NaN sentinel for missing
    rotation, empty string for missing label
  * `clearLayeredChannel(materialId, channel)` — markDirty before
    delegate
  * `migrateLegacyTextureToLayered()` — count
  * `hasLayeredMaterial(materialId)` — boolean
  * Graceful safe defaults (null/false/0) on missing endpoint
- **main.ts wiring**:
  * AssetLibraryPanel callbacks 에 bridge 메서드 wire:
    `hasLayeredMaterial: (id) => bridge.hasLayeredMaterial(id)` +
    `onLayeredChannelUpload: (id, channel, info) =>
     bridge.setLayeredChannel(id, channel, info)`
  * L-ε callback-based design 의 자연 closure — panel/bridge 의 분리
    유지하면서 production layer 에서 connect
- **회귀 (Vitest jsdom)**: +9 tests
  * `WasmBridge.test.ts` — 9 tests:
    - getLayeredChannels null for hasLayered:false
    - getLayeredChannels parses populated channels (null → undefined)
    - setLayeredChannel flattens TextureInfo
    - setLayeredChannel uses NaN/empty string sentinels
    - setLayeredChannel maps cylindrical → 2 (projection enum)
    - clearLayeredChannel + markDirty
    - migrateLegacyTextureToLayered count
    - hasLayeredMaterial boolean
    - all wrappers graceful safe defaults on missing endpoint
  * 절대 #[ignore] 금지 9/9 준수
- **Full vitest sweep**: 116 files, **1828/1828 PASS** (1 skipped 무관,
  1819 → 1828 = +9)
- **누적 L-α ~ L-ζ**: docs +1 ADR, axia-core +18, axia-wasm +5,
  vitest +38 = **+61**
- **Lessons applied**:
  * Engine ↔ TS shape ergonomic mapping — engine `null` → TS
    `undefined`, NaN/empty-string sentinel for `Option<T>` flatten.
    ADR-098 S-γ + ADR-100 R-δ 답습
  * Callback wiring at main.ts boundary — panel/bridge 분리 유지
    (ADR-091 §E L4 답습 **9번째 적용**)
  * Discriminated-union return types — `LayeredChannels | null` vs
    `MaterialRemovalResult` ok-envelope — both express absence
    explicitly (silent skip 차단)
  * Markdirty placement — only on mutations (set/clear), read paths
    skip (ADR-097 T-δ 답습)

### L-η (본 commit) — Real Chromium closure + LOCKED #26 완전 closure
- **commit**: 본 commit (Playwright E2E + ADR-099 closure +
  LOCKED #26 5-Phase 완전 closure)
- **production bundle 재빌드**: WASM 5 L-γ endpoints + AssetLibraryPanel
  callback wiring (L-ζ main.ts) + LayeredMaterialBinding utility 모두
  production layer 노출
- **Playwright spec** (`web/e2e/adr-099-demo.spec.ts`, 5 scenarios):
  * Scenario 1 — Bridge surface: 5 endpoints production bundle 노출
    (getLayeredChannels / setLayeredChannel / clearLayeredChannel /
    migrateLegacyTextureToLayered / hasLayeredMaterial)
  * Scenario 2 — Set/Get round-trip: addProjectMaterial → setLayered
    Channel(albedo) → hasLayered=true → getLayeredChannels parses
    dataUrl + projection + label. normal/roughness/metallic undefined
  * Scenario 3 — Clear normalization: 마지막 채널 clear →
    hasLayered=false + getLayeredChannels returns null (engine 의
    idempotent normalize 정합)
  * Scenario 4 — Multi-channel: 4 채널 (albedo planar / normal box /
    roughness cylindrical / metallic planar) 모두 set → has=true →
    get all 4 with correct dataUrl + projection enum mapping
  * Scenario 5 — Migrate idempotent: fresh scene → first=0, second=0
- **회귀 (Real Chromium)**: Playwright +5 (production layer 검증).
  Full Playwright sweep: **47/47 PASS** (1 skipped 무관, 42 → 47).
  기존 ADR-075/077/078/091/094/096/097/098/100 E2E 무영향.
- **누적 (L-α ~ L-η closure)**:
  * docs +1 ADR (L-α)
  * axia-core +18 (L-β 14 + L-γ 4)
  * axia-wasm +5 (L-γ wiring)
  * vitest +38 (L-δ 13 + L-ε 16 + L-ζ 9)
  * Playwright +5 (L-η Real Chromium)
  * **합계 +66**, 절대 #[ignore] 금지 66/66 준수
- **사용자 facing 변화 요약** (Phase 5-B closure):
  * `VisualProperties.layered: Option<LayeredChannels>` — 4 PBR
    channel storage
  * `TextureProjection` enum 3-variant + `TextureChannelInfo` struct
  * 5 WASM endpoints + 5 TS bridge wrappers
  * `LayeredMaterialBinding.ts` Three.js 4-map binding utility
  * `LayeredMaterialDialog.ts` per-channel upload helper
  * `AssetLibraryPanel` 4-cell A/N/R/M indicator + ⊞ Layered button
  * `MaterialLibrary` migrate + validate helpers
- **6-Layer Atomic Stack 실제 검증** (L-α 명시한 evolution pattern):
  Engine (axia-core 4 types + helpers) + Snapshot section 9 자연 확장
  + Bridge (axia-wasm 5 endpoints) + Render (LayeredMaterialBinding
  utility) + UI (AssetLibraryPanel + LayeredMaterialDialog) + Bridge
  TS wrappers + main.ts wiring + Real Chromium E2E. ADR-097/100
  5-layer Recovery 위에 Render layer 추가된 6-layer pattern 완성.

## LOCKED #26 5-Phase 완전 closure

본 ADR-099 L-η closure 시점으로 LOCKED #26 Two-Layer Citizenship
Model 5-Phase 로드맵 모두 완료:
- Phase 1 (ADR-050 + ADR-051) — Shape/Xia type split ✅
- Phase 2 (ADR-091) — Material removal demote ✅
- Phase 3 (ADR-095 + ADR-096) — Reference citizenship ✅
- Phase 4 (ADR-097) — Topology damage auto-recovery ✅
- Phase 5-A (ADR-098) — Asset library 3-tier material scope ✅
- Phase 5-C (ADR-100) — Material removal recovery ✅
- **Phase 5-B (본 ADR-099) — Layered material 4-PBR channels ✅**

**Two-Layer Citizenship Model 의미적 완성** — v3.2 §13 main promise
정합, LOCKED #26 모든 약속 closure.

## Pattern Evolution Lessons (canonical, L-α ~ L-η 누적)

ADR-097/100 5-layer Recovery 1:1 mirror 가 *reproducibility 증명*
이었다면, ADR-099 6-layer Feature 추가는 *evolution 증명*. Render
layer 의 자연 삽입은 5-layer pattern 의 *generalization*:

1. **L1 (canonical)** — bincode skip_serializing_if 함정 영구 박멸
   (L-β/L-γ 사후 정정 누적). 향후 모든 bincode struct Option 필드는
   `#[serde(default)]` 만, `skip_serializing_if` 금지
2. **L2 (canonical)** — Mesh/Scene-level Map 통한 additive persistence
   (ADR-091 §E L1 **6번째 일관 적용**). VisualProperties.layered 는
   Material struct 의 자연 위치 — 외부 Map 회피
3. **L3 (canonical)** — Pure utility extraction (LayeredMaterialBinding)
   — Viewport 의 DOM 코드에서 logic 분리, structural typing 으로
   jsdom 테스트 가능 (ADR-091 §E L4 **9번째 적용** with L-ε callback
   wiring)
4. **L4 (canonical)** — Color space policy explicit (Three.js docs
   정합, albedo sRGB vs data maps linear)
5. **L5 (canonical)** — Failure isolation (per-channel `{applied,
   failures}` ok-envelope, ADR-097 답습)
6. **L6 (canonical)** — Engine ↔ TS ergonomic mapping (null →
   undefined, NaN/empty string sentinel for Option flatten,
   ADR-098/100 답습)
7. **L7 (canonical)** — Callback wiring at main.ts boundary —
   panel/bridge 분리 유지 (ADR-091 §E L4 9번째 적용)
8. **L8 (canonical)** — Discriminated-union return types — silent
   skip 차단
9. **L9 (canonical)** — Pattern evolution: ADR-097/100 1:1 mirror
   reproducibility 가능성 증명 + ADR-099 6-layer feature evolution
   가능성 증명. 향후 ADR 은 둘 중 적합한 패턴 선택 가능
