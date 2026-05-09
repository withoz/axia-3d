# ADR-097: Topology Damage Auto-Recovery (Two-Layer Citizenship Phase 4)

- **Status**: Proposed (T-α — spec only)
- **Date**: 2026-05-09
- **Anchor**: LOCKED #26 Phase 4 명시 약속. ADR-049 §4 Q5 final
  ("v3.2 §12 strict — 위상 손상 = 자동 복구 시도 → 실패 시 사용자
  다이얼로그 [Undo] [강등] [수동수정]"), v3.2 §12.3 / §12.5
- **Parent**: ADR-049 (Two-Layer Citizenship Model)
- **Sibling**: ADR-050 (Phase 1 ✅), ADR-091 (Phase 2 ✅), ADR-095
  (Phase 3 ✅), ADR-096 (Phase 3 retro ✅)
- **Lessons applied**: ADR-091 §E L2 (사전 검토 가치 — multi-week
  진입 전 명확화), ADR-091 §E L4 (UI orchestration 분리), ADR-094 §E
  L1 (additive-first 위험 격리), ADR-094 §E L4 (Engine OFF + Production
  ON), ADR-095 §E L3 (사용자 facing 한국어 변환), ADR-096 §E L4
  (Default ON 패턴 4번째 ADR)

## 0. Summary

Q5 사건 2~4 (위상 손상) 의 자동 복구 + 실패 시 사용자 다이얼로그.
**5개월 누적 자산의 centralized orchestration** — 새 알고리즘 발명
0, 기존 자산 (verify_face_invariants / repair_non_manifold_edges /
orphan_recovery / demote_xia_to_shape) 의 결합.

**Architectural 본질**: 모든 ops 후 invariant 자동 검사 → 손상 검출
시 알려진 패턴 별 자동 복구 → 실패 시 [Undo] / [강등] / [수동수정]
3 옵션 다이얼로그.

## 1. Context

### 1.1 v3.2 §12 약속

ADR-049 §4 Q5 final 결정 (LOCKED #26 anchor):
> "v3.2 §12 strict — 재질 제거 = 5초 알림, **위상 손상 = 자동 복구
> 시도 → 실패 시 사용자 다이얼로그 ([Undo] [강등] [수동수정])**"

### 1.2 Q5 사건 4종 매핑

| # | 사건 | Trigger | Recovery 자산 | Phase |
|---|---|---|---|---|
| 1 | 재질 제거 | Inspector 사용자 explicit | Form 가역 강등 + Toast 5초 | ✅ Phase 2 / ADR-091 |
| 2 | Boundary edge 발생 | Boolean / Split 후 manifold 위반 | `repair_non_manifold_edges` (LOCKED #16 K-ε) | **Phase 4** ← |
| 3 | Degenerate face | Push-Pull / Offset 후 0-area / NaN normal | `deactivate_empty_emit_faces` (existing) | **Phase 4** ← |
| 4 | Orphan face | merge / split 후 face_to_xia mismatch | `orphan_recovery` (axia-core) | **Phase 4** ← |

### 1.3 architectural 발견 — recovery 자산 inventory (5개월 누적)

**Phase 4 가 새 알고리즘 발명 0** — 기존 자산이 충분:
- `Mesh::verify_face_invariants() -> InvariantReport` (ADR-007)
- `Mesh::verify_p7_manifold() -> P7ManifoldReport` (ADR-051)
- `Mesh::repair_non_manifold_edges()` (LOCKED #16 K-ε hotfix)
- `Mesh::deactivate_empty_emit_faces()` (degenerate cleanup)
- `Scene::orphan_recovery` (axia-core/orphan_recovery.rs)
- `Scene::demote_xia_to_shape()` (ADR-091 D-β — "강등" 다이얼로그 옵션)
- `TransactionManager::set_before_snapshot()` + undo (rollback option)
- `Toast.infoWithAction` (ADR-091 D-δ — Undo button 패턴)

## 2. Decision

**Centralized topology damage detection + recovery dispatcher + 사용자
다이얼로그**. 모든 ops 후 자동 검사, 손상 시 알려진 패턴 자동 복구,
실패 시 3-option 다이얼로그.

### 2.1 Lock-ins (canonical)

- **T-A** Detection trigger: 모든 ops 후 자동 (TransactionManager.commit
  직전). 사용자 명시 invocation 도 가능 (Inspector "검사" 버튼 — future).
- **T-B** Recovery 시점: Detection 직후 자동 (사용자 미인지). atomic
  fixed-point — 한 패스에 fix 완료 시 silent.
- **T-C** Recovery 실패 시: 사용자 다이얼로그 (3 옵션, T-D).
- **T-D** 다이얼로그 옵션:
  - **[Undo]**: TransactionManager rollback to before_snapshot
  - **[강등]**: ADR-091 demote_xia_to_shape (Form 으로 복귀, 의도 보존)
  - **[수동수정]**: 다이얼로그 dismiss + warning Toast (사용자 책임)
- **T-E** Default ON via Settings (ADR-094/096 답습, 4번째 ADR 누적):
  - `localStorage axia:auto-topology-recovery = 'false'` explicit OFF
  - Default ON — 신규 사용자 자동 보호
- **T-F** Recovery atomic: transaction wrap (recovery 자체 실패 시
  rollback, 사용자 손실 0).
- **T-G** Snapshot 기록: Recovery history 비저장 (실시간 처리, 다이얼로그
  통해서만 사용자 visible).
- **T-H** additive only (ADR-046 P31 #4): 메뉴 / 단축키 변경 0. Settings
  토글 + 다이얼로그 modal 만.

### 2.2 Stack

```
사용자 op (Boolean / Push-Pull / Offset / Split / Merge / etc.)
  ↓ TransactionManager.commit() 직전
Mesh::detect_topology_damage(&self) -> TopologyDamageReport
  ↓ damage detected (사건 2/3/4 분류)
Mesh::attempt_auto_recovery(&mut self) -> RecoveryOutcome
  ├─ Success: silent (transaction commit 정상 진행)
  └─ Failure:
       ↓ TopologyRecoveryDialog.show(reason, [Undo, Demote, Manual])
사용자 선택:
  ├─ [Undo] → bridge.undo() (TransactionManager rollback)
  ├─ [강등] → bridge.demoteXiaToShape (Form 복귀)
  └─ [수동수정] → dismiss + Toast.warning(reason)
```

### 2.3 Decision Matrix (T-A ~ T-H 위 §2.1)

## 3. Path Z atomic decomposition (6 sub-step)

| # | sub-step | 영역 | 회귀 |
|---|---|---|---|
| 1 | **T-α** spec | 본 ADR | 0 |
| 2 | **T-β** Detection | `Mesh::detect_topology_damage` + `TopologyDamageReport` enum (BoundaryEdge / NonManifold / Degenerate / Orphan) | axia-geo +5~8 |
| 3 | **T-γ** Recovery dispatcher | `Mesh::attempt_auto_recovery` + 3 사건 별 dispatch + atomic fixed-point + transaction wrap (T-F) | axia-geo +6~10, axia-core +3 |
| 4 | **T-δ** UI 다이얼로그 + helper | `web/src/citizenship/TopologyRecoveryDialog.ts` ([Undo]/[강등]/[수동수정] 3 옵션, ADR-091 §E L4 답습) | vitest +8~12 |
| 5 | **T-ε** Settings + main.ts wiring | `AutoTopologyRecoverySettings.ts` (Default ON, ADR-094/096 답습) + main.ts init | vitest +5 |
| 6 | **T-ζ** Real Chromium 시연 + closure | 3 사건 별 시연 + Lessons | Playwright +3~4 |

**누적 추정**: axia-geo +11~18, axia-core +3, vitest +13~17, Playwright
+3~4 = **+30~42**.
**일수**: **9-14일 (1.5-2.5주)**.

## 4. ADR-046 P31 정합

- #1 (P1+P3 가치): ✅ — 두 페르소나 직접:
  - **P1 (건축/디자인)**: Boolean / Push-Pull 후 모델 자동 복구 →
    "ops 후 깨진 모델" UX 차단
  - **P3 (AI 협업자)**: AI agent 의 ops 후 자동 invariant 통과 보장
    → AI workflow 안정성
- #2 (외부 참조는 형태/모양만): ✅ — Reference 시민권 (ADR-095) 의
  ops 시 동일 invariant 보호
- 메타-원칙 #4 (SSOT): ✅ — Detection 의 SSOT (verify_face_invariants
  + verify_p7_manifold)
- 메타-원칙 #6 (Preventive over Curative): ✅ — 자동 복구가 사용자
  facing 손상 *예방*
- 메타-원칙 #7 (Topology > Cache): ✅ — Detection 이 topology layer
- #4 additive only: ✅ — 메뉴 변경 0, Settings + 다이얼로그만 추가

## 5. 위험 매트릭스

| 위험 | 평가 | 완화 |
|---|---|---|
| **LOCKED #1 P7 / #12 P11 회귀** | 매우 높음 | additive prep (T-β/γ 가 기존 ops coexist, T-ε flip 시 활성). 기존 자산 호출만 — 알고리즘 변경 0 |
| **Recovery 잘못 fix 시 사용자 손실** | 중 | T-F: transaction wrap + rollback. atomic invariant 보장 |
| **다이얼로그 UX** | 중 | ADR-091 Toast + 버튼 패턴 답습. 한국어 wording 명시 (humanize 함수) |
| **multi-week 컨텍스트 손실** | 중 | sub-step 별 사용자 multi-gate (Path Z atomic) |
| **자동 복구 over-application** | 낮 | T-E: Default ON via Settings + localStorage OFF preference |
| **사건 분류 ambiguity** | 중 | T-β 의 enum exhaustive — `TopologyDamageKind { BoundaryEdge, NonManifold, Degenerate, Orphan }` |
| **Performance overhead** | 중 | Detection 은 매 op 마다 실행 — verify_face_invariants 비용 측정 + 필요 시 dirty-scope optimization (별도 sub-step) |

## 6. Out of Scope

- **새 invariant 정의** — 본 ADR 은 *기존 invariant 의 centralized
  활용*. 새 invariant 도입 시 별도 ADR (예: ADR-098 — Self-Intersection
  Detection)
- **Recovery 알고리즘 새 발명** — 5개월 누적 자산 충분. 새 alg 도입
  시 별도 ADR
- **사건 1 (재질 제거)** — Phase 2 / ADR-091 이미 closure. 다이얼로그
  의 [강등] 옵션이 ADR-091 demote API 답습
- **Boolean SSI 의 새 trim curve recovery** — ADR-064/066 D-H safe-only
  정책 보존. Phase 4 가 SSI 자체를 변경 안 함
- **Performance optimization** — Detection 매 op 시 cost 가 클 시 별도
  optimization sub-step 또는 ADR
- **사용자 명시 "검사" 버튼** — Inspector UI 통합은 future sub-step

## 7. Lessons applied (5개월 누적, 가장 깊은 적용 — 4번째 multi-week atomic)

| ADR | Lesson | Phase 4 적용 |
|---|---|---|
| ADR-091 §E L2 | 사전 검토 가치 | **본 사전 검토** — 사건 분류 + 자산 inventory + recovery enumeration |
| ADR-091 §E L4 | UI orchestration 분리 | T-δ TopologyRecoveryDialog helper SSOT |
| ADR-094 §E L1 | Additive-first 위험 격리 | T-β/γ/δ/ε prep 별 coexist |
| ADR-094 §E L4 | Engine OFF + Production ON | T-E Default ON via Settings |
| ADR-095 §E L3 | 사용자 facing 한국어 변환 | T-δ 다이얼로그 한국어 wording (humanizeRecoveryFailure) |
| ADR-096 §E L4 | Default ON 패턴 누적 | T-E `axia:auto-topology-recovery` (5번째 ADR 누적) |

## 8. 사용자 multi-gate (각 sub-step 결재)

본 ADR 은 plan only. 각 sub-step 진입 시 사용자 결재 + Path Z atomic.
**T-α (본 ADR) → T-β → T-γ → T-δ → T-ε → T-ζ** 순차.

## 9. LOCKED #26 progress 갱신

| Phase | 상태 |
|---|---|
| Phase 1 | ✅ ADR-050 (2026-05-06) |
| Phase 2 | ✅ ADR-091 (2026-05-09) |
| Phase 3 | ✅ ADR-095 (2026-05-09) |
| Phase 3 retro-migration | ✅ ADR-096 (2026-05-09) |
| **Phase 4** | **Proposed (본 ADR T-α — 진행 시작)** |
| Phase 5 | 미진행 (자산 라이브러리 + Layered material) |

## D. Acceptance Log

### T-α (본 commit)
- **사용자 결재**: 2026-05-09, "🅴 Phase 4 직진 ... 사전검토 → 승인합니다"
  — 사전 검토 + T-α 진입 승인.
- **변경**: 본 ADR 작성. LOCKED #26 Phase 4 progress 갱신 anchor.
- **회귀**: +0 (docs only).

### T-β ~ T-ζ (예정)
별도 sub-step 결재 시 commit 진행.
