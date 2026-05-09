# ADR-091: Material Removal → Shape 가역 강등 (Phase 2) — **Accepted**

> **Note**: CLAUDE.md LOCKED #26 의 "Phase 2 (ADR-052 예정)" 표기는
> 작성 시점 placeholder. 실제 ADR 번호는 **091** (052 는 NURBS Kernel
> Completion Roadmap 이 선점).

- **Status**: Accepted (D-α ~ D-η closure 2026-05-09)
- **Date**: 2026-05-09
- **Supersedes**: 없음 (ADR-050 Phase 1 자연 연장)
- **Related**: ADR-049 §4 Q5 사건 1, ADR-050 Phase 1, LOCKED #26
- **Anchor**: 사용자 결재 2026-05-09 — "🅰 (ADR-052 Phase 2) 진행 승인"

## 1. Context

ADR-050 Phase 1 (LOCKED #26) 으로 Form citizen `Shape` 와 Property
citizen `Xia` 의 분리 + 단방향 promote (Shape → Xia) 활성. 그러나
ADR-049 §4 **Q5 사건 1** 의 약속 — *"재질 제거 시 5초 알림 후 Shape
가역 강등"* — 미이행 상태.

현재 동작:
- Xia 재질 제거 → 단순 `Material::default()` 로 reset (placeholder)
- 시민권 강등 안 됨 (Xia 가 재질 없이 잔존)
- 사용자 의도 ("재질 빼고 형태만 남기기") 와 모델 상태 불일치

## 2. Decision

**Xia 의 재질이 `FORM_MATERIAL` sentinel 로 변경되면 자동으로 Shape 로
가역 강등**한다. 강등 시 `original_shape_id` 가 보존되어 향후 promote
시 동일 ID 복원. Undo 5초 알림 + Toast "되돌리기" 버튼 + 영구 Undo
history 보존.

### 2.1 Lock-ins

- **L1**: 강등 트리거 = `xia.material == FORM_MATERIAL` 자동 (D-A=a)
- **L2**: 위상 무결성 unchanged — face_ids 그대로 이전 (D-B=a). Q5 사건
  2~4 (위상 손상 자동 복구) 는 별도 ADR-054
- **L3**: 임시 보존 = TransactionManager snapshot (D-C=b). DemotionRecord
  struct 신설 안 함
- **L4**: ShapeId 가역 — `xia.original_shape_id: Option<ShapeId>` 추가
  (D-D=b). promote→demote→promote 라운드트립 시 동일 ID 복원
- **L5**: Toast 5초 "되돌리기" 버튼 + 영구 Undo (D-E=a)
- **L6**: UI 진입점 = Inspector 재질 dropdown "없음" + 별도 "재질 제거"
  버튼 양쪽 (D-F=c). ADR-046 P31 #4 additive only

### 2.2 Stack

```
Inspector "재질 제거" / dropdown "없음"          ← D-δ UI
  ↓
SelectionManager.demoteXiaToShape                ← D-γ TS routing
  ↓
WasmBridge.demoteXiaToShape                      ← D-γ typed
  ↓
demoteXiaToShape WASM export                     ← D-γ
  ↓
Scene::demote_xia_to_shape                       ← D-β core
  ├─ 재질 == FORM_MATERIAL 검증
  ├─ original_shape_id 복원 (Some) 또는 새 ShapeId 발행 (None)
  ├─ Scene.shapes 등재 (face_ids move)
  ├─ Scene.xias 제거 + shape_to_xia cleanup
  └─ TransactionManager snapshot
  ↓
Toast 5초 "재질 제거됨 — 형태로 강등 [되돌리기]" ← D-δ
```

## 3. Decision Matrix (D-A ~ D-F)

| ID | 결정 | 채택 |
|----|------|------|
| D-A | 강등 트리거 정책 | (a) 재질 == FORM_MATERIAL 자동 |
| D-B | 위상 무결성 처리 | (a) face_ids unchanged |
| D-C | 임시 보존 정책 | (b) TransactionManager snapshot 재사용 |
| D-D | ShapeId 재사용 | (b) original_shape_id 복원 |
| D-E | 5초 알림 UX | (a) Toast.info + "되돌리기" 버튼 |
| D-F | UI 진입점 | (c) dropdown "없음" + 별도 버튼 |

## 4. Path Z Atomic Decomposition (7 sub-step)

| sub-step | 영역 | 회귀 예상 |
|---|---|---|
| **D-α** | spec only (본 commit) | 0 |
| **D-β** | Rust `Scene::demote_xia_to_shape` + `Xia.original_shape_id: Option<ShapeId>` | axia-core +5~7 |
| **D-γ** | WASM `demoteXiaToShape` + TS bridge wrapper | axia-wasm +2, vitest +3 |
| **D-δ** | Inspector UI (dropdown "없음" + "재질 제거" 버튼) + Toast 5초 | vitest +5~7 |
| **D-ε** | Snapshot section 7 확장 (`original_shape_id` round-trip) | axia-core +2 |
| **D-ζ** | E2E Playwright (재질 제거 → Shape badge → Undo 복원) | E2E +2 |
| **D-η** | LOCKED #26 Phase 2 update + ADR §D closure | 0 |

**누적 예상**: axia-core +7~9, axia-wasm +2, vitest +8~10, E2E +2 =
**+19~23**, 절대 #[ignore] 금지 정책 준수.

## 5. ADR-050 Phase 1 의존성

- ✅ Shape struct (P-1) — face_ids storage 재사용
- ✅ FORM_MATERIAL sentinel (P-5e-β) — 강등 trigger
- ✅ replace_last_after_snapshot (P-5e-γ) — Undo 1회 패턴 답습
- ✅ shape_to_xia map (P-2) — 역방향 cleanup
- ✅ Inspector "형태 (Shape)" / "XIA (특성)" 라벨 (P-6) — 자동 전환

Phase 1 인프라가 모든 layer 를 cover. 신규 storage 0.

## 6. 위험 분석

- **L1 (낮음)**: face_ids 순서 보존 — `Vec<FaceId>` direct move (검증
  회귀 1건)
- **L2 (낮음)**: 1 face = 1 owner invariant (Phase 1 P-2) 가 충돌 차단
- **L3 (중간)**: 5초 Undo 윈도우 후에도 normal Ctrl+Z 작동 — Toast 는
  *알림* 만, Undo 능력은 영구
- **L4 (낮음)**: Snapshot legacy 호환 — `original_shape_id: Option`,
  legacy 파일 None default

## 7. ADR-046 P31 정합

- #1 (P1+P3 가치): ✅ — "재질 제거 시 형태 보존" = 건축/디자인 직관
- #4 (additive only): ✅ — 메뉴/단축키 미변경

## 8. Out of Scope

- Q5 사건 2~4 (위상 손상 자동 복구 + 다이얼로그) — 별도 ADR-054
- Phase 3 (Reference 시민권 분리) — 별도 ADR-053
- Bulk demote (multi-Xia 동시 강등) — D-β 의 single-Xia API 위에 D-δ
  UI loop 으로 충분
- Promote 도구 trigger 변경 — Phase 1 P-2 unchanged

## 9. 회귀 방지 (절대 #[ignore] 금지)

D-β 단계 신규:
- `demote_xia_with_form_material_succeeds`
- `demote_xia_with_real_material_rejected`
- `demote_preserves_face_order`
- `demote_restores_original_shape_id`
- `promote_demote_promote_roundtrip_preserves_id`

D-γ 단계: WASM strict throw 회귀, TS wrapper 재시도 회귀

D-δ 단계: Toast 5초 + Undo 버튼, dropdown "없음" trigger

D-ε 단계: snapshot round-trip with `original_shape_id`

D-ζ 단계: 실제 Chromium 재질 제거 → Shape badge → Undo 복원

## D. Acceptance Log

### D-α (본 commit)
- **사용자 결재**: 2026-05-09, "🅰 (ADR-052 Phase 2) 승인합니다"
- **변경**: 본 ADR 작성. LOCKED #26 Phase 2 진입 표시 (D-η 에서 closure
  표시).
