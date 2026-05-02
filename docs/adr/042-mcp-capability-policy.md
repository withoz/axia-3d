# ADR-042: MCP Capability Policy — ALLOW / DENY Refinement

**Status**: **Proposed** (2026-05-02)
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

**P27.1 — Composition rule (fail-closed)**

```
final_enabled(cap) =
    (tier_of(cap) ∈ enabled_tiers)
    AND (cap ∉ deny_caps)
    AND (allow_caps = ∅ OR cap ∈ allow_caps)
```

진리표:

| Tier 활성 | DENY | ALLOW (∅=비어있음) | 결과 |
|---|---|---|---|
| ✓ | — | ∅ | **활성** (default 경로) |
| ✓ | ✓ | — | **비활성** (deny wins) |
| ✓ | — | 포함 | **활성** |
| ✓ | — | 비포함 (allow ≠ ∅) | **비활성** (implicit deny) |
| — | — | 포함 | **활성** (allow 가 tier 보다 ↑) |
| — | ✓ | 포함 | **비활성** (deny wins) |

**핵심**:
- ALLOW 가 비어있으면 (default), tier 만으로 결정
- ALLOW 가 비어있지 않으면, tier 가 꺼져있어도 ALLOW 가 활성화 가능
  (단, DENY 면 즉시 deny)
- **DENY 는 무조건 우선** — fail-closed

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
| 4 | `policy_allow_implicit_deny_excludes_others` | ALLOW=[draw_rect] → draw_circle 거부 (tier 1 인데도) |
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

- ✅ ADR-042 P27 결정이 commit 으로 고정 (이 PR)
- ⏳ `src/policy.ts` 구현
- ⏳ 8 회귀 테스트 (P27.6)
- ⏳ ADR-041 P26.1 7 회귀 모두 unchanged (P27 default = ADR-041 default)
- ⏳ docs/integrations/ 가이드 업데이트 (ALLOW/DENY 사용 예제)

## References

- ADR-041 P26.1 (4-tier whitelist), P26.7 (Audit Trail)
- POSIX `capabilities(7)`, AWS IAM policy evaluation
- 메타-원칙 #5 (사용자 편의: 명확하면 자동, 모호하면 명시 동의)

## 변경 이력

- **2026-05-02 (initial)**: P27 신규. 6 세부 규칙 + 8 회귀 테스트.
  ADR-041 의 자연 확장으로 fail-closed composition + unknown=fatal +
  audit reason 분리. 단일 PR 구현 가능 (분리 마이그레이션 불필요).
