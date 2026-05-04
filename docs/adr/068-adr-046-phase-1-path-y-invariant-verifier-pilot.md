# ADR-068 — ADR-046 Phase 1 Path Y: Invariant Verifier Pilot

**Status**: Draft (Path Z 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-046 P31 Phase 1 PR-4 (Debug Panel) §D5 sub-feature B
**Parent**: ADR-046 §Phase 1 PR-4
**Prerequisites**: ADR-007 (verify_invariants), ADR-063 (Capability
Explorer 완료)
**Related**: ADR-045 D1, ADR-046 P31, ADR-063 (Path Z 패턴)

---

## 0. Summary (4 lines)

> ADR-046 PR-4 Debug Panel 풀 scope (4 sub-features, 4-6주) 대신 Path
> Z 좁은 pilot — Invariant Verifier 단일 sub-feature 만. Audit log /
> Analytic hover overlay / Tier 3 Danger Zone 모두 별도 ADR. WASM
> verifyInvariants (ADR-007) 재사용 — UI layer 만 신규. 5-step / 5
> 회귀 / 2-3주.

---

## 1. Context — Path Z 채택 이유

### 1.1 사용자 선택 패턴 (5번째 Path Z)

| 이전 ADR | 사용자 선택 |
|---------|-----------|
| ADR-061 Phase P | Path Z |
| ADR-062 Phase L₂ | Path Z |
| ADR-063 Phase 1 PR-3 | Path Z |
| ADR-067 (Step 1 큐) | Path Z 패턴 (Step 1 만 자동 진입) |
| **ADR-068 Phase 1 PR-4** | **Path Z (Invariant Verifier 만)** |

### 1.2 PR-4 4 sub-features ROI 분석

| Sub-feature | 가치 | 위험 | 작업량 |
|-------------|------|------|-------|
| **B Invariant Verifier** | **고** (디버깅 즉각) | **저** | 2-3주 |
| A Audit Log Viewer | 중 (P3 AI debug) | 중 (channel 결정) | 2주 |
| C Analytic Hover Overlay | 중 (ADR-038 검증) | 중 (Viewport 통합) | 2주 |
| D Tier 3 Danger Zone | 저 (Capability Explorer 중복) | 저 | 0.5주 |

**B 가 가장 즉각적**: WASM `verifyInvariants` 이미 존재 (ADR-007), UI 만 신규.

### 1.3 사용자 pain (B sub-feature)

**P1 (디자이너)**: "내 mesh 가 valid 한가?" 즉시 답할 수 없음
**P3 (AI)**: AI 가 자동 mesh 검사 시 채널 부재 — Capability Explorer 의 invariant verifier endpoint 필요
**개발자**: ADR-007 위반 발견 시 silent → 디버깅 사이클 길어짐

---

## 2. Decision — Z scope + 7개 D + 4 영구 Lock-in

### 2.1 §A — Path Z scope

**채택 (B sub-feature 만)**:
- Invariant Verifier 단일 sub-feature
- WASM `verifyInvariants` 재사용 (ADR-007, 신규 코드 0)
- UI: "Run Verify" 버튼 + 위반 list + jump-to-id (FaceId)

**제외 (별도 ADR)**:
- A Audit Log Viewer
- C Analytic Hover Overlay
- D Tier 3 Danger Zone (Capability Explorer 의 toggle 와 중복 검토)
- PR-2.5 catalog 379-dispatch 마이그레이션 (영구 별도)

### 2.2 §B — 컴포넌트 명세

```
web/src/ui/InvariantVerifierPanel.ts (신규)
  - "Run Verify" 버튼
  - 결과 표시:
      * Empty (clean): "✓ All N faces pass" (green)
      * Violations: red list with FaceId + violation kind
  - 각 violation row → "Jump" 버튼: FaceId 선택 + viewport 카메라 이동
  - 마지막 검증 timestamp 표시
  - 진행 indicator (1000+ face 시 측정)
```

### 2.3 §C — 7개 D 결정

| D | 결정 | 비고 |
|---|------|------|
| **D1** | Path Z (Invariant Verifier 만) | Path Y/X 별도 |
| **D2** | WASM `verifyInvariants` 재사용 | 신규 backend 0 |
| **D3** | UI 형태 = DraggablePanel (HistoryPanel mirror) | ADR-063 Step 2 패턴 |
| **D4** | 활성화 = 메뉴 항목만 | ADR-063 Step 2 일관 (단축키 없음) |
| **D5** | 결과 표시 = 인라인 list + jump-to-id | (Toast 보다 정확) |
| **D6** | Capability Explorer 통합 | 기존 panel 옆에 별도 panel |
| **D7** | 회귀 5개 strict (절대 #[ignore] 금지) | §X.5 lock-in #6 |

### 2.4 §D — 4 영구 Lock-in

```
1. WASM verifyInvariants 재사용 — 백엔드 신규 코드 0.
   ADR-007 invariant 정의가 SSOT. UI 는 결과만 표시.

2. Path Z scope — A/C/D sub-feature 본 ADR 외.
   각각 별도 ADR (ADR-069/070/071) 별도 사인-오프 강제.

3. UI additive only — 기존 panel / shortcut / menu 변경 0.
   ADR-046 §D6 일관.

4. Jump-to-id 기능 — FaceId 선택만, viewport 카메라 자동 이동은
   별도 (Phase 2 enhancement). 본 pilot 은 selection 변경까지.
```

---

## 3. Acceptance — 5-step + 5 회귀

### 3.1 Step 분해 (예상 2-3주)

| Step | 영역 | 회귀 | 위험 |
|------|------|------|------|
| 1 | `InvariantVerifierPanel.ts` scaffold + WasmBridge 통합 | 1 | 저 |
| 2 | "Run Verify" 버튼 + 결과 list 렌더 | 1 | 저 |
| 3 | Empty (clean) vs Violations 분기 표시 | 1 | 저 |
| 4 | Jump-to-id (FaceId selection) 통합 | 1 | 중 |
| 5 | main.ts 등록 + 메뉴 항목 + 종합 | 1 | 저 |
| **합계** | — | **5** | — |

### 3.2 5 회귀 invariants (절대 #[ignore] 금지)

1. `invariant_verifier_panel_renders_run_button` — "Run Verify" 버튼 존재
2. `invariant_verifier_clean_mesh_shows_pass` — 위반 0 → 녹색 "✓ All N faces pass"
3. `invariant_verifier_violations_display_face_ids` — 각 violation row 에 FaceId 명시
4. `invariant_verifier_jump_button_changes_selection` — Jump → FaceId selection 변경
5. `invariant_verifier_panel_imports_only_invariant_verifier` — 신규 패널이 단일 import 사이트

### 3.3 위험 매트릭스

| 위험 | 대책 |
|------|------|
| R1 1000+ face mesh verify latency 16ms 초과 | 명시 "Run" 버튼 (자동 미실행) |
| R2 violations[] 형식 string array — parsing 모호 | string split + face id regex extraction |
| R3 Jump-to-id viewport 통합 복잡도 | Step 4 만 selection 변경 (camera 이동은 별도) |
| R4 ADR-046 P31 P3 (AI agent) 가치 — Capability Explorer 와 중복 | Capability Explorer 가 verify-invariants action 도 노출 (ADR-063 §D #1 단일 import) |
| R5 사용자 perceived 가치 작음 (dev/power-user) | 메뉴 위치 = "보기 → Debug → 검증" 명시 |

---

## 4. References

- ADR-007 (verify_invariants 정의)
- ADR-046 P31 Phase 1 PR-4 (§D5 4 sub-features)
- ADR-063 (Path Z 패턴 + Capability Explorer)
- 사용자 사전 검토 + Path Z 채택 (5번째 Path Z) 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Draft — Step 1 sign-off 대기