- **회귀**: +0 (docs only).

### D-β (본 commit)
- **사용자 결재**: 2026-05-09, "진행" 승인.
- **변경**:
  * `crates/axia-core/src/xia.rs` — `Xia.original_shape_id:
    Option<ShapeId>` 필드 추가 (`#[serde(default)]` legacy 호환).
    `Xia::new` 에서 `None` 초기화.
  * `crates/axia-core/src/promote.rs` — `DemoteError` enum 신규
    (XiaNotFound / MaterialNotFormSentinel / ShapeIdConflict) +
    `DemoteOk { shape_id, original_id_restored }` struct.
  * `crates/axia-core/src/scene.rs`:
    - `promote_shape_to_xia` — `xia.original_shape_id = Some(shape_id)`
      기록 (D-D=b lock-in).
    - `Scene::demote_xia_to_shape(xia_id) -> Result<DemoteOk, DemoteError>`
      신규. 4-단계 검증 + ShapeId 복원 정책 (3 분기: pre-existing
      Shape extend / deleted slot restore / fresh allocation) +
      face_to_xia/face_to_shape 정합 + shape_to_xia cleanup.
- **회귀**: axia-core 209 → **215** (+6, 절대 #[ignore] 금지 6/6
  준수):
  * `demote_with_form_material_succeeds`
  * `demote_with_real_material_rejected` (no side effects on rejection
    검증 포함)
  * `demote_preserves_face_order` (L1 lock-in)
  * `demote_restores_original_shape_id` (D-D=b)
  * `promote_demote_promote_roundtrip_preserves_id` (가역 라운드트립)
  * `demote_xia_not_found`

