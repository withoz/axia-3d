# ADR-042: MCP Capability Policy — ALLOW / DENY Refinement

**Status**: **Accepted** (2026-05-02) — LOCKED 정책 #20
**Initiative**: AxiA MCP Surface 운영 정밀도 (ADR-041 follow-up)
**Builds on**: ADR-041 P26.1 (4-tier Capability Surface), P26.7 (Audit Trail)

## Context

ADR-041 P26.1 는 4-tier whitelist (`AXIA_MCP_TIERS=0,1,2`) 로 capability
를 제어. 운영 시 **거친 단위 한계** 발생:

### 사례 1 — Tier 2 의 일부만 빼고 싶다
사용자: "Tier 2 modificative 는 거의 다 OK 인데 `boolean_*` 3 종은
실수 위험이 커서 빼고 싶다."

현재 방법: Tier 2 자체를 끄거나 (다른 9 capability 도 잃음), 다 켜거나
(boolean_* 도 허용). all-or-nothing.

### 사례 2 — Tier 외 capability 한 개만 추가
사용자: "Tier 0+1 default 로 두고 `push_pull` (Tier 2) 만 추가 허용."

현재 방법: Tier 2 전체를 켜야 함 — 9 개 추가 capability 도 같이 노출.

### 사례 3 — Tier 3 의 한 capability 만 위험
사용자: "Tier 3 destructive 는 모두 막되 `import_step` 만 허용."

현재 방법: Tier 3 전체를 켜야 함.

### 산업 표준

POSIX `capabilities(7)` / AWS IAM 의 정책 모델:
- Coarse policy (group / tier) → fine override (allow / deny)
- **Deny 가 항상 allow 를 이긴다** (fail-closed)
- "Implicit deny" — allowlist 가 비어있지 않으면 그 외는 자동 deny

### 위험 — naive 추가의 함정

`AXIA_MCP_ALLOW_CAPS=draw_rect,...` 만 추가하면:
- 🔴 **의미 모호**: Tier 와 ALLOW 의 관계 — union? intersection? override?
- 🔴 **typo 사일런트**: 사용자가 `draw_recttt` 오타 시 무음 deny → 디버깅 지옥
- 🔴 **회귀 차단 부재**: capability 추가/제거 시 사용자 환경변수 stale

## Decision

### P27 — 새 원칙: Capability Policy Composition

> **MCP capability 의 활성 여부 = (Tier 활성) ∧ (DENY 미포함) ∧
> (ALLOW 비어있음 OR ALLOW 포함). DENY 가 항상 우선. 알려지지 않은
> capability 이름은 startup 에서 즉시 fatal — silent deny 금지.**

### P27 세부 규칙 (6 항목)

**P27.1 — Composition rule (additive ALLOW, subtractive DENY, fail-closed)**

```
final_enabled(cap) =
    (cap ∉ deny_caps)                                      ← fail-closed
    AND (tier_of(cap) ∈ enabled_tiers  OR  cap ∈ allow_caps)
```

진리표:

| Tier 활성 | DENY | ALLOW | 결과 | 의미 |
|---|---|---|---|---|
| ✓ | — | ∅ | **활성** | default 경로 (P26.1 그대로) |
| ✓ | — | 포함 | **활성** | redundant 하지만 OK |
| ✓ | — | 비포함 (allow ≠ ∅) | **활성** | ALLOW 는 tier 의 surface 를 줄이지 않음 |
| ✓ | ✓ | — | **비활성** | DENY 가 tier 차감 |
| — | — | 포함 | **활성** | ALLOW promotes — Tier 외 cap 추가 |
| — | — | 비포함 | **비활성** | tier 도 ALLOW 도 없음 |
| — | ✓ | 포함 | **비활성** | DENY wins (fail-closed) |

**핵심 (additive)**:
- ALLOW = "tier 이 막아도 이 cap 은 통과시켜라" (선택적 추가)
- DENY = "tier 이 통과시켜도 이 cap 은 거부해라" (선택적 제거)
- DENY 가 항상 우선 (fail-closed)
- "exhaustive whitelist" 가 필요하면 `TIERS=""` (빈) + `ALLOW=cap1,cap2,...`

**Why additive?** "Tier 0+1 + push_pull" 만 원할 때 사용자가 Tier 1 의
모든 capability 를 ALLOW 에 enumerate 하지 않아도 됨. UX 친화적. AWS IAM
의 정책 evaluation 과 동일 (Allow 는 추가, Deny 는 항상 우선).

**P27.2 — 환경변수 / config 표면**

```bash
# 기존 (ADR-041 P26.1)
AXIA_MCP_TIERS="0,1"          # tier-level whitelist

# 새로 추가 (ADR-042 P27)
AXIA_MCP_ALLOW_CAPS=""        # 빈 = "tier 만으로 결정" (default)
                              # 비어있지 않으면 implicit-deny 작동
AXIA_MCP_DENY_CAPS=""         # 비어있으면 deny 무시
```

`axia.config.json` 도 동일 의미:
```json
{
  "mcp": {
    "enabled_tiers": [0, 1],
    "allow_caps": [],
    "deny_caps": ["boolean_subtract"]
  }
}
```

**P27.3 — Unknown capability = fatal at startup**

사용자가 환경변수 / config 에 알려지지 않은 capability 를 적으면:
```
[axia-mcp-server] FATAL: Unknown capability "draw_recttt" in
  AXIA_MCP_ALLOW_CAPS. Did you mean "draw_rect"?
  Valid capabilities: draw_rect, draw_circle, draw_line, ...
```

**즉시 process 종료** (silent deny 절대 금지). Edit-distance 1 매칭으로
"Did you mean" 힌트 제공.

