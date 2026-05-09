# ADR-098: Asset Library 3-Tier Material Scope (Two-Layer Citizenship Phase 5-A)

- **Status**: Accepted (S-α ~ S-ζ all closed, 2026-05-10)
- **Date**: 2026-05-09
- **Anchor**: LOCKED #26 Phase 5 명시 약속 ("자산 라이브러리 3계층 +
  Layered material"), v3.2 §13. ADR-049 §2.2 §4 Q3 ("재질 없는 단계엔
  XIA 안 노출"), ADR-091 §E L1 (Scene-level Map canonical), ADR-094 §E
  L1 (Additive-first 위험 격리).
- **Parent**: ADR-049 (Two-Layer Citizenship Model)
- **Sibling**: ADR-050 (Phase 1 ✅), ADR-091 (Phase 2 ✅), ADR-095
  (Phase 3 ✅), ADR-097 (Phase 4 ✅)
- **Successor (planned)**: ADR-099 (Phase 5-B — Layered material 4-PBR
  channels), ADR-100 (Phase 5-C — Material removal recovery)

---

## A. Problem Statement

ADR-049 §2.2 maps v3.2 spec §13 as **"자산 라이브러리 3계층"** (three-
layer asset library). 현재 `MaterialLibrary` 는 flat HashMap 단일 계층
- 12 built-in 재질 + custom 추가 가 **scope 분리 없이** 동일 namespace.
사용자 프로젝트 간 재질 공유, system 보호 (built-in 보존), user 라이
브러리 (재사용 가능 자산) 의 의미 분리가 부재.

본 ADR 은 Phase 5-A — **3-Tier Scope (System / Project / User)** 만
한정. Layered material (4 PBR channels) 와 Material removal recovery
는 후속 ADR-099 / ADR-100.

---

## B. Lock-ins (사용자 결재 2026-05-09)

### S-A — Storage location: Scene-level HashMap 분리
**ADR-091 §E L1 canonical 답습** — bincode positional encoding 위험 회피.
`Material` struct UNCHANGED. Scene 에 3 개 별개 map 추가:
```rust
Scene {
    system_materials: HashMap<MaterialId, Material>,  // immutable
    project_materials: HashMap<MaterialId, Material>,
    user_materials: HashMap<MaterialId, Material>,
    // legacy `materials: HashMap<MaterialId, Material>` 보존 — 기존
    // bincode 호환성 + migration path (S-D 참조)
}
```

### S-B — MaterialId namespace: tuple `(MaterialTier, u32)`
신규 type:
```rust
pub enum MaterialTier { System, Project, User }
pub struct ScopedMaterialId { tier: MaterialTier, local_id: u32 }
```
기존 `MaterialId(u32)` UNCHANGED — legacy assignment + FORM_MATERIAL
sentinel (MaterialId::new(0)) 보존. 신규 API 만 ScopedMaterialId 사용.

### S-C — User tier 영구 저장: localStorage MVP
key: `axia:user-material-library` (JSON serialized array). 외부 file
storage / cloud sync 는 Phase 5+ (별도 ADR).

### S-D — Migration: legacy `materials` field → 3-tier
- bincode 호환성: 기존 snapshot 의 `materials` field 그대로 deserialize
- Migration helper `Scene::migrate_legacy_materials()` — 12 built-in
  ID 검사 → System tier 로 분류, custom (id ≥ 100) → Project tier 로
  분류
- Section 9 신규 (snapshot version v3 bump 권장 — ADR-089 §A-μ pre-trigger
  활성)

### S-E — Default 활성: System ON / Project ON / User opt-in
- System / Project: 항상 활성 (기존 사용자 워크플로우 보존)
- User: localStorage `axia:user-material-tier-enabled = 'true'` 명시
  활성 (default OFF, ADR-097 self-modifying op safety 답습)

### S-F — UI 진입점
- **Inspector 기존 dropdown 확장**: `--- System ---` / `--- Project ---`
  / `--- User ---` 그룹 헤더 (optgroup)
- **신규 AssetLibraryPanel** (ComponentPanel 답습): 재질 browse / 추가
  / 삭제 / Project ↔ User 이동