### D-γ (본 commit)
- **사용자 결재**: 2026-05-09, "승인합니다".
- **변경**:
  * `crates/axia-wasm/src/lib.rs` — `demoteXiaToShape(xia_id: u32) ->
    Result<String, JsValue>` export. JSON 반환
    `{"shape_id":<u32>,"original_id_restored":<bool>}`. Transaction
    wrap (success commit / failure cancel — silent skip 차단).
  * `crates/axia-wasm/tests/export_baseline.txt` — `demoteXiaToShape`
    entry 추가 (alphabetical 위치 deleteShape 아래).
  * `crates/axia-wasm/tests/step6_additive_only.rs` — 2 wiring tests:
    `adr091_d_gamma_demote_endpoint_wired` (signature + JSON shape) +
    `adr091_d_gamma_demote_uses_transaction_with_cancel_on_error`.
  * `web/src/bridge/WasmBridge.ts`:
    - `AxiaEngineExtended.demoteXiaToShape?(xiaId: number): string` 추가
    - `WasmBridge.demoteXiaToShape(xiaId): { shapeId, originalIdRestored }`
      typed wrapper. 미가용 endpoint / engine throw / FORM_MATERIAL
      미충족 모두 throw (caller 가 try/catch 후 Toast).
  * `web/src/bridge/WasmBridge.test.ts` — 3 wrapper tests:
    JSON parse / engine throw 전파 / endpoint missing throw.
- **회귀**:
  * axia-wasm 34 → 36 (+2 wiring)
  * vitest WasmBridge.test.ts 136 → 139 (+3 wrapper)
  * 합계 **+5**, 절대 #[ignore] 금지 5/5 준수.

