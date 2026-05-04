# ADR-063 — ADR-046 Phase 1 Path Z: Capability Explorer Pilot

**Status**: Draft (Path Z 사용자 결정 2026-05-04, Step 1 sign-off 대기)
**Date**: 2026-05-04
**Anchor**: ADR-046 P31 (Product Identity Lock) + Phase 1 4-PR roadmap
**Parent**: ADR-046 §Phase 1 (PR-3 = Capability Explorer)
**Prerequisites**: ADR-045 D1 ActionCatalog SSOT (82 actions seeded),
ADR-062 Phase L₂ Path Z 완료 (917 → 923 axia-geo + 8 axia-wasm)
**Related**: ADR-041 (MCP Capability Surface), ADR-045 (UI Surface
Consolidation + ActionCatalog SSOT)
**Future Queue (commitment)**: ADR-067 Step 1 — Auto-merge after
push_pull commit (Press-Pull Engine 의 첫 piece, 본 ADR 완료 후 자동
진입)

---

## 0. Summary (4 lines)

> ADR-046 Phase 1 풀 scope (4-PR, 8-12주) 대신 Path Z 좁은 pilot —
> Capability Explorer 단일 패널만. Debug Panel / i18n / Tier 3 Danger
> Zone / catalog 379-dispatch 마이그레이션 모두 별도. ActionCatalog
> 의 82 actions 를 사용자/AI 가 처음으로 시각적으로 발견 가능.
> 5-step / 5 회귀 / 2-3주.

---

## 1. Context — Path Z 채택 이유

### 1.1 Phase 1 풀 scope 위험 측정

ADR-046 Phase 1 사전 검토 발견:
- **ActionCatalog 가 dead code** — `packages/axia-action-catalog/`
  967 lines + 82 actions 존재, but `web/src/` 0 imports
