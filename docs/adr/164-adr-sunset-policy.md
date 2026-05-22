# ADR-164 — ADR Sunset Policy (Standard 3-Status + Supersede 명시 정책)

| Field | Value |
|---|---|
| Status | **Active** |
| Date | 2026-05-22 |
| Anchor | `reports/ADR_141_옵션4_6_TaskBrief.html` §1 (b) + LOCKED #44 (Complete Meaning per Merge) + 메타-원칙 #10 (ADR 불변) |
| Scope | docs only — 정책 정의 문서 + 핵심 3개 LOCKED 본문 검증, 52 ADR 전수 정정은 2순위 deferred |

## Context (맥락)

2026-05-22 audit (1순위 cleanup brief) 결과 다음 governance drift 가
노출됨:

1. **Status 표기 비표준 누적** — 52 ADR 의 `Status` 라인이 한 가지
   canonical form 을 따르지 않음. `Active` / `Accepted` / `Proposed
   (α spec only — ...)` / `Draft (spec only, ζ-α)` / `α spec only
   (β implementation deferred — multi-week atomic)` 등 ad-hoc 표기.
   향후 ADR 작성자가 follow 할 표준이 부재.
2. **Superseded ADR 의 명시 부족** — Supersede 관계가 본문 callout
   으로만 표기되거나 (LOCKED #1 / #12 / #41 의 callout), 또는 README
   의 catalog 라인에 `Superseded by ADR-YYY` 만 명시되거나, 두 layer
   가 drift 가능. 표준 Status 라인 (`Accepted, Superseded by ADR-YYY
   (date)`) 부재.
3. **Archive 정책 부재** — 명시적으로 폐기된 ADR (Sprint 0 이전
   archive/ 후보) 의 처리 절차 미정. 5,265 cross-refs (audit report
   `reports/ADR_정리_전략.html` §3) 의 영향 미정.

본 ADR 의 목적: 향후 모든 ADR 의 Status 표기 + Supersede 명시 + Archive
절차 의 canonical SSOT 정립.

## Decision (결정)

### 표준 3-Status (canonical)

모든 ADR 본문의 `Status` 라인은 다음 3가지 form 중 **정확히 하나**:

```
**Status**: Active

**Status**: Accepted, Superseded by ADR-YYY (YYYY-MM-DD)

**Status**: Archived (moved to docs/adr/archive/, YYYY-MM-DD)
```

- **Active** — 현재 운영 중인 결정. 코드 / 정책 / 회귀 자산 active.
- **Accepted, Superseded by ADR-YYY (date)** — 후속 ADR 으로 대체된
  결정. *결과 invariant* 는 보존 (메타-원칙 #14 답습), *trigger 정책*
  만 supersede 일 수 있음. 본문 내용 보존 (메타-원칙 #10 ADR 불변).
- **Archived (moved to ..., date)** — `docs/adr/archive/` 로 물리
  이동된 결정. cross-refs (README catalog / CLAUDE.md LOCKED / 다른
  ADR `Related`) 모두 archive/ 경로 갱신 필수. 본 정책은 archive 절차
  의 **결정 layer** — 실제 물리 이동은 별도 ADR (2순위 또는 별도 트랙).

### 표기 변형 허용 범위

- `Status` 라인은 위 3 form 정확 일치. *부가 설명* 은 별도 라인에
  허용 (예: 본문 callout `> ⚠ **Superseded by ADR-139**` 같이 추가
  맥락).
- α/β/γ 등 sub-step 진행 표기는 별도 `| Path | Status` table 또는
  `§D Acceptance Log` 에 명시. Status 라인 자체는 위 3 form 강제.

### Supersede 명시 강제 layer

Supersede 관계는 다음 *모든* layer 에 정합 명시:

1. **ADR 본문 Status 라인** — `Accepted, Superseded by ADR-YYY (date)`
2. **README catalog 상태 column** — `Accepted, Superseded by ADR-YYY` 또는
   `Superseded by ADR-YYY`
3. **CLAUDE.md LOCKED 본문 (해당 시)** — 첫 줄 callout `> ⚠
   **Superseded by ADR-YYY** (date, reason)`
4. **후속 ADR 의 `Related` section** — `Supersedes ADR-XXX (date,
   reason)`

4 layer 중 하나라도 drift 발견 시 hot-fix 권장.

### 본 PR scope (1순위 한정)

- ✅ 본 ADR-164 정책 정의 문서 신설
- ✅ CLAUDE.md LOCKED #66 신설 — 본 ADR 의 LOCKED 안내 (lightweight pointer)
- ✅ LOCKED #1 / #12 / #41 의 본문 supersede callout 정합 **검증**
  (모두 이미 명시 — 추가 작업 0, 메타-원칙 #10 ADR 불변 정합)
- ❌ 52개 비표준 Status 일괄 정정 — **2순위로 deferred** (별도 PR /
  multi-week atomic 또는 점진 갱신)
- ❌ Superseded ADR 의 `docs/adr/archive/` 물리 이동 — **2순위로
  deferred** (5,265 cross-refs 위험, 별도 redirect 스크립트 필요)

## Rationale (근거)

### 메타-원칙 정합

- **메타-원칙 #6 (Preventive over Curative)** — Sprint 1 진입 전
  governance baseline 확보. 향후 ADR 의 Status 표기가 표준에 정합 →
  drift 재발 차단.
- **메타-원칙 #10 (ADR 불변)** — 본 ADR 의 적용은 Status 라인 + 본문
  callout 만. ADR 본문 내용 변경 금지.
- **메타-원칙 #4 (SSOT)** — 본 ADR 이 Status 표기 의 single source.
  README / CLAUDE.md / 후속 ADR 본문 모두 본 ADR 답습.

### LOCKED 정합

- **LOCKED #44 (Complete Meaning per Merge)** — 본 PR 의 의미 단위 =
  정책 정의 + 핵심 3개 LOCKED 검증. 52 ADR 일괄 정정은 별개 의미
  단위 → 별도 PR 분리.
- **LOCKED #65 (ADR-141 Master Roadmap)** — Sprint 0 ε closure (ADR-141)
  후속 cleanup 의 일부. Sprint 1 본격 진입 직전 governance 회복.

## Consequences (결과)

### 긍정

- 향후 ADR 작성자 의 Status 표기 의문 해소 (canonical 3 form)
- Supersede 관계 4-layer 정합 강제 → drift 자동 감지 가능 (Phase 4 CI 자동화)
- Archive 절차 의 결정 layer 명시 → 향후 별도 ADR 작성 시 base layer

### 부정 (의도된 한계)

- 52개 비표준 Status 잔존 — 2순위 PR 까지 일관성 부족
- Archive 물리 이동 미실행 — Sprint 0 이전 Superseded ADRs (138, 048,
  015, 101 등) 가 main 폴더에 잔존
- 본 ADR 의 적용 enforcement 는 manual review 의존 (자동 check 는
  Phase 4 CI 자동화 ADR 의 scope)

## Alternatives (대안)

### Alt A — CLAUDE.md LOCKED #66 단독 신설 (별도 ADR 없음)
- 거부 이유: ADR-driven workflow (메타-원칙 #10) 의 SSOT 는 ADR. LOCKED
  은 CLAUDE.md 의 안내 layer. 정책 정의 본체는 ADR 에 있어야.

### Alt B — README.md 의 "변경 규칙" 절 확장
- 거부 이유: README 는 catalog 의 layer, governance 정책의 layer 아님.
  본 ADR 같은 SSOT 가 더 적절.

### Alt C — 본 PR 에 52 ADR 일괄 정정 포함
- 거부 이유: LOCKED #44 위반 (Complete Meaning per Merge — 정책 정의
  + 일괄 정정은 별개 의미 단위). 1-2주 multi-week atomic 작업 필요.

## When to Revisit (재검토 트리거)

- 52개 비표준 Status 일괄 정정 PR open 시 (2순위)
- Archive 물리 이동 정책 ADR 작성 시 (별도 트랙)
- 1년 후 (2027-05) governance audit 시
- 새 Status form 필요 시점 (예: Draft / Deprecated / Experimental 등)
  — 본 ADR amendment 또는 후속 ADR
- CI 자동화 ADR (Phase 4 의 `scripts/check-adr-catalog.mjs`) 의 Status
  표기 check 추가 시

## Related (관련 기록)

### Anchor 문서
- `reports/ADR_141_옵션4_6_TaskBrief.html` §1 (b) — 본 ADR 의 결재 anchor
- `reports/ADR_정리_전략.html` §3 — 5,265 cross-refs source

### 동시 변경 (본 PR scope)
- `docs/adr/README.md` — 15 missing ADR 등재 (catalog drift 0)
- `CLAUDE.md` LOCKED #66 — 본 ADR 의 LOCKED 안내
- `scripts/check-adr-catalog.mjs` — README sync check (Phase 4 CI 선택)

### 정합 정책
- ADR-141 — Master Roadmap (Sprint 0 ε closure anchor)
- LOCKED #44 — Complete Meaning per Merge
- LOCKED #65 — ADR-141 Master Roadmap (Foundation Sync closure)
- 메타-원칙 #6 — Preventive over Curative
- 메타-원칙 #10 — ADR 불변 (변경 시 새 ADR + Superseded)

### Future tracks
- **별도 ADR (2순위, multi-week atomic)** — 52 ADR Status 일괄 정정
- **별도 ADR** — Superseded → `docs/adr/archive/` 물리 이동 + redirect
  스크립트 + cross-refs (5,265) 자동 갱신
- **별도 ADR (Phase 4 자연 연장)** — CI 자동화 의 Status 표기 check
  (현재 본 PR 의 `check-adr-catalog.mjs` 는 catalog 등재 check 만)

## §D Acceptance Log

| Sub-step | Commit | Scope | 회귀 |
|---|---|---|---|
| α (본 PR) | (Phase 5 commit hash) | ADR-164 정책 정의 문서 + LOCKED #66 신설 + README catalog 15 등재 + CI 자동화 (선택) | docs only, +0 또는 +1 (CI script self-test) |

향후 sub-step 은 별도 ADR (2순위 52 ADR 정정, archive 물리 이동, etc.).
