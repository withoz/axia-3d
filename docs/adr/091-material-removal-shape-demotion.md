# ADR-091: Material Removal → Shape 가역 강등 (Phase 2)

> **Note**: CLAUDE.md LOCKED #26 의 "Phase 2 (ADR-052 예정)" 표기는
> 작성 시점 placeholder. 실제 ADR 번호는 **091** (052 는 NURBS Kernel
> Completion Roadmap 이 선점).

- **Status**: Proposed (D-α spec only)
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

### D-β ~ D-η (예정)
별도 sub-step 결재 시 commit 진행.