- 메뉴 추가만 (ADR-046 P31 #4 — additive only)

### S-G — Material 삭제 시 정책 (Phase 5-C 와 분리)
- 본 ADR scope 외 — 단순 거부 (`MaterialInUse` Err) 또는 Project →
  User 이동만 허용. 자동 강등 + Orchestrator 통합은 ADR-100.

### S-H — Bridge surface: typed wrappers
- 신규 6 endpoints (additive — ADR-076 baseline guard PASS):
  * `listMaterialsByTier(tier: u32) -> String` (JSON array)
  * `addUserMaterial(json: String) -> u32`
  * `addProjectMaterial(json: String) -> u32`
  * `removeUserMaterial(localId: u32) -> bool`
  * `getMaterialTier(materialId: u32) -> i32` (-1 sentinel)
  * `migrateLegacyMaterials() -> u32` (count migrated)
- 기존 `assignMaterial` / `getMaterialForFace` UNCHANGED

---

## C. Path Z atomic 6-단계

| # | Sub-step | 산출물 | 회귀 |
|---|----------|--------|------|
| 1 | **S-α** spec | 본 ADR | 0 |
| 2 | **S-β** Rust core | `MaterialTier` enum + `ScopedMaterialId` + Scene 3 maps + migration helper | axia-core +8~12 |
| 3 | **S-γ** Snapshot section 9 + WASM bridge 6 endpoints | Section 9 additive (legacy 호환), bridge typed wrappers | axia-core +5, axia-wasm +6 |
| 4 | **S-δ** UI integration | XiaInspector dropdown optgroup + AssetLibraryPanel | vitest +12~15 |
| 5 | **S-ε** Settings flag (User tier opt-in) | `AssetLibraryUserTierSettings.ts` + SettingsPanel toggle | vitest +5 |
| 6 | **S-ζ** Real Chromium 시연 + closure | Playwright 4 scenarios (default tiers / user opt-in / inspector grouping / migration) | Playwright +4 |

**예상 총합**: axia-core +13~17, axia-wasm +6, vitest +17~20,
Playwright +4. **합계 ~+40~50**, 절대 #[ignore] 금지.

---

## D. Risk Matrix

| Risk | 영향 | 완화 |
|------|------|------|
| bincode 호환성 회귀 | 매우 높음 | Section 9 additive (S-γ) — legacy `materials` field 보존, deserialize 시 fallback. ADR-091 §E L1 답습 |
| Inspector dropdown UX 회귀 | 중 | optgroup 만 추가, 기존 단일 list ID 보존 (ADR-046 P31 #4) |
| User tier opt-in 사용자 facing 혼동 | 중 | Settings 한국어 hint + AssetLibraryPanel "User 라이브러리 활성화" 안내 (ADR-095 §E L3 humanize 답습) |
| Migration helper 가 12 built-in ID 잘못 분류 | 높음 | 명시적 ID list pinned + 회귀 test (모든 12 built-in 이 System tier 로) |
| Material deletion cascade (Phase 5-C 분리) | 낮음 (본 ADR) | 단순 `MaterialInUse` Err — 자동 강등은 ADR-100 |
| LOCKED #26 Form-layer material-agnostic 위반 | 매우 높음 | Form layer (Shape) 는 영원히 material 무관, Property layer (Xia) 만 ScopedMaterialId 보유 — 회귀 test 강제 |

---

## E. Cross-link

- LOCKED #26 (Two-Layer Citizenship Phase 5 약속)
- ADR-049 §2.2 §4 Q3 (재질 명명 분리), §4 Q4 (default_material 폐지)
- ADR-050 P-5e-β (FORM_MATERIAL sentinel — MaterialId::new(0))
- ADR-091 §E L1 (Scene-level Map canonical)
- ADR-094 §E L1 (Additive-first 위험 격리)
- ADR-095 §E L3 (humanize at boundary)
- ADR-097 §E L4 (ServiceContainer storage 함정 — 답습 회피)
- ADR-076 §C-amendment-1 (export baseline additive guard)
- ADR-046 P31 #4 (메뉴 additive only)
- ADR-089 §A-μ (snapshot V3 bump pre-trigger 활성)

---

## F. Phase 5 후속 트랙 (별도 ADR)

- **ADR-099 (Phase 5-B)** — Layered material (4 PBR channels: albedo +
  normal + roughness + metallic). VisualProperties 확장 + render
  pipeline binding. 본 ADR-098 의 ScopedMaterialId 위에 build.
- **ADR-100 (Phase 5-C)** — Material removal recovery. Material 삭제
  시 자동 face → FORM_MATERIAL 강등 (Phase 4 ADR-097 의 material-layer
  변형). Toast Undo + Orchestrator 답습.
- **Phase 5 closure**: ADR-098 + ADR-099 + ADR-100 모두 closure 시
  LOCKED #26 5-Phase 로드맵 완전 closure → ADR-049 Two-Layer Citizenship
  Model 의미적 완료.

---

## §D Acceptance Log

### S-α (본 commit)
- 본 ADR 작성. 사용자 결재 (2026-05-09): Option B + Q1~Q7 권장값 전체
  동의 + Phase 5-A α 즉시 진입.
- 회귀 0 (spec only).
- 다음 진입점 — S-β Rust core (별도 sub-step 결재).

### S-β (본 commit) — Rust core
- **commit**: 본 commit (axia-core material.rs)
- **사후 정정 — Map placement**: S-α 의 Lock-in S-A 는 "Scene 에 3 개
  별개 map" 명시했으나, audit 결과 `Scene.material_library` 가 이미
  Scene-level Map 의 자연 위치 (LOCKED #26 Phase 1 패턴 답습). bincode
  drift 위험 + 이중 storage 회피 위해 **`MaterialLibrary` 내부의
  parallel `tier_index` Map 으로 정정**. 의미적 동일 — 3 tier 가 동일
  Scene-level boundary 안에 있음. `tier_index` 는 `#[serde(default)]`
  로 legacy snapshot 호환.
- **신규 type 4 개**:
  * `MaterialTier { System, Project, User }` enum + `as_u32`/`from_u32`
    + `Display`
  * `ScopedMaterialId { tier, local_id }` struct (tuple ID, S-B)
  * `BUILTIN_MATERIAL_ID_MAX = 11` const (S-D 분류 anchor)
  * `CUSTOM_MATERIAL_ID_MIN = 100` const (Custom material id 시작)
- **신규 API 6 메서드**:
  * `create_material_in_tier(tier, ...)` — 명시적 tier 할당
  * `tier_of(id) -> Option<MaterialTier>` — tier lookup
  * `set_tier(id, tier) -> bool` — tier 이동
  * `materials_by_tier(tier) -> Vec<&Material>` — filtered view (deterministic order)
  * `migrate_legacy_materials() -> usize` — id range 휴리스틱 (idempotent)
  * `remove_material(id) -> Result<(), &str>` — System tier 거부
- **기존 API UNCHANGED**: `create_material` (now defaults to Project tier
  + auto-jump to id ≥ 100) / `get` / `get_mut` / `add_material` (built-in
  path → System tier) / `all` / `count` / Material struct (LOCKED #26
  invariant).
- **회귀 (axia-core)**: +14 tests
  * material_tier_u32_roundtrip
  * scoped_material_id_carries_tier_and_local_id
  * builtins_are_classified_as_system_tier
  * create_material_defaults_to_project_tier
  * create_material_in_tier_explicit_user
  * materials_by_tier_filters_correctly
  * migrate_legacy_materials_classifies_by_id_range
  * migrate_is_idempotent
  * remove_material_rejects_system_tier
  * remove_material_succeeds_for_project_or_user_tier
  * set_tier_moves_material_between_tiers
  * set_tier_returns_false_for_missing_material
  * legacy_load_with_empty_tier_index_is_recoverable
  * form_layer_unaffected_by_tier_changes_locked_26_invariant
- **Cargo sweep**: axia-core 238 → **252 PASS** (+14). axia-geo 1256
  unchanged. axia-wasm 42 unchanged. 절대 #[ignore] 금지 14/14 준수.
- **Lessons applied**:
  * ADR-091 §E L1 — parallel Map 패턴 (tier_index 가 materials 와 동일
    Scene-level boundary). Map placement 사후 정정 — 사용자 결재한
    spec 보다 architectural truth (audit) 가 우선.
  * Built-in immutability via `remove_material` Result, not type-level
    enforcement (test surface 우선)

### S-γ (본 commit) — Snapshot section 9 + WASM bridge
- **commit**: 본 commit
- **사후 정정 — Map type**: `MaterialLibrary.materials` HashMap → BTreeMap.
  bincode HashMap 직렬화는 iteration order 가 비결정적이라
  orphan_recovery::preview_leaves_scene_unchanged byte-equality test
  fail. BTreeMap 으로 deterministic 보장. `tier_index` 도 동시 BTreeMap.
  Public API 영향 0 (private fields).
- **Snapshot section 9 (additive)**:
  * `Scene.scene_snapshot` 끝에 `[material_library_len:u64][material_library_data]`
    추가 (legacy 호환 — 누락 시 default 12 built-ins 유지)
  * `restore_scene_snapshot` — section 9 deserialize + 자동
    `migrate_legacy_materials` 호출 (idempotent, ADR-098 S-D)
  * `analyze_snapshot` — `SnapshotSections.material_library` 신규 flag
  * 회귀 영향 — 기존 ADR-091 D-ε / ADR-095 Phase 3-ε strip-test 가
    section 9 길이 추가 강제 (`adr091_d_epsilon_legacy_v2_without_section_7d_loads_empty_map`
    의 strip_len 갱신)
- **WASM bridge 6 endpoints** (additive — ADR-076 baseline guard PASS):
  * `listMaterialsByTier(tier: u32) -> String` (JSON array,
    `{id, name, nameEn, tier, color}`)
  * `getMaterialTier(material_id: u32) -> i32` (-1 sentinel)
  * `addProjectMaterial(name, name_en, color) -> u32`
  * `addUserMaterial(name, name_en, color) -> u32`
  * `removeUserMaterial(material_id: u32) -> bool` — User tier only
    (S-G safety)
  * `migrateLegacyMaterials() -> u32` — count migrated
- **회귀 (axia-core)**: +5 tests
  * adr098_section_9_material_library_round_trips
  * adr098_section_9_legacy_snapshot_keeps_default_library
  * adr098_section_9_analyze_snapshot_marks_section_present
  * adr098_section_9_migration_runs_after_legacy_load
  * adr098_section_9_form_layer_invariant_unchanged_locked_26
- **회귀 (axia-wasm)**: +4 tests
  * adr098_s_gamma_endpoints_wired (6 endpoint pin)
  * adr098_s_gamma_list_returns_json_array (schema lock)
  * adr098_s_gamma_get_tier_uses_minus_one_sentinel
  * adr098_s_gamma_remove_user_only_blocks_other_tiers (S-G safety)
- **export_baseline.txt** additive +6 (ADR-076 §C-amendment-1 정합).
- **누적 S-α ~ S-γ**: axia-core +19, axia-wasm +4, docs +1 ADR =
  **+23**, 절대 #[ignore] 금지 23/23 준수.
- **Cargo sweep**: axia-core **257 PASS** (+5 from S-β), axia-geo
  1256 unchanged, axia-wasm **46 PASS** (+4 from S-β baseline 42).
- **Lessons applied**:
  * ADR-091 §E L1 — section 9 additive, MaterialLibrary 내부 변경
    (struct field 추가는 #[serde(default)] 만)
  * **HashMap → BTreeMap canonical for snapshot determinism** (신규
    lesson) — 향후 Scene 레벨 Map 추가 시 BTreeMap 우선
  * Legacy strip-test 누적 갱신 패턴 (ADR-091/095/098 모두 동일)

### S-δ (본 commit) — UI integration
- **commit**: 본 commit
- **TS bridge typed wrappers** (`web/src/bridge/WasmBridge.ts`):
  * `MaterialTier` discriminated union ('System' | 'Project' | 'User')
  * `ScopedMaterialInfo` interface
  * 6 wrappers — `listMaterialsByTier` / `getMaterialTier` /
    `addProjectMaterial` / `addUserMaterial` / `removeUserMaterial` /
    `migrateLegacyMaterials`
  * Graceful null/[] on missing endpoint (legacy build) + markDirty on
    mutations (ADR-097 T-δ 답습)
- **AssetLibraryPanel** (`web/src/ui/AssetLibraryPanel.ts`):
  * 3 tier sections (System / Project / User) with material count
  * Add buttons (Project / User) via prompt-based input (texture
    upload 별도, ADR-099 territory)
  * Remove button — User tier only (S-G safety lock)
  * Click callback for host integration (Inspector dropdown wiring 별도)
  * Inline CSS injection (single panel-styles `<style>` 요소)
  * ComponentPanel 답습 패턴 — DOM 직접 구성, refresh-on-demand
- **회귀 (Vitest jsdom)**: +21 tests
  * `WasmBridge.test.ts` — 9 tests (listByTier/tier mapping/sentinels/
    add/remove/migrate/graceful defaults)
  * `AssetLibraryPanel.test.ts` — 12 tests (hidden default / show
    triggers refresh / 3 sections / row swatch+label / S-G remove
    only / +Project / +User / cancel / confirm true+false / row
    click callback / toggle)
  * 절대 #[ignore] 금지 21/21 준수
- **Full vitest sweep**: 110 files, **1750/1750 PASS** (1 skipped 무관,
  1729 → 1750 = +21)
- **누적 S-α ~ S-δ**: axia-core +19, axia-wasm +4, vitest +21,
  docs +1 ADR = **+44**
- **Lessons applied**:
  * ADR-097 T-δ 답습 — graceful null on missing endpoint + markDirty
    on mutations
  * ADR-091 §E L4 답습 — UI orchestration (panel = view layer, bridge
    calls 직접 위임, host 가 뒤처리)
  * ADR-046 P31 #4 — additive only (기존 Inspector dropdown UNCHANGED;
    Inspector optgroup 확장은 별도 future)
- **Out of scope (별도 sub-step / future)**:
  * XiaInspector dropdown optgroup 확장 — 본 ADR 의 S-F 일부, panel
    독립 활성으로 충분 (UI 진입점 분리 가능). Inspector 통합은 host
    별 wiring + 기존 dropdown 보존 위해 future commit.
  * Texture upload integration (TextureUploadDialog 기존 자산 활용은
    ADR-099 Layered material 의 자연 anchor)
  * Project ↔ User 이동 UI (현재는 add/remove 만)
  * AssetLibraryPanel 의 main.ts 등록 — S-ε wiring 시점 (Settings
    flag + container.register)

### S-ε (본 commit) — Settings flag + main.ts wiring
- **commit**: 본 commit
- **Settings module** (`web/src/tools/AssetLibraryUserTierSettings.ts`):
  * `axia:asset-library-user-tier` localStorage key
  * **Default OFF** (S-E lock-in — User tier opt-in 안전 정책)
  * AutoTopologyRecoverySettings (ADR-097 T-ε) + AutoReferenceImportSettings
    (ADR-096) 패턴 답습 — `localStorage 'true'` explicit ON 보존
  * `getAssetLibraryUserTierMode` / `setAssetLibraryUserTierMode` /
    `onAssetLibraryUserTierModeChange`
- **main.ts wiring**:
  * `container.register('assetLibraryPanel', factory)` — lazy import +
    bridge guard. ServiceContainer SSOT 진입점 (window.__axia)
  * Single-instance pattern (caching planned via container key — current
    minimal implementation creates fresh on each invocation, sufficient
    for E2E + future consolidation in S-ζ)
  * Mount target: `#right-panel-container` (production layout) with
    `document.body` fallback (test surface)
- **SettingsPanel UI** (`web/src/units/SettingsPanel.ts`):
  * `#sp-asset-library-user-tier` 체크박스 + 한국어 hint
  * Default OFF 표시 (사용자 명시 활성)
- **회귀 (Vitest)**:
  * `AssetLibraryUserTierSettings.test.ts` — 5 tests (default OFF /
    localStorage variants / setMode persistence / listener fires-on-change)
  * `SettingsPanel.test.ts` 영향 없음 (20 PASS unchanged — additive
    체크박스만 추가)
  * 절대 #[ignore] 금지 5/5 준수
- **Full vitest sweep**: 111 files, **1755/1755 PASS** (1 skipped 무관,
  1750 → 1755 = +5)
- **누적 S-α ~ S-ε**: axia-core +19, axia-wasm +4, vitest +26,
  docs +1 ADR = **+50**
- **Lessons applied**:
  * ADR-097 T-ε / ADR-096 M-β / ADR-094 default ON 패턴 답습 — Settings
    module 의 캐노니컬 5-함수 surface (get/set/onChange + listeners)
  * **Default OFF for opt-in surfaces**: ADR-097 T-ε (self-modifying
    op safety) + ADR-098 S-ε (사용자 자산 라이브러리 활성) 모두 default
    OFF. ADR-094 default ON (메모리 절감, 시각 불변) 과 다름 — 사용자
    facing 의미 가변/추가 surface 는 default OFF
  * ServiceContainer storage 의 함정 (ADR-097 §E L4) 답습 — register
    시 factory function 직접 등록 (wrapper 거치지 않음)

### S-ζ (본 commit) — Real Chromium closure
- **commit**: 본 commit
- **production bundle 재빌드**: WASM 6 endpoints + main.ts
  `assetLibraryPanel` service. `AssetLibraryPanel-{hash}.js` lazy
  chunk 생성. Initial bundle 변동 minimal.
- **Playwright spec** (`web/e2e/adr-098-demo.spec.ts`, 5 scenarios):
  * Scenario 1 — Default OFF: localStorage 미설정 → flag = null
  * Scenario 2 — Explicit ON preference 보존: localStorage 'true'
    → page.reload 후 보존 (ADR-078 P-4 답습)
  * Scenario 3 — Bridge surface: 6 endpoints production bundle 노출
    (`listMaterialsByTier` / `getMaterialTier` / `addProjectMaterial`
    / `addUserMaterial` / `removeUserMaterial` / `migrateLegacyMaterials`)
  * Scenario 4 — 3-tier round-trip: System (12 built-ins immutable) +
    add Project (id ≥ 100) + add User (id ≥ 100) → list reflects
    insertion + getMaterialTier maps correctly
  * Scenario 5 — S-G safety: User tier removable + System tier removal
    rejected (12 built-ins preserved)
- **회귀 (Real Chromium)**: Playwright +5 (production layer 검증).
  Full Playwright sweep: **37/37 PASS** (1 skipped 무관, 32 → 37).
  기존 ADR-075/077/078/091/094/096/097 E2E 무영향.
- **누적 (S-α ~ S-ζ closure)**:
  * axia-core +19 (S-β 14 + S-γ 5)
  * axia-wasm +4 (S-γ 4 wiring tests)
  * vitest +26 (S-δ 21: bridge 9 + panel 12; S-ε 5: settings)
  * Playwright +5 (S-ζ Real Chromium)
  * **합계 +54**, 절대 #[ignore] 금지 54/54 준수
- **사용자 facing 변화 요약** (Phase 5-A closure):
  * `MaterialLibrary` 가 3-Tier scope 인식 (System / Project / User)
  * 12 built-in 재질 자동 System tier 분류 (immutable)
  * 신규 재질 default Project tier (id ≥ 100 auto-jump)
  * Project ↔ User tier 명시 이동 가능 (`set_tier`)
  * AssetLibraryPanel UI (3 sections + add Project/User + S-G safe remove)
  * `axia:asset-library-user-tier` localStorage flag (Default OFF)
  * SettingsPanel 체크박스 "User 라이브러리 활성화 (실험)"
  * `window.__axia.get('assetLibraryPanel')()` 진입점
- **Phase 5-A 완료** — LOCKED #26 Phase 5 의 첫 단계 closure. 후속:
  * **ADR-099 (Phase 5-B)** — Layered material (4 PBR channels)
  * **ADR-100 (Phase 5-C)** — Material removal recovery (face → FORM
    auto-demote, ADR-097 Orchestrator 답습)
- **6-Layer Path Z atomic 패턴** (ADR-097 Phase 4 답습):
  Engine truth (axia-core BTreeMap + Section 9) + Bridge (axia-wasm
  6 endpoints) + UI (AssetLibraryPanel) + Settings flag + main.ts
  wiring + Real Chromium E2E. ADR-091 6-layer + ADR-094 7-layer +
  ADR-097 6-layer 누적 위에 적용.
- **Lessons (canonical patterns, S-α ~ S-ζ 누적)**:
  * **L1 (신규)** — HashMap → BTreeMap canonical for snapshot
    determinism (S-γ 사후 정정). 향후 Scene-level Map 추가 시
    BTreeMap 우선
  * **L2 (사후 정정 정책)** — spec 의 "Scene 3 maps" 가 audit 결과
    `MaterialLibrary.tier_index` parallel Map 으로 정정 (ADR-091 §E
    L1 답습). 사용자 결재한 spec 보다 architectural truth (audit) 가
    우선 — ADR §D 에 정정 명시
  * **L3 (답습)** — Section additive + `#[serde(default)]` (ADR-091
    §E L1)
  * **L4 (답습)** — Legacy strip-test 누적 갱신 (ADR-091/095/098)
  * **L5 (답습)** — Settings module 5-함수 surface canonical
    (ADR-094/096/097)
  * **L6 (답습)** — Default OFF for opt-in / self-modifying (ADR-097
    T-ε)
  * **L7 (답습)** — UI orchestration 분리 + graceful null + markDirty
    (ADR-091 §E L4 + ADR-097 T-δ)

## Phase 5-A closure → ADR-099 / ADR-100 후속 트랙

본 ADR 으로 Two-Layer Citizenship Model 의 Phase 5 첫 단계 closure.
3-Tier scope (System / Project / User) 의 6-layer atomic stack 모두
활성. Phase 5-B (Layered material 4 PBR channels) 와 Phase 5-C
(Material removal recovery) 는 별도 ADR-099 / ADR-100 트랙.
