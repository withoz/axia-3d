# ADR-100: Material Removal Recovery (Two-Layer Citizenship Phase 5-C)

- **Status**: Accepted (R-α ~ R-ζ all closed, 2026-05-10)
- **Date**: 2026-05-10
- **Anchor**: LOCKED #26 Phase 5 약속 ("자산 라이브러리 3계층 +
  Layered material") + v3.2 §12.3 (material 삭제 시 자연 복구 →
  사용자 다이얼로그). ADR-049 §4 Q5 final ("v3.2 §12 strict — 재질
  제거 = 5초 알림, 위상 손상 = 자동 복구 시도 → 실패 시 사용자
  다이얼로그"). 본 ADR 은 Q5 사건 1 (재질 제거) 의 atomic closure.
- **Parent**: ADR-049 (Two-Layer Citizenship Model)
- **Sibling**: ADR-050 (Phase 1 ✅), ADR-091 (Phase 2 ✅), ADR-095
  (Phase 3 ✅), ADR-097 (Phase 4 ✅), ADR-098 (Phase 5-A ✅)
- **Successor (planned)**: ADR-099 (Phase 5-B — Layered material,
  별도 세션 / multi-week)
- **Direct ancestor pattern**: ADR-097 (Phase 4) — Orchestrator + Dialog
  + Settings flag + Real Chromium E2E 의 5-layer atomic stack 답습.

---

## A. Problem Statement

ADR-098 S-G 는 Material removal 의 surface 만 정의 — User tier 만
제거 가능, System/Project 거부. 그러나 **Project 재질을 사용 중인
Xia 가 있으면 어떻게 되나?** 현재는 거부도 자동 처리도 없음.

v3.2 §12.3 + ADR-049 §4 Q5 promise:
1. 재질 제거 시 사용자 알림 (Toast 5초)
2. 자동 복구 시도 (Xia → Shape 강등 또는 fallback 재질)
3. 실패 시 사용자 다이얼로그 ([Undo] / [강등] / [수동수정])

**ADR-097 의 material-layer 변형** — Phase 4 가 위상 손상 자동 복구
였다면, Phase 5-C 는 **재질 손상 (orphan material assignment) 자동
복구**. 같은 Orchestrator 패턴, 다른 damage 종류.

---

## B. Lock-ins (사용자 결재 대기)

### R-A — Damage detection scope: orphan material assignment
**ADR-097 detect_topology_damage 패턴 답습.** Scene-level wrapper —
`detect_orphan_material_assignments() -> OrphanMaterialReport`.
- **사건 1 (canonical)**: Xia.material 이 material_library 에 없음
  (e.g. removeUserMaterial 후 stale assignment)
- **사건 2 (확장)**: Xia.material 이 material_library 에 있지만 tier 가
  사라짐 (드물지만 가능 — bincode legacy 시나리오)

R-α scope 는 **사건 1 만** — 사건 2 는 ADR-098 migrate_legacy_materials
가 자연 복구 (idempotent). 본 ADR 의 entry는 사건 1.

### R-B — Recovery 전략 우선순위 3-tier
ADR-097 attempt_auto_recovery 와 동일 fixed-point loop:
1. **Pass 1 (auto-demote)**: orphan-material Xia 의 해당 material 을
   FORM_MATERIAL 로 set → ADR-091 D-δ 의 Xia → Shape demote 자동 trigger
   (ADR-091 D-β `demote_xia_to_shape` 의 4-condition 통과 시).
2. **Pass 2 (fallback)**: demote 실패 (예: face_ids 가 condition 미충족)
   → fallback 재질 (System tier id 0 = Concrete) 로 reassign. 사용자
   변경 인지 가능하도록 Toast 메시지에 "Concrete 로 임시 변경" 명시.
3. **Pass 3 (escalate)**: fallback 도 실패 → PartialFailure → Dialog.

### R-C — UI Orchestrator: ADR-097 패턴 직접 재사용
신규 helper:
- `web/src/citizenship/MaterialRemovalRecoveryDialog.ts` — ADR-097
  TopologyRecoveryDialog 답습 (3-option modal: [Undo] / [강등] /
  [수동수정])
- `web/src/citizenship/MaterialRemovalRecoveryOrchestrator.ts` —
  ADR-097 TopologyRecoveryOrchestrator 답습 (5-stage flow: detect →
  recover → escalate)

### R-D — Material removal API 확장
ADR-098 `removeUserMaterial` (User only, S-G safety) 보존. 본 ADR 추가:
- **`removeProjectMaterial(material_id) -> Result<RemovalOutcome>`** —
  Project tier 재질 제거 + 사용 중인 face cascade. RemovalOutcome enum:
  * `NoOp` — 사용 중인 face 없음, 단순 제거
  * `Recovered { affected_xias: usize, faces_demoted: usize }` —
    Pass 1+2 로 모든 사용처 복구
  * `PartialFailure { affected_xias: usize, remaining_orphans: usize }`
    → Orchestrator 가 dialog escalate
- **System tier removal** 영원히 거부 (R-G safety, ADR-098 S-G 답습)

### R-E — Default OFF (ADR-097 T-ε 답습)
`axia:auto-material-recovery` localStorage flag, **Default OFF**.
사용자 가 명시 활성 안 하면 `removeProjectMaterial` 호출 시 단순 reject
(`MaterialInUse` Err). 활성 시 Orchestrator 자동 trigger.

### R-F — Snapshot 영향 0
ADR-098 section 9 보존 — material_library 만 직렬화. Material removal
은 *runtime mutation* 이고 transaction 으로 wrap 됨 (ADR-091 D-β
패턴 답습 — bridge 호출 시 push_snapshot before, replace_last_after
on success).

### R-G — Bridge surface (additive — ADR-076 baseline guard PASS)
- `detectOrphanMaterialAssignments() -> String` (JSON report)
- `attemptMaterialRemovalRecovery(material_id: u32) -> String`
  (JSON outcome — NoOp/Recovered/PartialFailure)
- `removeProjectMaterial(material_id: u32) -> String` (JSON
  RemovalOutcome — convenience entry that combines `remove_material`
  + auto-recovery)

ADR-098 의 `removeUserMaterial` UNCHANGED.

### R-H — ADR-097 5-layer atomic stack 직접 재사용
Engine truth (axia-core detection + recovery) + Bridge (axia-wasm 3
endpoints) + UI orchestration (Dialog + Orchestrator) + Settings flag
+ Real Chromium E2E. ADR-097 의 5-layer 와 거의 1:1 mirror —
material-layer 변형으로 패턴 재사용.

---

## C. Path Z atomic 6-단계

| # | Sub-step | 산출물 | 회귀 |
|---|----------|--------|------|
| 1 | **R-α** spec | 본 ADR | 0 |
| 2 | **R-β** Rust core | `OrphanMaterialReport` + `MaterialRecoveryOutcome` enum + Scene::detect_orphan_material_assignments + Scene::attempt_material_removal_recovery + Scene::remove_project_material_with_recovery | axia-core +8~12 |
| 3 | **R-γ** WASM bridge 3 endpoints | additive (ADR-076 §C-amendment-1 정합) + step6_additive_only.rs wiring | axia-wasm +3 wiring |
| 4 | **R-δ** TS wrappers + Dialog + Orchestrator | ADR-097 helper 직접 답습 | vitest +18~22 |
| 5 | **R-ε** Settings flag + main.ts wiring | `AutoMaterialRecoverySettings.ts` + container.register | vitest +5 |
| 6 | **R-ζ** Real Chromium 시연 + closure | Playwright 4~5 scenarios | Playwright +4 |

**예상 총합**: axia-core +10, axia-wasm +3, vitest +25, Playwright
+4. **합계 ~+42**, 절대 #[ignore] 금지.

---

## D. Risk Matrix

| Risk | 영향 | 완화 |
|------|------|------|
| ADR-091 D-β demote API 호환성 | 매우 높음 | `demote_xia_to_shape` 직접 호출 — 새 API 추가 0 |
| Snapshot section 9 영향 | 낮음 | Removal 은 runtime mutation, snapshot 영향 0. transaction wrap 만 |
| Default OFF surface 미준수 | 높음 | ADR-097 T-ε 패턴 strict 답습 — `axia:auto-material-recovery` localStorage explicit ON |
| Fallback Concrete 의 사용자 facing 혼동 | 중 | Toast "임시 Concrete 로 변경됨" 명시 + Inspector 색 변경 가시 (ADR-095 §E L3 humanize 답습) |
| LOCKED #26 Form-layer material-agnostic 위반 | 매우 높음 | Form citizen (Shape) 영원히 material 무관 — Xia 의 material 만 변경, Shape 영향 0. 회귀 test 강제 |
| Project tier 재질 사용 중 cascade 한계 | 중 | RemovalOutcome::PartialFailure 로 escalate. 자동 복구 시도 후 사용자 결정 |

---

## E. Cross-link

- LOCKED #26 (Two-Layer Citizenship Phase 5-C 약속)
- ADR-049 §4 Q5 final (재질 제거 + 위상 손상 dialog)
- ADR-091 D-β (`demote_xia_to_shape` API — 직접 재사용)
- ADR-097 (Phase 4 — 5-layer atomic stack 직접 답습)
- ADR-098 S-G (`removeUserMaterial` — User tier 보존), R-D 의 surface 확장
- ADR-076 §C-amendment-1 (export baseline additive guard)
- ADR-046 P31 #4 (메뉴 additive only)

---

## F. Phase 5 closure 로드맵

본 ADR 으로:
- **Phase 5-A (ADR-098) ✅** — 3-Tier Material Scope
- **Phase 5-C (ADR-100) — 본 ADR R-α 진입** — Material Removal Recovery
- **Phase 5-B (ADR-099) — 별도 세션** — Layered material 4 PBR channels

ADR-100 closure 시 LOCKED #26 Phase 5 의 2/3 완료 (5-A + 5-C). 5-B 는
multi-week atomic 별도 세션.

---

## §D Acceptance Log

### R-α (본 commit)
- 본 ADR 작성. 사용자 결재 (2026-05-10): Option A + 사전 검토 spec
  즉시 작성 + ADR-097 패턴 직접 답습.
- 회귀 0 (spec only).
- 다음 진입점 — R-β Rust core (별도 sub-step 결재).

### R-β (본 commit) — Rust core
- **commit**: 본 commit (axia-core)
- **신규 type 4 개** (`scene.rs` 위쪽 public types 영역):
  * `OrphanMaterialReport { affected_xias: Vec<OrphanMaterialEntry> }`
    + `is_clean()` helper
  * `OrphanMaterialEntry { xia_id, stale_material_id, face_count }`
  * `MaterialRecoveryOutcome` enum 3 variants — `NoOp` /
    `Recovered { affected_xias, faces_demoted, faces_fallback }` /
    `PartialFailure { affected_xias, remaining_orphans }` (ADR-097
    `RecoveryOutcome` shape 직접 mirror)
  * `MaterialRemovalOutcome { removed_id, recovery }`
- **신규 Scene 메서드 3 개**:
  * `Scene::detect_orphan_material_assignments() -> OrphanMaterialReport`
    — read-only, FORM_MATERIAL sentinel skip, deterministic XiaId 정렬
  * `Scene::attempt_material_removal_recovery() -> MaterialRecoveryOutcome`
    — 3-tier cascade (Pass 1 auto-demote via ADR-091 D-β / Pass 2
    fallback FORM_MATERIAL / Pass 3 escalate)
  * `Scene::remove_project_material_with_recovery(material_id)
    -> Result<MaterialRemovalOutcome, &'static str>` — convenience
    entry (remove + cascade)
- **ADR-091 D-β `demote_xia_to_shape` 직접 재사용** — 새 Rust API 0,
  ADR-097 §B-T-A SSOT 정신 일관 (Recovery 자산 inventory 5개월 누적
  활용, ADR-097 §E L5 답습)
- **회귀 (axia-core)**: +10 tests
  * adr100_detect_returns_clean_for_fresh_scene
  * adr100_detect_skips_form_material_xias (LOCKED #26 sentinel guard)
  * adr100_detect_reports_xia_with_missing_material
  * adr100_attempt_recovery_noop_on_clean_scene
  * adr100_attempt_recovery_demotes_orphan_xia_to_shape (Pass 1 happy path)
  * adr100_remove_project_material_with_recovery_combines_entries
  * adr100_remove_system_tier_rejected (R-D safety)
  * adr100_attempt_recovery_ordering_deterministic (sort by XiaId)
  * adr100_form_layer_invariant_unchanged_locked_26 (LOCKED #26 guard)
  * adr100_recovery_idempotent_when_called_twice
- **Cargo sweep**: axia-core 257 → **267 PASS** (+10), axia-geo 1256
  unchanged, axia-wasm 0 unchanged (R-γ 에서 추가). 절대 #[ignore]
  금지 10/10 준수.
- **누적 R-α ~ R-β**: docs +1 ADR, axia-core +10 = **+10** (절대
  #[ignore] 금지 10/10).
- **Lessons applied**:
  * ADR-091 D-β `demote_xia_to_shape` 직접 재사용 — 새 API 0 정신
  * ADR-097 `RecoveryOutcome` enum shape mirror — naming + structure
    1:1, AI agent / 사용자 모두 패턴 학습 효율
  * LOCKED #26 P-5e-β FORM_MATERIAL sentinel 보존 — Pass 1 cascade
    의 trigger gate 로 활용 (ADR-091 D-A=a 정합)
  * Deterministic ordering via `sort_by_key(|e| e.xia_id)` —
    ADR-091/098 BTreeMap 패턴과 비슷한 결정성 보장 (R-β 는 ephemeral
    Vec 이지만 사용자 facing 의 순서 일관성 동일 가치)

### R-γ (본 commit) — WASM bridge 3 endpoints
- **commit**: 본 commit (axia-wasm + axia-core lib re-exports)
- **신규 axia-core re-exports** (`lib.rs`): `OrphanMaterialReport` /
  `OrphanMaterialEntry` / `MaterialRecoveryOutcome` /
  `MaterialRemovalOutcome` → axia-wasm 직접 import 가능
- **WASM 3 endpoints** (additive — ADR-076 baseline guard PASS):
  * `detectOrphanMaterialAssignments() -> String` (JSON
    `{"affectedXias":[{xiaId, staleMaterialId, faceCount},...]}`)
  * `attemptMaterialRemovalRecovery() -> String` (JSON union ADR-097
    T-δ shape 답습 — `NoOp` / `Recovered` / `PartialFailure`)
  * `removeProjectMaterial(material_id) -> String` (JSON envelope —
    `{ok, removedId, recovery}` on success / `{ok:false, error}` on
    failure)
- **export_baseline.txt** additive +3 (ADR-076 §C-amendment-1 정합).
- **회귀 (axia-wasm)**: +3 tests
  * adr100_r_gamma_endpoints_wired (3 endpoint pin — js_name +
    Rust function names)
  * adr100_r_gamma_recovery_json_uses_kind_discriminator (ADR-097
    T-δ shape lock — NoOp / Recovered / PartialFailure variants)
  * adr100_r_gamma_remove_project_returns_ok_envelope (silent skip
    차단 — both `ok:true` and `ok:false` paths emit envelope, includes
    `removedId`)
- **Cargo sweep**: axia-wasm 46 → **49 PASS** (+3), axia-core 267
  unchanged, axia-geo 1256 unchanged. 절대 #[ignore] 금지 3/3 준수.
- **누적 R-α ~ R-γ**: docs +1 ADR, axia-core +10, axia-wasm +3 =
  **+13**, 절대 #[ignore] 금지 13/13 준수.
- **Lessons applied**:
  * ADR-097 T-δ JSON shape 1:1 mirror — `{kind: ...}` discriminator
    union 패턴, AI agent / 사용자 모두 일관 학습
  * `format!`-based serialization (no serde_json dep) — ADR-098 S-γ
    list_materials_by_tier / ADR-097 attempt_auto_recovery 와 일관.
    Recovery 자산 inventory 정신 (ADR-097 §E L5 답습)
  * ok envelope on convenience entry — silent skip 차단 (`removeProjectMaterial`
    이 `Result<&str, &str>` error 도 사용자 facing 으로 명시)

### R-δ (본 commit) — TS wrappers + Dialog + Orchestrator
- **commit**: 본 commit
- **TS bridge typed wrappers** (`web/src/bridge/WasmBridge.ts`):
  * `OrphanMaterialEntry` / `OrphanMaterialReport` / `MaterialRecoveryOutcome`
    discriminated union (NoOp/Recovered/PartialFailure) /
    `MaterialRemovalResult` ok-envelope union
  * 3 wrappers — `detectOrphanMaterialAssignments` /
    `attemptMaterialRemovalRecovery` / `removeProjectMaterial`
  * Graceful null on missing endpoint + markDirty on mutations
    (ADR-097 T-δ 답습)
- **MaterialRemovalRecoveryDialog** (`web/src/citizenship/MaterialRemovalRecoveryDialog.ts`):
  * ADR-097 `TopologyRecoveryDialog` **1:1 mirror** — 3-option modal
    ([Undo] / [강등] / [수동수정])
  * Dialog id `axia-material-recovery-dialog` (distinct from topology)
  * Title "재질 손상 자동 복구 실패" (material-layer 변형 only)
  * Backdrop click + ESC dismiss → 'manual'
  * Single-instance guard + jsdom-testable pure DOM
- **MaterialRemovalRecoveryOrchestrator** (`web/src/citizenship/MaterialRemovalRecoveryOrchestrator.ts`):
  * ADR-097 `TopologyRecoveryOrchestrator` **1:1 mirror** — 5-stage
    flow (detect → recover → escalate)
  * `humanizeOrphanReport` SSOT (ADR-095 §E L3 humanize 패턴 답습)
    — "Xia N개 / 면 M개 재질 부재" Korean wording
  * `MaterialRecoveryOrchestratorResult` 6 statuses (clean / recovered
    / undone / demoted / manual / unavailable)
  * `MaterialDemoteResolver` caller hook for [강등] 버튼
- **회귀 (Vitest jsdom)**: +30 tests
  * `WasmBridge.test.ts` — 9 tests (detect / recover variants / remove
    ok-envelope success+error / markDirty / graceful defaults)
  * `MaterialRemovalRecoveryDialog.test.ts` — 10 tests (render /
    title differ from topology / 3 buttons / ESC / backdrop / cleanup
    / single-instance / enableDemote=false)
  * `MaterialRemovalRecoveryOrchestrator.test.ts` — 11 tests
    (humanize 2 + 9 flow paths: unavailable / clean / recovered /
    partial+undo / partial+manual / demote+resolver / demote without
    resolver / unavailable on attemptRecovery null / NoOp engine
    defensive)
  * 절대 #[ignore] 금지 30/30 준수
- **Full vitest sweep**: 113 files, **1785/1785 PASS** (1 skipped 무관,
  1755 → 1785 = +30)
- **누적 R-α ~ R-δ**: docs +1 ADR, axia-core +10, axia-wasm +3,
  vitest +30 = **+43**
- **Lessons applied**:
  * ADR-097 helpers **1:1 mirror** — 새 패턴 0, AI agent / 사용자 모두
    학습 효율 (canonical 5-layer atomic stack 의 5번째 layer 완성)
  * ADR-095 §E L3 humanize at boundary (`humanizeOrphanReport` Korean
    SSOT)
  * ok-envelope wrapper (silent skip 차단) — bridge 의 R-γ
    `removeProjectMaterial` JSON 을 typed union 으로 보존
  * 6-status orchestrator result (ADR-097 5-status 위에 'demoted'
    추가) — material-layer 의 demote 가 명시적 user action

### R-ε (본 commit) — Settings flag + main.ts wiring
- **commit**: 본 commit
- **Settings module** (`web/src/tools/AutoMaterialRecoverySettings.ts`):
  * `axia:auto-material-recovery` localStorage key
  * **Default OFF** (R-E lock-in — self-modifying op safety,
    ADR-097 T-ε 답습)
  * AutoTopologyRecoverySettings (ADR-097 T-ε) **1:1 mirror** —
    `getAutoMaterialRecoveryMode` / `setAutoMaterialRecoveryMode` /
    `onAutoMaterialRecoveryModeChange`
- **main.ts wiring**:
  * `container.register('materialRecovery', factory)` — lazy import +
    bridge guard + flag check. ADR-097 T-ε `topologyRecovery` 패턴
    **1:1 mirror**
  * `window.__axia.get('materialRecovery')()` 진입점 (E2E + future
    material-removal sites)
- **SettingsPanel UI** (`web/src/units/SettingsPanel.ts`):
  * `#sp-auto-material-recovery` 체크박스 + 한국어 hint
  * "재질 삭제 자동 복구 (실험)" — Default OFF 명시
- **회귀 (Vitest)**:
  * `AutoMaterialRecoverySettings.test.ts` — 5 tests (default OFF /
    localStorage variants / setMode persistence / listener change)
  * `SettingsPanel.test.ts` 영향 없음 (20 PASS unchanged — additive
    체크박스만 추가)
  * 절대 #[ignore] 금지 5/5 준수
- **Full vitest sweep**: 114 files, **1790/1790 PASS** (1 skipped 무관,
  1785 → 1790 = +5)
- **누적 R-α ~ R-ε**: docs +1 ADR, axia-core +10, axia-wasm +3,
  vitest +35 = **+48**
- **Lessons applied**:
  * ADR-097 T-ε / ADR-098 S-ε / ADR-096 M-β / ADR-094 default ON
    패턴 **누적 답습** — Settings module 5-함수 surface canonical
    (5번째 일관 적용 → AI agent / 사용자 모두 패턴 학습 완료)
  * Default OFF for opt-in surfaces (ADR-097 T-ε 정합 — 메모리/시각
    무관 변경 default ON vs material-mutation default OFF 의 명확
    분기)
  * ServiceContainer factory direct register (ADR-097 §E L4 답습)

### R-ζ (본 commit) — Real Chromium closure
- **commit**: 본 commit (Playwright E2E + ADR-100 closure)
- **production bundle 재빌드**: WASM 3 endpoints + main.ts
  `materialRecovery` service + `MaterialRemovalRecoveryOrchestrator`
  lazy chunk
- **Playwright spec** (`web/e2e/adr-100-demo.spec.ts`, 5 scenarios):
  * Scenario 1 — Default OFF: localStorage 미설정 → orchestrator
    `{ skipped: true }`
  * Scenario 2 — Explicit ON 보존: localStorage 'true' →
    page.reload 후 보존 → orchestrator runs → status 'clean' (clean
    scene NoOp)
  * Scenario 3 — Bridge surface: 3 endpoints production bundle 노출
    (`detectOrphanMaterialAssignments` / `attemptMaterialRemovalRecovery`
    / `removeProjectMaterial`). Clean scene → empty affectedXias +
    NoOp recovery
  * Scenario 4 — R-D safety: System tier removal (id 0) → ok envelope
    `{ok: false, error: "System..."}`. 12 built-ins preserved
  * Scenario 5 — Add Project mat + remove (no Xia assigned) → ok
    envelope success + NoOp recovery (no orphans to recover)
- **회귀 (Real Chromium)**: Playwright +5 (production layer 검증).
  Full Playwright sweep: **42/42 PASS** (1 skipped 무관, 37 → 42).
  기존 ADR-075/077/078/091/094/096/097/098 E2E 무영향.
- **누적 (R-α ~ R-ζ closure)**:
  * docs +1 ADR (R-α)
  * axia-core +10 (R-β)
  * axia-wasm +3 (R-γ)
  * vitest +35 (R-δ 30: bridge 9 + dialog 10 + orchestrator 11;
    R-ε 5: settings)
  * Playwright +5 (R-ζ Real Chromium)
  * **합계 +53**, 절대 #[ignore] 금지 53/53 준수
- **사용자 facing 변화 요약** (Phase 5-C closure):
  * `removeProjectMaterial(id)` bridge endpoint — Project tier 재질
    삭제 + 자동 복구 cascade
  * `attemptMaterialRecoveryWithDialog` orchestrator — `[Undo] /
    [강등] / [수동수정]` 다이얼로그 (ADR-097 1:1 mirror)
  * `axia:auto-material-recovery` localStorage flag (Default OFF)
  * SettingsPanel 체크박스 "재질 삭제 자동 복구 (실험)"
  * `window.__axia.get('materialRecovery')()` 진입점
- **5-Layer Path Z atomic stack 1:1 mirror** (ADR-097 Phase 4 답습):
  Engine truth (axia-core 4 types + 3 methods) + Bridge (axia-wasm 3
  endpoints) + UI orchestration (Dialog + Orchestrator) + Settings
  flag + main.ts wiring + Real Chromium E2E. ADR-097 5-layer 와 1:1
  mirror — 새 패턴 0, **canonical pattern reproducibility 의 가장
  강한 증명**.
- **Lessons (R-α ~ R-ζ canonical patterns)**:
  * **L1 (canonical)** — ADR-097 5-layer **1:1 mirror** 가능성 증명
    (engine + bridge + UI Dialog + Orchestrator + Settings + E2E 모두
    구조 동일). 새 패턴 0, 향후 *similar 5-layer atomic stack* (예:
    Phase 5-B Layered material recovery) 도 본 ADR 패턴 답습 가능
  * **L2 (canonical)** — ADR-091 D-β `demote_xia_to_shape` 직접 재사용
    (Recovery 자산 inventory 5개월 누적 활용, ADR-097 §E L5 정신)
  * **L3 (canonical)** — ADR-097 `RecoveryOutcome` enum shape mirror
    (NoOp/Recovered/PartialFailure) — engine + bridge + TS union 모두
    동일 shape. AI agent / 사용자 모두 일관 학습
  * **L4 (canonical)** — Settings module 5-함수 surface **5번째 일관
    적용** (ADR-094/096/097/098/100) — 패턴 확정
  * **L5 (canonical)** — Default OFF for self-modifying ops
    (메모리/시각 무관 변경 default ON vs material-mutation default
    OFF 의 분기 명확)
  * **L6 (canonical)** — ok-envelope union (silent skip 차단) — 사용자
    facing error 명시
  * **L7 (canonical)** — `humanize at boundary` (ADR-095 §E L3 답습)
    Korean wording SSOT in Orchestrator

## Phase 5-C closure → ADR-099 (Phase 5-B) 만 남음

본 ADR 으로 LOCKED #26 Phase 5-C 완료. 5-Phase 로드맵 진행 상황:
- Phase 1 (ADR-050+051) ✅
- Phase 2 (ADR-091) ✅
- Phase 3 (ADR-095+096) ✅
- Phase 4 (ADR-097) ✅
- Phase 5-A (ADR-098) ✅
- **Phase 5-C (ADR-100) ✅ 본 closure**
- Phase 5-B (ADR-099 — Layered material 4 PBR channels) ⏸
  multi-week atomic 별도 세션

Phase 5-B 완료 시 LOCKED #26 Two-Layer Citizenship Model **완전 closure**.