회귀 방지: capability rename 시 사용자 config 가 깨짐을 즉시 알림.

**P27.4 — `enabled_tiers` 는 tier discovery 용**

ALLOW/DENY 가 강력해지면서, `enabled_tiers` 는 두 역할:
1. 기본값 활성 그룹 (ALLOW 비어있을 때)
2. **`tools/list` 에 표시할 capability 그룹** — UI / discoverability

`enabled_tiers` 가 [0, 1] 인데 ALLOW 에 `push_pull` (Tier 2) 가 있으면,
`tools/list` 에는 `push_pull` 도 표시 (실제 활성이므로).

→ "tools/list 표시 = 실제 활성" 불변식 유지.

**P27.5 — Audit log 정책 정합 (P26.7 확장)**

P27 정책으로 거부된 호출은 ADR-041 P26.7 의 `denied` audit 에 기록.
`reason` 필드:
- `"Capability denied by ALLOW policy: not in [draw_rect, export_axia]"`
- `"Capability denied by DENY policy"`
- `"Tier 2 not enabled and not in ALLOW list"`

세 reason 을 분리 → audit log 분석 시 정책 레이어 즉시 식별.

**P27.6 — 회귀 테스트 (절대 #[ignore] 금지)**

| # | 테스트 | 검증 |
|---|---|---|
| 1 | `policy_default_tier_only_unchanged` | ALLOW=∅, DENY=∅ → ADR-041 동작과 동일 (회귀 없음) |
| 2 | `policy_deny_overrides_tier` | Tier 2 enabled + DENY=[boolean_subtract] → boolean_subtract 만 거부 |
| 3 | `policy_allow_promotes_capability_above_tier` | Tiers=[0,1] + ALLOW=[push_pull] → push_pull 활성 |
| 4 | `policy_exhaustive_whitelist_via_empty_tiers` | TIERS=∅ + ALLOW=[draw_rect] → draw_rect 만 활성, draw_circle 거부 |
| 5 | `policy_deny_wins_over_allow` | ALLOW=[push_pull] + DENY=[push_pull] → 거부 |
| 6 | `policy_unknown_capability_fatal_with_hint` | env 에 typo → fatal + "Did you mean" 힌트 |
| 7 | `policy_audit_reason_distinguishes_layer` | 3 reason 분리 검증 |
| 8 | `policy_tools_list_reflects_actual_enablement` | tools/list 가 ALLOW 효과 반영 |

## Implementation 후속 PR scope

### 단일 PR — `packages/axia-mcp-server`

```typescript
// src/policy.ts (신규)
export interface CapabilityPolicy {
  enabled_tiers: Tier[];
  allow_caps: Set<string>;     // empty = no implicit deny
  deny_caps: Set<string>;
}

export function isEnabled(
  capability: string,
  policy: CapabilityPolicy,
): boolean {
  if (policy.deny_caps.has(capability)) return false;          // P27.1
  if (policy.allow_caps.size > 0) {
    return policy.allow_caps.has(capability);                  // implicit deny
  }
  const t = tierOf(capability);
  if (t === undefined) return false;                            // unknown
  return policy.enabled_tiers.includes(t);                      // tier path
}

export function policyFromEnv(env): CapabilityPolicy { ... }    // P27.2
export function validateOrFatal(policy): void { ... }           // P27.3
```

기존 `tiers.ts` 의 `authorizeCapability` 는 `isEnabled` 호출로 대체.

### Migration

ADR-041 P26.8 의 7 회귀 테스트 모두 그대로 유지 (P27 default 가 P26.1
동작과 동일). 추가 8 회귀 (P27.6).

## Risks & Mitigations

- **R1** — Composition 복잡도: 진리표 (P27.1) + 8 회귀 테스트로 강제
- **R2** — 사용자 typo: P27.3 fatal + "Did you mean" 힌트
- **R3** — ALLOW/DENY 와 Tier 의 mental model 충돌: 문서화 + audit reason
  분리 (P27.5)
- **R4** — `tools/list` 와 실제 활성 불일치: P27.4 invariant + 회귀 #8

## Success Criteria

- ✅ ADR-042 P27 결정 commit 고정
- ✅ `src/policy.ts` 구현 (additive composition, suggestCapability +
  validatePolicy)
- ✅ 8 회귀 테스트 통과 (P27.6) — policy.test.ts 23 tests
- ✅ ADR-041 P26.1 7 회귀 모두 unchanged (DEFAULT_POLICY ↔ ADR-041 default)
- ✅ 103 / 103 tests passing
- ⏳ docs/integrations/ 가이드 업데이트 (별도 commit, optional)

## References

- ADR-041 P26.1 (4-tier whitelist), P26.7 (Audit Trail)
- POSIX `capabilities(7)`, AWS IAM policy evaluation
- 메타-원칙 #5 (사용자 편의: 명확하면 자동, 모호하면 명시 동의)

## 변경 이력

- **2026-05-02 (initial draft)**: P27 신규. 6 세부 규칙 + 8 회귀 테스트.
  Composition: AWS-style implicit-deny (ALLOW non-empty 시 그 외 거부).
- **2026-05-02 (revised + accepted)**: 구현 중 UX 발견 — implicit-deny
  semantics 는 "Tier 0+1 + push_pull 만 추가" 케이스에서 사용자가 모든
  Tier 1 cap 을 enumerate 해야 함 (악몽). **Additive semantics 로 변경**:
  ALLOW = 추가, DENY = 제거. Exhaustive whitelist 필요 시 `TIERS=∅` +
  `ALLOW=...`. AWS IAM 의 evaluation 과 정합적이며 사용자 직관 ↑.
  Status: Proposed → Accepted, LOCKED #20.