- **379 dispatch case** 분산 — 단일 SSOT 없음
- **Capability Explorer / Debug Panel** 0 (미구현)
- 풀 scope 시 catalog 마이그레이션 비용 매우 큼 (메타-원칙 #1 위반 위험)

### 1.2 사용자 패턴 일관 (Path Z 선호)

| 이전 ADR | 사용자 선택 | 패턴 |
|---------|-----------|------|
| ADR-061 Phase P | Path Z (narrow) | Pilot |
| ADR-062 Phase L₂ | Path Z (Validated Attach) | Pilot |
| **ADR-063** | **Path Z (Capability Explorer)** | Pilot 일관 |

### 1.3 Path Z 가 풀 사용자 pain

**P1 (건축/디자인)**: 어떤 도구가 있는지 발견 어려움 (tools menu / context menu / shortcut 분산). Capability Explorer = 단일 발견 surface.

**P3 (AI agent)**: MCP capability list 와 동일한 actions 를 사람도 볼 수 있음 — AI ↔ 사람 surface 일치.

---

## 2. Decision — Path Z scope + 7개 D 결정 + 6 영구 Lock-in

### 2.1 §A — Path Z scope (Path Y/X 와 명확 구분)

**채택 (Path Z, 본 ADR)**:
- Capability Explorer 단일 panel
- ActionCatalog 의 82 actions 시각화
- Tier 0 inline form (read-only call) + Tier 1/2 launcher
- Tier 3 기본 hidden
- ActionCatalog import = Capability Explorer **만**

**제외 (Path Y, 별도 ADR)**:
- Debug Panel (audit log viewer + invariant verifier)
- ADR-046 PR-2.5 catalog 379-dispatch 마이그레이션
- i18n 한국어/영어
- Schema-driven Tier 0 form

**제외 (Path X, 영구)**:
- 풀 Phase 1 동시 진입 (위험 매우 고)

### 2.2 §B — Capability Explorer 컴포넌트 명세

```
web/src/ui/CapabilityExplorerPanel.ts (신규)
  - Sidebar 탭 또는 툴 윈도우
  - ActionCatalog import (단일 import 사이트)
  - Tier 별 그룹 표시:
      Tier 0 (read, 7 actions)        — 인라인 form
      Tier 1 (constructive, 10)       — 도구 launcher
      Tier 2 (modificative, 10)       — 도구 launcher + 경고 표시
      Tier 3 (destructive, 5)         — 기본 숨김 (Toggle)
  - 검색 필터 (id / label / description)
  - Action 클릭 → tooltip + ADR refs 표시
```

### 2.3 §C — 7개 D 결정 (확정)

| D | 결정 | 비고 |
|---|------|------|
| **D1** | 패널 위치 = Sidebar | 기존 ComponentPanel / XiaInspector 패턴 일관 |
| **D2** | Tier 0 form = 수동 MVP | Schema-driven (Zod 등) 별도 ADR |
| **D3** | i18n = 한국어만 (pilot) | KR+EN 별도 ADR (Phase 2) |
| **D4** | 82 actions 모두 표시 | 부분집합 필터링은 사용자 검색 UX 로 |
| **D5** | Catalog activation = Capability Explorer **만** | 379-dispatch 무변경 |
| **D6** | Tier 3 = 기본 숨김 + Toggle | "Show advanced" 체크박스 |
| **D7** | 회귀 5개 (절대 #[ignore] 금지) | §X.5 lock-in #6 strict |

### 2.4 §D — 6 영구 Lock-in (Path Z 한정)

```
1. Capability Explorer = 단일 ActionCatalog 사용 사이트.
   379 기존 dispatch 들은 절대 catalog 경유 강제 안 함 (Path Y 별도).

2. Tier 3 기본 숨김.
   "Show advanced" toggle 명시 + localStorage 저장.

3. Read-only browser MVP — Action 실행 결과는 명시적이고 reversible.
   Tier 2/3 실행 시 사용자 확정 dialog.

4. ActionCatalog 의 82 actions 외 추가 등록 본 ADR scope 외.
   Phase O Step 6 / Phase P-narrow / Path Z 의 신규 endpoints 동기화는
   Step 1 단일 작업.

5. ADR-046 §X (PR-2.5 catalog 마이그레이션) 본 ADR 무관.
   별도 ADR 명시 사인-오프 후 진행.

6. UI 변경 = additive only.
   기존 Sidebar / Toolbar / MenuBar / KeyboardShortcuts 변경 0.
   Capability Explorer 는 신규 패널로만 진입.
```

---

## 3. Acceptance — 5-step + 5 회귀 (사용자 사인-오프 후)

### 3.1 Step 분해 (예상 2-3주)

| Step | 영역 | 회귀 | 위험 |
|------|------|------|------|
| 1 | ActionCatalog 신규 actions 동기화 (Phase O Step 6 + Phase P-narrow + Path Z 의 endpoints) | 1 | 저 |
| 2 | `CapabilityExplorerPanel.ts` scaffold + Sidebar 등록 | 1 | 저 |
| 3 | 82 actions tree view + Tier 그룹 + 검색 필터 | 1 | 저 |
| 4 | Tier 0 인라인 form (read-only) + Tier 1/2 launcher | 1 | 중 |
| 5 | Tier 3 기본 숨김 + Show advanced toggle + 종합 | 1 | 저 |
| **합계** | — | **5** | — |

### 3.2 5 회귀 invariants (절대 #[ignore] 금지)

1. **`capability_explorer_panel_renders_82_actions`** — 모든 catalog 액션이 표시됨
2. **`capability_explorer_imports_only_capability_explorer_panel`** — catalog import 가 단일 사이트 (lock-in #1 강제)
3. **`capability_explorer_tier3_hidden_by_default`** — 기본 상태에서 Tier 3 숨김 (lock-in #2)
4. **`capability_explorer_search_filter_works`** — 검색어 → 필터링 동작
5. **`capability_explorer_tier0_form_executes_action`** — 인라인 form 클릭 → bridge 호출 → 결과 표시

### 3.3 위험 매트릭스

| 위험 | 대책 |
|------|------|
| R1 catalog ↔ 379 mismatch (이전 검토) | lock-in #1 — 본 ADR scope 외, 별도 ADR |
| R2 muscle memory 파괴 | N/A — Capability Explorer 는 신규 패널, 기존 shortcut 변경 0 |
| R3 catalog 신규 actions (Phase O+P+L₂) 누락 | Step 1 동기화 |
| R4 TS 1156 회귀 | 단일 패널 추가 → 회귀 영향 격리 |
| R5 Tier 0 form 복잡도 | 수동 MVP |
| R6 i18n / Debug Panel 누락 사용자 혼란 | Path Y 별도 ADR 명시 |
| R7 Tier 3 사용자 실수 | lock-in #2 + 확정 dialog (Step 4) |

---

## 4. Future Queue Commitment (Option 2 lock-in)

### 4.1 ADR-067 Step 1 큐 commitment

**약속 내용**:
- 본 ADR-063 (Phase 1 Path Z) 5/5 step 완료 후
- **ADR-067 Step 1 — Auto-merge after push_pull commit** 자동 진입
- 사용자 추가 사인-오프 없이 큐 진행 (단, Step 1 완료 후 Step 2 진입은 별도 사인-오프)

**ADR-067 Step 1 명세**:
- 작업: `Mesh::push_pull` commit 후 인접 coplanar face 자동 merge
- 코드 재사용: `boolean.rs::merge_coplanar_result_faces` 그대로
- §A drop-in alongside (기존 push_pull 변경 0)
- 회귀: 3-5 tests
- ADR-064 (NURBS Boolean robust) 미의존
- 기간: 2-3주

**ADR-067 Step 2-5 별도**:
- Step 2 Collision Detection
- Step 3 State Machine
- Step 4 Add/Subtract Commit Pipeline (ADR-064 의존)
- Step 5 UI Mode Display
- 각 별도 사인-오프 강제

### 4.2 Roadmap 합산

```
[현재] ADR-063 Phase 1 Path Z         — 2-3주
[큐]   ADR-067 Step 1 Auto-merge      — 2-3주
       └ 합산 4-6주

[미커밋] ADR-067 Steps 2-5            — 별도 사인-오프 후
[미커밋] ADR-064 NURBS Boolean robust  — 별도 사인-오프 후
[미커밋] ADR-046 Phase 1 Path Y 잔여   — 별도 사인-오프 후
```

---

## 5. References

- ADR-046 P31 (Product Identity + Phase 1 4-PR roadmap)
- ADR-045 D1 (ActionCatalog SSOT, 82 actions seeded)
- ADR-041 P26.1 (MCP Capability Surface, Tier 분류 정합)
- ADR-062 (Phase L₂ Path Z — Path Z 패턴 일관)
- 사용자 사전 검토 + Path Z 채택 + Option 2 (Step 1 큐) 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Draft — Step 1 sign-off 대기
*Queue commitment*: ADR-067 Step 1 (Auto-merge after push_pull) — 본
ADR 5/5 step 완료 후 자동 진입
