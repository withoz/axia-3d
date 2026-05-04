# ADR-069 — ADR-046 Phase 1 Path Y: Audit Log Viewer Pilot

**Status**: Draft (Path Z 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-046 P31 Phase 1 PR-4 (Debug Panel) §D5 sub-feature A
**Parent**: ADR-046 §Phase 1 PR-4
**Prerequisites**: ADR-041 P26.7 (MCP audit policy), ADR-063 (Capability
Explorer 완료), ADR-068 (Invariant Verifier 완료)
**Related**: ADR-045 D1 (ActionCatalog SSOT)

---

## 0. Summary (4 lines)

> ADR-046 PR-4 sub-feature A. Web-side action audit (localStorage) +
> 단순 viewer panel — Capability Explorer + ToolManager 의 invocations
> 추적. ADR-041 P26.7 schema subset 정합 + privacy filter 기본값 ON.
> 사용자 6번째 Path Z (소형 pilot 일관). 5-step / 6 회귀 / 2-3주.

---

## 1. Context — Path Z 채택 이유

### 1.1 사용자 선택 패턴 (6번째 Path Z)

| ADR | 사용자 선택 |
|-----|-----------|
| ADR-061/062/063/067(Step 1)/068 | Path Z |
| **ADR-069** | **Path Z (Web-side capture + 단순 viewer)** |

### 1.2 ADR-069 가 풀 사용자 pain

**P3 (AI agent)**: AI 가 어떤 액션을 호출했는지 가시화 — debug 즉각 가속
**개발자**: Tier 2/3 action 실수 감지 + denied 추적

### 1.3 ADR-041 P26.7 와의 분리

P26.7 = **server-side (Node)** audit.
ADR-069 = **web-side** audit (별도 channel, schema subset 정합).
미래 통합 시 P26.7 schema 호환 — request_id / engine_version /
schema_version / result 필드 동일.

---

## 2. Decision — Path Z scope + 7개 D + 5 영구 Lock-in

### 2.1 §A — Path Z scope

**채택**:
- Web-side action audit (localStorage)
- Capability Explorer onActionInvoke + ToolManager.executeAction capture
- 단순 list viewer panel (filter 없음)
- ADR-041 P26.7 schema subset

**제외 (별도 ADR)**:
- WASM-side audit channel (ADR-070+)
- MCP server log fetch (HTTP integration)
- 고급 filter / search / pagination
- 다른 sub-features (Analytic Hover Overlay = ADR-070, Tier 3 Danger Zone)

### 2.2 §B — Schema (P26.7 subset)

```typescript
interface AuditEntry {
  timestamp: number;          // Date.now()
  requestId: string;          // UUID v4
  actionId: string;           // ActionDef.id (kebab)
  tier: 0 | 1 | 2 | 3;
  result: 'ok' | 'error' | 'denied';
  error?: string;             // when result='error'
  args?: Record<string, unknown>;  // privacy-masked by default (D-G)
  schemaVersion: 1;           // future-proof
}
```

### 2.3 §C — 7개 D 결정 (확정)

| D | 결정 | 비고 |
|---|------|------|
| **D-A** | Web-side capture (browser only) | MCP server log = 별도 channel |
| **D-B** | localStorage 저장소 | 5MB cap 인지 + FIFO |
| **D-C** | Capture = Capability Explorer + ToolManager.executeAction | UI-driven action 모두 |
| **D-D** | P26.7 schema **subset** | request_id + engine_version + schema_version + result |
| **D-E** | FIFO eviction at 1000 entries | byte-cap 대안 미채택 (단순) |
| **D-F** | 별도 panel (DraggablePanel) | Capability Explorer extension 미채택 |
| **D-G** | Privacy filter 기본값 ON (Tier 1+ args mask) | 민감 정보 차단 |

### 2.4 §D — 5 영구 Lock-in

```
1. Web-side audit only — MCP server log 통합 별도 ADR.
   localStorage 'axia.auditLog' key 영구 유지. 변경 시 schema bump.

2. P26.7 정책 일관 — Tier 0/1 success 미기록 (flooding 방지).
   기록 대상: Tier 2/3 success/error + any-tier denied/error.

3. Privacy filter 기본값 ON — Tier 1+ args 자동 mask.
   사용자 명시 toggle 로 unmask 가능 (Step 5+).

4. FIFO eviction 1000 entries — byte-cap 미적용.
   엔트리 평균 ~500B → 500KB ~ 1MB 사용. localStorage 5MB 안전.

5. Audit log = volatile derived data — Scene snapshot 미포함.
   Phase P-narrow #[serde(skip)] 패턴 일관 (web 측 별도 storage).
```

---

## 3. Acceptance — 5-step + 6 회귀

### 3.1 Step 분해 (예상 2-3주)

| Step | 영역 | 회귀 | 위험 |
|------|------|------|------|
| 1 | `core/AuditLog.ts` core (capture / FIFO / privacy mask) | 2 | 저 |
| 2 | `main.ts` Capability Explorer + ToolManager integration | 1 | 저 |
| 3 | `AuditLogViewerPanel.ts` scaffold + list rendering | 1 | 저 |
| 4 | Tier 분류 색상 + result badge + timestamp 표시 | 1 | 저 |
| 5 | 메뉴 항목 + 종합 + privacy mask toggle | 1 | 저 |
| **합계** | — | **6** | — |

### 3.2 6 회귀 invariants (절대 #[ignore] 금지)

1. `audit_log_captures_capability_explorer_invocations` — Tier 2 action invoke → entry 1 추가
2. `audit_log_evicts_fifo_when_cap_reached` — 1001 entries push → first dropped
3. `audit_log_viewer_panel_renders_entries` — N entries push → N rows
4. `audit_log_skips_tier0_success_per_p26_7` — Tier 0 success 기록 0 (flooding 방지)
5. `audit_log_isolated_from_scene_serializer` — Scene save/load 가 audit 무관
6. `audit_log_arg_masking_enabled_by_default` — Tier 1+ args 기본 mask

---

## 4. References

- ADR-041 P26.7 (MCP audit trail policy — server-side)
- ADR-046 P31 Phase 1 PR-4 §D5 sub-feature A
- ADR-063 (Capability Explorer onActionInvoke 콜백)
- ADR-068 (Invariant Verifier — Path Z 5번째 일관 패턴)
- 사용자 사전 검토 + Path Z 채택 (6번째) 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: Draft — Step 1 sign-off 대기 시 implementation 즉시 진행
