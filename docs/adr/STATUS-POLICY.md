# ADR Status & Lifecycle Policy

**Status**: Accepted (Sprint 0 Foundation Sync follow-up cleanup, 2026-05-22)
**Date**: 2026-05-22
**LOCKED**: #66 (CLAUDE.md §66 — STATUS-POLICY enforcement)
**Related**: ADR-141 (Master Roadmap), LOCKED #44 (Complete Meaning per Merge),
LOCKED #65 (Master Roadmap), LOCKED #66 (본 정책 enforcement), README §변경 규칙

## 1. 목적

ADR (Architecture Decision Records) 의 **Status field 의 canonical
notation + lifecycle transition rules** 를 단일 문서로 lock-in.

기존 README §변경 규칙 의 1줄 ("Superseded 로 표시") 만으로는:
- Status 값 종류와 의미 미정 (Accepted / Proposed / Draft / Deferred /
  Superseded / Closed 등 자유 사용)
- Sub-step closure log 가 Status field 에 섞이는 drift
- Active / Superseded / Archived 3-tier lifecycle 미정의

본 문서가 향후 모든 ADR 의 Status notation SSOT.

## 2. Status 값 (canonical)

5개 lifecycle state. 각 ADR 은 *정확히 하나* 의 state 를 가진다.

| State | 의미 | 사용 시점 |
|---|---|---|
| **Proposed** | 결정 사항 작성됨, 사용자 결재 대기 | 초안 작성 직후 |
| **Draft** | α spec only — β implementation 별도 commit / PR 진행 중 또는 결재 대기 | α spec PR merge 직후 |
| **Accepted** | 결정 사항 lock-in 완료 — code 정합 또는 docs-only closure | β implementation closure 직후 (또는 spec-only ADR closure) |
| **Deferred** | 결정 사항 보류 — trigger 조건 명시, future 진입 가능 | 트리거 매트릭스 명시 후 |
| **Superseded by ADR-XXX** | 후속 ADR 로 대체 — 본 ADR 의 trigger 또는 결정 사항 변경 | 후속 ADR closure 직후 |

### 2.1 Status notation format (canonical)

**Heading 형식** (권장 — 가독성 우선):
```markdown
**Status**: Accepted (2026-05-22)
```

**List 형식** (Path Z atomic 패턴 ADR — ADR-091+ 답습):
```markdown
- **Status**: Accepted (D-α ~ D-η closure 2026-05-09)
- **Date**: 2026-05-09
```

**Both formats are acceptable** — 그러나 단일 ADR 내에서는 1개 format 만
사용 (mixed 금지).

### 2.2 Status 값 + 부속 정보

Date / closure log / sub-step 정보를 *동일 line* 에 합치는 패턴 허용:

```markdown
**Status**: Accepted (D-α ~ D-η closure 2026-05-09)
**Status**: Accepted (β-1 closed, β-2 ~ β-N 별도 PR)
**Status**: Draft (α spec only — β implementation 별도 사용자 결재 후 진행)
**Status**: Deferred (트리거 조건: chord error ≥ 0.1mm + memory > 100MB)
**Status**: Superseded by ADR-139 (2026-05-18, Q3=a 결재)
```

**Anti-pattern** (drift):
- `**Status**:` (값 없음)
- `**Status**: NO i18n infrastructure ...` (section content 가 Status 자리에)
- Sub-step closure 만 적고 lifecycle state 누락 (예: `**Status**: P-1~P-4 완료` — `Accepted` keyword 필수)

### 2.3 Status 의 첫 token 강제

검색 / grep / audit 자동화를 위해 **첫 token = 5 canonical state 중 하나**
가 *강제*. 부속 정보는 첫 token 뒤에 위치.

```
✅ **Status**: Accepted (X closure)
✅ **Status**: Draft + Amendment 1 (refinements 2026-05-04)
❌ **Status**: P-1~P-4 완료      # canonical state token 누락
❌ **Status**: NO i18n ...        # 잘못된 첫 token
```

## 3. Lifecycle transitions

```
Proposed
  ↓ (사용자 결재)
Draft (α spec only)
  ↓ (β implementation closure)
Accepted
  ↓ (후속 ADR 발생)
Superseded by ADR-XXX

[Accepted 또는 Proposed]
  ↓ (trigger 조건 보류)
Deferred
  ↓ (트리거 조건 만족 + 사용자 결재)
Accepted
```

### 3.1 Transition rules