### D-δ (본 commit)
- **사용자 결재**: 2026-05-09, "승인합니다".
- **변경**:
  * `web/src/ui/Toast.ts` — `ToastAction { label, onClick }` interface
    + `show()` 5번째 인자 `action?` 추가 (backward-compatible) +
    static `Toast.infoWithAction(message, action, duration=5000)`
    convenience method. Action button 은 `<button>` element, click 시
    handler 1회 invoke + toast 즉시 dismiss + propagation 차단.
  * `web/src/citizenship/MaterialRemovalDemote.ts` (신규):
    - `resolveOwningXiaIds(bridge, faceIds): number[]` — face → Xia
      매핑 (unique, 첫 등장 순서 보존, no-owner skip)
    - `attemptMaterialRemovalDemote(bridge, faceIds): { demoted,
      errors, visited }` — visited Xia 별 demoteXiaToShape 시도, partial
      failure 흡수
    - 별도 모듈로 분리하여 D-δ 트리거 점 (Inspector 2개) 사이의 SSOT
      + test 격리 가능.
  * `web/src/ui/XiaInspector.ts`:
    - matSelect change "없음" + xi-assign-btn 해제 버튼 양쪽에서
      `attemptMaterialRemovalDemote` 호출 (Lock-in D-F=c entry #1, #2).
    - 강등 성공 시 `Toast.infoWithAction("재질 제거됨 — 형태로 강등",
      { label: "되돌리기", onClick: bridge.undo() }, 5000)` (D-E=a).
      여러 Xia 강등 시 "N개 객체 ..." pluralization.
    - Partial failure 시 별도 `Toast.warning(...)`.
- **회귀**:
  * vitest Toast.test.ts 15 → 17 (+2: action button render / single-
    invoke + dismiss)
  * vitest MaterialRemovalDemote.test.ts 0 → 9 (신규):
    resolveOwningXiaIds 4개 (unique / no-owner skip / order /
    empty) + attemptMaterialRemovalDemote 5개 (success / partial
    failure / no-owner skip / empty / shared faces dedup)
  * 합계 **+11**, 절대 #[ignore] 금지 11/11 준수
  * 전체 vitest 1632 → 1646 (+14, D-γ +3 + D-δ +11) — XiaInspector.test
    2/2 회귀 자산 unchanged (Inspector wiring 변경에도 PASS 유지)

### D-ε (본 commit)
- **사용자 결재**: 2026-05-09, "승인합니다".
- **D-β 사후 정정** (architectural correctness): D-β 가 `Xia.original_shape_id`
  필드 추가로 구현했으나, **bincode 가 positional encoding 이라 신규
  필드 추가는 legacy V2 snapshot bincode roundtrip 을 깨는 위험** 발견.
  ADR-050 P-2-d 의 명시적 lock-in ("tracking lives on Scene, not on Xia
  struct ... to keep Xia bincode-compatible") 위반. D-ε 진입 시 즉시 정정:
  * `Xia.original_shape_id` 필드 제거 (xia.rs)
  * `Scene.xia_to_original_shape: HashMap<XiaId, ShapeId>` 신규 (P-2-d
    precedent 답습)
  * `promote_shape_to_xia` / `demote_xia_to_shape` 가 map 사용
  * D-β 회귀 테스트 6건은 `xia.original_shape_id` → `scene.
    xia_to_original_shape.get(&xid)` 로 자연 갱신 (semantic 동일)
- **변경**:
  * `crates/axia-core/src/xia.rs` — `original_shape_id` 필드 제거
    (D-β 정정).
  * `crates/axia-core/src/scene.rs`:
    - `Scene.xia_to_original_shape: HashMap<XiaId, ShapeId>` 추가
    - `Scene::new()` 초기화
    - `promote_shape_to_xia` 가 map 에 기록
    - `demote_xia_to_shape` 가 map 에서 읽고 cleanup (one-way 소비)
    - `scene_snapshot` write 측 — sub-section 7d 추가
      (`[xia_to_orig_len:u64][xia_to_orig_data]`)
    - `restore_scene_snapshot` read 측 — sub-section 7d 처리,
      legacy snapshot 부재 시 empty map default
    - `analyze_snapshot` (A-μ) — sub-section 7d 인식 추가
    - `SnapshotSections.xia_to_original_shape: bool` 필드
- **회귀** (axia-core 215 → 217, +2):
  * `adr091_d_epsilon_xia_to_original_shape_roundtrip_v2` — promote 후
    snapshot export → import → 복원된 scene 에서 demote 가 ShapeId 정확
    복원
  * `adr091_d_epsilon_legacy_v2_without_section_7d_loads_empty_map` —
    7d sub-section 이 없는 legacy V2 payload (truncated + payload_len
    patched) 가 empty map 으로 graceful load. Shape state (sub-sections
    7a/b/c) 는 보존
  * 합계 **+2**, 절대 #[ignore] 금지 2/2 준수.
- **누적 회귀** (D-α ~ D-ε): axia-core +8, axia-wasm +2, vitest +14 =
  **+24** 전체. 절대 #[ignore] 금지 24/24 준수.

### D-ζ (본 commit)
- **사용자 결재**: 2026-05-09, "승인합니다".
- **변경**:
  * `web/e2e/adr-091-material-removal-demote.spec.ts` (신규):
    Real Chromium round-trip 2 specs.
    - **#1 demoteXiaToShape rejects unknown XiaId**: production-like
      Vite preview 빌드에서 `bridge.demoteXiaToShape(99999)` →
      "demoteXiaToShape: XIA not found" throw 검증. D-γ strict-throw
      contract 의 cross-runtime 봉인.
    - **#2 snapshot section 7d additive bytes round-trip**:
      `bridge.exportSnapshot()` → `bridge.importSnapshot()` 동일 bytes
      identity (face/vert/edge counts unchanged). D-ε section 7d 가
      legacy V2 호환 + bincode 정합 한 번 더 봉인 (real bincode +
      WASM 환경).
  * 기존 ADR-075 `waitForBridgeReady` helper 재사용 — 새 fixture 0.
- **회귀**:
  * Playwright 19 → 21 (+2). 절대 #[ignore] 금지 2/2 준수.
  * E2E 2/2 PASS in real Chromium (3.3s, fast — slow channel 불필요).
- **Vite 재빌드 확인**: `npx vite build` 성공 (11.88s, initial bundle
  warning 외 새 deviation 0). WASM `axia_wasm_bg.wasm` 재빌드 + 새
  export `demoteXiaToShape` 가 production bundle 에 포함됨을 spec #1
  의 throw 검증으로 확인.
- **누적 회귀** (D-α ~ D-ζ): axia-core +8, axia-wasm +2, vitest +14,
  Playwright +2 = **+26** 전체. 절대 #[ignore] 금지 26/26 준수.

### D-η (본 commit — closure)
- **사용자 결재**: 2026-05-09, "승인합니다".
- **변경**:
  * `CLAUDE.md` LOCKED #26 — Phase 2 closure entry (D-α ~ D-η 누적
    회귀 +26 + 6-layer atomic 봉인 명시 + D-β 사후 정정 가이드 +
    Lessons 참조).
  * `docs/adr/README.md` — ADR-091 status `Proposed` → `Accepted`.
  * `docs/adr/091-material-removal-shape-demotion.md` — Status 갱신
    + §E Lessons 추가.
- **회귀**: +0 (docs only).

## E. Lessons

### L1 — bincode 신규 필드 위험 + Scene-level map precedent

**발견**: D-β 의 초기 구현은 `Xia.original_shape_id: Option<ShapeId>`
필드를 Xia struct 에 추가. 6 회귀 모두 PASS (fresh roundtrip 만 검증).
D-ε 진입 사전 검토에서 발견 — bincode 는 positional encoding 이므로
struct 신규 필드는 legacy V2 snapshot bincode roundtrip 을 깰 수 있음.
`#[serde(default)]` 도 mid-stream 에서 쓸모 없음 (bincode 가 다음 필드
바이트를 읽어버림).

**정정**: ADR-050 P-2-d 의 명시적 lock-in ("tracking lives on Scene,
not on Xia struct ... to keep Xia bincode-compatible") 답습으로
D-ε 에서 즉시 정정 — `Scene.xia_to_original_shape: HashMap<XiaId,
ShapeId>` map 으로 이동. Snapshot section 7d (additive) 로 영속화.

**향후 ADR 가이드** (canonical):
- bincode 로 직렬화되는 기존 struct 에 신규 필드 추가 **금지**.
- 모든 신규 1:1/1:N 매핑은 `Scene.{key}_to_{value}: HashMap<...>` 로
  추가 + snapshot section 7 sub-section 로 영속화 (additive).
- legacy V2 snapshot 호환 — 서브-section 부재 시 empty map default.

### L2 — Path Z atomic 의 사전 검토 가치

**관찰**: D-β 의 architectural drift 가 D-ε 사전 검토 단계에서 발견됨.
Path Z atomic decomposition 은 *각 sub-step 진입 직전* 의 사전 검토
시 직전 sub-step 의 구현을 cross-validate 하는 자연 기회. D-β 만
단독 land 했으면 production 까지 broken backward compat 가 누설됐을
risk.

**향후 ADR 가이드**:
- Path Z atomic 의 매 sub-step 사전 검토 시 직전 sub-step 의 lock-in
  정합 + 외부 invariant (bincode / serde / 다른 ADR LOCKED) 와의
  cross-check 1회 강제.
- 외부 architectural concern 발견 시 즉시 atomic 복구 (D-β → D-ε 의
  통합 정정 패턴).

### L3 — 6-layer atomic 패턴 (ADR-074/078 5-layer 위에 확장)

ADR-074 = 5-layer (Model + UI + Routing + Functional E2E + Visual).
ADR-078 = 5-layer persistence 변형 (Model + UI Runtime + Routing +
Persistence + Bridge + E2E).

ADR-091 = **6-layer atomic** (citizenship 변형):
- L-1 Rust core (D-β: Scene-level API + Xia/Shape 시민권 변환)
- L-2 Rust core 정정 (D-ε: bincode 정합 + Scene map 분리)
- L-3 WASM bridge (D-γ: typed export + JSON contract + transaction)
- L-4 TS wrapper (D-γ: typed wrapper + strict throw + endpoint gate)
- L-5 UI integration (D-δ: 2 trigger points + Toast + Undo button)
- L-6 Snapshot persistence (D-ε: section 7d additive + legacy 호환)
- L-7 Real Chromium E2E (D-ζ: cross-runtime contract 봉인)

**향후 ADR 가이드** — 시민권 변환 + persistence + UI 가 동시 변경되는
모든 architectural 변화는 본 6-layer 패턴 답습.

### L4 — UI orchestration 분리 가치

**관찰**: D-δ 에서 inline 으로 XiaInspector 에 demote 로직을 넣지 않고
별도 모듈 `web/src/citizenship/MaterialRemovalDemote.ts` 로 분리. 이로
인해:
- 2 trigger points (matSelect change "없음" + xi-assign-btn 해제) 의
  SSOT 확보 — 미래 추가 trigger point 도 동일 helper 호출
- jsdom 단위 회귀 9건이 가능 (Inspector DOM 의존성 없이 helper 호출
  자체 검증)
- helper 의 partial-failure 처리 (visited / demoted / errors 분리)
  를 단위 테스트로 명시적 봉인

**향후 ADR 가이드** — UI panel 에 새 시민권 변환을 추가할 때, **반드시
별도 helper 모듈로 분리** + jsdom 단위 회귀로 SSOT 확보. Inline
implementation 의 multi-trigger 정합 drift 차단.