| From | To | Trigger | Required |
|---|---|---|---|
| (none) | Proposed | 새 ADR 작성 | docs/adr/XXX-*.md 생성 |
| Proposed | Draft | 사용자 결재 + α spec PR merge | Status line update + Date stamp |
| Draft | Accepted | β implementation closure (사용자 시연 게이트 PASS) | Status line update + §D Acceptance Log |
| Accepted | Superseded | 후속 ADR (사용자 결재 + 새 ADR closure) | Status line update — `Superseded by ADR-XXX` + 후속 ADR 의 §Supersedes 명시 |
| Proposed/Accepted | Deferred | 트리거 조건 명시 (사용자 결재) | Status line update — `Deferred (트리거: ...)` |

### 3.2 절대 금지

- **ADR 본문 retroactive 수정** (메타-원칙 #10 / LOCKED #10 답습) — 변경
  시 새 ADR 작성 + 본 ADR `Superseded by ADR-XXX` 표시
- **Status canonical token 누락** — 5 state 중 하나가 첫 token 위치
- **Sub-step closure log 만 Status 에 적기** — Accepted/Draft/etc 가 명시
  필요

### 3.3 허용 (additive)

- **§D Acceptance Log 추가** — closure 후 sub-step / 회고 / lessons 누적
  (Path Z atomic 패턴, README §변경 규칙 답습)
- **§E Lessons 추가** — canonical pattern 추출
- **Amendment N (사용자 결재 후)** — 본문 외 보조 section 신설 가능. 본문
  결정 변경 시 새 ADR.

## 4. Lifecycle 3-tier (거시 분류)

§2 의 5 canonical state 외에, **거시 lifecycle 3-tier** 가 운영 측면의
governance 모델로 병존. TaskBrief (2026-05-22) 정합.

| Tier | 5-state 매핑 | 의미 | 위치 |
|---|---|---|---|
| **Active** | Proposed / Draft / Accepted / Deferred | 현재 적용 가능 — 코드 정합 or 진행 중 | `docs/adr/*.md` |
| **Superseded** | Superseded by ADR-XXX | 후속 ADR 으로 대체됨 — 역사적 참조 | `docs/adr/*.md` (Status 명시) |
| **Archived** | — (별도 sweep) | 코드 영향 0, 역사 보존만 | 향후 `docs/adr/archive/` 별도 sweep |

### 4.1 Tier transitions

- **Active → Superseded**: 후속 ADR 결재 + 본 ADR Status 갱신 (`Superseded
  by ADR-XXX`). 본문 변경 0 (메타-원칙 #10).
- **Superseded → Archived**: 향후 별도 cleanup sweep (현 PR scope 외).
  - Trigger 조건: 모든 cross-reference 정리 + 5+ supersede chain 깊이
  - 물리 이동: `docs/adr/XXX-*.md` → `docs/adr/archive/XXX-*.md`
  - Redirect: `docs/adr/XXX-*.md` 위치에 stub 으로 ADR 검색 가능

### 4.2 5-state 와 3-tier 의 관계

5 canonical state 가 *workflow* 중심 (작성 → α → β → closure → supersede),
3-tier 가 *governance* 중심 (현재 vs 비활성 vs 역사). 두 model 호환:

- Active tier 의 5-state sub-state: Proposed / Draft / Accepted / Deferred
- Superseded tier: Superseded by ADR-XXX (5-state 와 1:1 매핑)
- Archived tier: 별도 sweep 진행 시 5-state 외부 marker (future)

### 4.3 본 PR scope (Sprint 0 cleanup, 2026-05-22)

- ✅ 5 canonical state 정의 (§2)
- ✅ 3-tier lifecycle 정의 (§4)
- ✅ Active ↔ Superseded transition rules (§3.1, §4.1)
- ✅ LOCKED #66 enforcement (CLAUDE.md)
- ❌ Archived 물리 이동 — 2순위 별도 sweep (5,265 cross-refs 위험)
- ❌ Active tier 의 모든 ADR 일괄 검토 — 2순위 (Sprint 1 병행)

## 5. README catalog 와 정합

ADR 의 README catalog `상태` 컬럼은 본 정책의 Status 첫 token 과 정합
*강제*. 약식 표기 허용:

| ADR Status (in file) | README 상태 컬럼 |
|---|---|
| Accepted (...) | Accepted |
| Draft (...) | Draft 또는 α spec |
| Deferred (...) | Deferred |
| Superseded by ADR-XXX (...) | Superseded by XXX |
| Proposed | Proposed |

## 6. 회귀 방지

본 정책 변경 시:
1. 사용자 명시 결재 필수
2. 본 문서 의 amendment (또는 새 ADR `Supersedes STATUS-POLICY`)
3. 영향받는 ADR 들의 Status 일괄 갱신 (single atomic PR per LOCKED #44)

## 7. Cross-link

- ADR-141 (Master Roadmap — Sprint 0 Foundation Sync)
- README.md §변경 규칙 (본 정책의 1줄 baseline)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR scope)
- LOCKED #65 (Master Roadmap)
- 메타-원칙 #10 (ADR 불변)
